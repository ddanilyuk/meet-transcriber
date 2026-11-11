// Message handlers of the service worker, built from injected dependencies so the same code runs in the
// extension, in dev/harness.html and in node tests.
import '../shared/util.js';
import '../shared/format.js';
import { createStore } from './store.js';

const { format } = globalThis.MT;

// An open meeting that no tab is linked to and that has not been updated for this long is over: its tab link
// was lost (extension reload or update, browser restart) and no content script re-linked it.
export const STALE_MS = 2 * 60 * 1000;

// Google Drive copy. A failed upload is retried by sweep() after these pauses (minutes, by attempt number);
// after the last one only the "retry" button in the archive uploads it.
export const DRIVE_RETRY_MIN = [1, 5, 15, 60, 240];
// An upload that was started but never reported back (the service worker was killed) is retried after this.
export const DRIVE_IN_FLIGHT_MS = 2 * 60 * 1000;

// drive: { connected(), upload({ fileId, name, text }) -> { fileId } } or null when the copy is not available.
// Upload errors carry kind 'auth' when the user has to sign in to Google again.
//
// scheduleEnd/cancelEnd: when a meeting page unloads we cannot tell a reload from leaving Meet, so the
// meeting is ended after a grace period unless the same tab joins that call again (session:start). A new page
// in the tab that is not that call (tab:hello with another or no meeting code) ends it at once.
export function createRouter({
  storage,
  tabMap = memoryTabMap(),
  openArchive = async () => {},
  scheduleEnd = async () => {},
  cancelEnd = async () => {},
  download = async () => {},
  drive = null,
  now = () => Date.now(),
}) {
  const store = createStore(storage, { now });

  // Uploads of one meeting run one after another, so an end, a rename, a manual retry and the sweep can
  // never create two files for it.
  const driveChains = new Map();
  function syncDrive(id, opts = {}) {
    const run = (driveChains.get(id) || Promise.resolve()).then(() => uploadToDrive(id, opts));
    const tail = run.catch(() => {});
    driveChains.set(id, tail);
    tail.then(() => {
      if (driveChains.get(id) === tail) driveChains.delete(id);
    });
    return run;
  }

  // dueOnly: the sweep's retry, skipped when the copy is already up to date or its pause is not over.
  // Returns the meeting's drive state, or null when there was nothing to upload.
  async function uploadToDrive(id, { dueOnly = false } = {}) {
    const meeting = await store.get(id);
    if (!drive || !meeting || !meeting.entries.length) return null;
    const state = meeting.drive || {};
    if (dueOnly) {
      // A resumed meeting is uploaded again when it ends.
      if (!meeting.endedAt || !['pending', 'error'].includes(state.status)) return state;
      if (state.nextAt == null || state.nextAt > now()) return state;
    }
    if (!(await drive.connected())) return (await store.setDrive(id, { status: 'auth', nextAt: null }))?.drive;
    // Written before the network call: if the service worker dies mid-upload, the sweep picks it up.
    await store.setDrive(id, { status: 'pending', nextAt: now() + DRIVE_IN_FLIGHT_MS });
    try {
      const { fileId } = await drive.upload({
        fileId: state.fileId || null,
        name: format.fileName(meeting, 'md', ''),
        text: format.render(meeting, 'md').text,
      });
      return (await store.setDrive(id, { status: 'done', fileId, attempts: 0, nextAt: null, error: null, uploadedAt: now() }))?.drive;
    } catch (err) {
      console.error('[meet-transcriber] Google Drive upload failed', err);
      const attempts = (state.attempts || 0) + 1;
      const auth = err?.kind === 'auth';
      const pause = DRIVE_RETRY_MIN[attempts - 1];
      return (
        await store.setDrive(id, {
          status: auth ? 'auth' : 'error',
          attempts,
          nextAt: auth || pause == null ? null : now() + pause * 60 * 1000,
          error: String(err?.message || err),
        })
      )?.drive;
    }
  }

  async function retryDrive() {
    if (!drive) return;
    for (const m of await store.list()) {
      if (m.endedAt && (m.drive === 'pending' || m.drive === 'error')) await syncDrive(m.id, { dueOnly: true });
    }
  }

  async function exportMeeting(meeting, fmt = 'md') {
    const { text, mime, filename } = format.render(meeting, fmt);
    return download({ filename, text, mime });
  }

  // Ends the meeting once; saves the Markdown transcript when auto-download is on and there is something to save.
  // Meetings where nobody said anything are dropped instead of cluttering the archive.
  async function endMeeting(id, at = null) {
    const meeting = await store.end(id, at);
    if (!meeting) return null;
    if (!meeting.entries.length) {
      await store.remove(id);
      return meeting;
    }
    const settings = await store.getSettings();
    if (settings.autoDownload && meeting.entries.length) {
      try {
        await exportMeeting(meeting, 'md');
      } catch (err) {
        console.error('[meet-transcriber] auto-download failed', err);
      }
    }
    if (settings.driveUpload) await syncDrive(id).catch(() => {});
    return meeting;
  }

  async function endLinked(tabId, id) {
    await cancelEnd(tabId);
    await tabMap.remove(tabId);
    return endMeeting(id);
  }

  const handlers = {
    'settings:get': () => store.getSettings(),
    'settings:set': ({ patch }) => store.setSettings(patch || {}),

    'tab:hello': async ({ code }, sender) => {
      const tabId = sender?.tab?.id;
      const id = tabId != null ? await tabMap.get(tabId) : null;
      if (id && (await store.get(id))?.code !== code) await endLinked(tabId, id);
      return store.getSettings();
    },
    'tab:bye': async (_msg, sender) => {
      const tabId = sender?.tab?.id;
      if (tabId != null && (await tabMap.get(tabId))) await scheduleEnd(tabId);
      return true;
    },

    'session:start': async ({ code, title, url }, sender) => {
      const { meeting, resumed } = await store.start({ code, title, url });
      if (sender?.tab?.id != null) {
        await cancelEnd(sender.tab.id);
        await tabMap.set(sender.tab.id, meeting.id);
      }
      return { meeting, resumed, settings: await store.getSettings() };
    },
    'session:update': ({ id, patch }) => store.update(id, patch || {}).then((m) => !!m),
    'session:end': async ({ id }, sender) => {
      if (sender?.tab?.id != null) await tabMap.remove(sender.tab.id);
      return !!(await endMeeting(id));
    },

    'meeting:get': ({ id }) => store.get(id),
    'meeting:export': async ({ id, format: fmt }) => {
      const meeting = await store.get(id);
      if (!meeting) throw new Error('Meeting not found');
      return exportMeeting(meeting, fmt || 'md');
    },
    // The Drive copy follows a rename (same file, new name).
    'meeting:rename': async ({ id, title }) => {
      const meeting = await store.rename(id, title);
      if (meeting?.endedAt && meeting.drive?.fileId) await syncDrive(id).catch(() => {});
      return !!meeting;
    },
    // Deleting from the archive leaves the Drive copy alone: it is the backup.
    'meeting:delete': ({ id }) => store.remove(id),
    // Manual upload or retry from the archive, also for meetings recorded before Drive was connected.
    'meeting:upload': async ({ id }) => {
      if (!drive) throw new Error('Google Drive is not available');
      if (!(await store.get(id))) throw new Error('Meeting not found');
      return syncDrive(id);
    },
    // After the user signed in to Google (again): everything that waited for the sign-in is uploaded.
    'drive:resume': async () => {
      for (const m of await store.list()) {
        if (m.drive === 'auth') await store.setDrive(m.id, { status: 'pending', nextAt: now() });
      }
      await retryDrive();
      return true;
    },
    'archive:open': ({ id }) => openArchive(id ? `#${encodeURIComponent(id)}` : ''),
  };

  return {
    store,
    handlers,
    async handle(msg, sender) {
      const handler = handlers[msg?.type];
      if (!handler) throw new Error(`Unknown message: ${msg?.type}`);
      return handler(msg, sender);
    },
    // The tab of a meeting was closed or navigated away without a clean "leave call".
    async tabGone(tabId) {
      const id = await tabMap.get(tabId);
      if (!id) return false;
      await tabMap.remove(tabId);
      return !!(await endMeeting(id));
    },
    // Safety net for meetings nobody can end any more: linked to a tab that no longer exists, or not linked
    // at all and quiet for STALE_MS. They end at their last update, not at sweep time. Returns the ids of
    // the meetings it ended.
    async sweep({ tabExists = async () => true } = {}) {
      const tabOf = new Map();
      for (const [tabId, id] of await tabMap.entries()) tabOf.set(id, tabId);
      const ended = [];
      for (const m of await store.list()) {
        if (m.endedAt) continue;
        const tabId = tabOf.get(m.id);
        if (tabId != null ? await tabExists(tabId) : now() - m.updatedAt < STALE_MS) continue;
        if (tabId != null) await tabMap.remove(tabId);
        if (await endMeeting(m.id, m.updatedAt)) ended.push(m.id);
      }
      await retryDrive();
      return ended;
    },
  };
}

export function memoryTabMap() {
  const map = new Map();
  return {
    get: async (tabId) => map.get(tabId) || null,
    set: async (tabId, id) => void map.set(tabId, id),
    remove: async (tabId) => void map.delete(tabId),
    entries: async () => [...map.entries()],
  };
}
