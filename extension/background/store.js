// Storage schema over a chrome.storage.local-like object (get/set/remove). Pure: no chrome.* references,
// so it runs in the service worker, the dev harness and node tests alike.
//
//   settings       -> { autoCaptions, autoUkrainian, showOverlay, autoDownload }
//   meetings       -> index: [{ id, code, title, startedAt, updatedAt, endedAt, speakers, entryCount, language }]
//   meeting:<id>   -> full record incl. entries: [{ id, speaker, text, startedAt, updatedAt }]

export const DEFAULT_SETTINGS = Object.freeze({
  autoCaptions: true,
  autoUkrainian: true,
  showOverlay: false,
  autoDownload: true,
});

// A reload or an accidental leave + rejoin continues the same meeting record.
export const RESUME_IDLE_MS = 10 * 60 * 1000;
export const RESUME_AFTER_END_MS = 5 * 60 * 1000;

const INDEX = 'meetings';
const key = (id) => `meeting:${id}`;

function meta(m) {
  return {
    id: m.id,
    code: m.code,
    title: m.title,
    startedAt: m.startedAt,
    updatedAt: m.updatedAt,
    endedAt: m.endedAt || null,
    speakers: m.speakers || [],
    entryCount: (m.entries || []).length,
    language: m.language || null,
  };
}

export function createStore(storage, { now = () => Date.now() } = {}) {
  // All writes go through one queue so concurrent messages never lose index updates.
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  async function readIndex() {
    return (await storage.get(INDEX))[INDEX] || [];
  }

  async function read(id) {
    return (await storage.get(key(id)))[key(id)] || null;
  }

  async function write(meeting) {
    const index = await readIndex();
    const i = index.findIndex((m) => m.id === meeting.id);
    if (i === -1) index.push(meta(meeting));
    else index[i] = meta(meeting);
    index.sort((a, b) => b.startedAt - a.startedAt);
    await storage.set({ [key(meeting.id)]: meeting, [INDEX]: index });
    return meeting;
  }

  return {
    async getSettings() {
      return { ...DEFAULT_SETTINGS, ...((await storage.get('settings')).settings || {}) };
    },

    setSettings(patch) {
      return serial(async () => {
        const next = { ...DEFAULT_SETTINGS, ...((await storage.get('settings')).settings || {}), ...patch };
        await storage.set({ settings: next });
        return next;
      });
    },

    list: readIndex,
    get: read,

    // Returns { meeting, resumed }.
    start({ code, title, url }) {
      return serial(async () => {
        const t = now();
        const index = await readIndex();
        const candidate = index.find(
          (m) => m.code === code && t - m.updatedAt < RESUME_IDLE_MS && (!m.endedAt || t - m.endedAt < RESUME_AFTER_END_MS),
        );
        if (candidate) {
          const meeting = await read(candidate.id);
          if (meeting) {
            meeting.endedAt = null;
            meeting.updatedAt = t;
            if (title && (!meeting.title || meeting.title === meeting.code)) meeting.title = title;
            return { meeting: await write(meeting), resumed: true };
          }
        }
        const meeting = {
          id: `${code || 'meet'}_${t}`,
          code: code || null,
          url: url || null,
          title: title || code || 'Google Meet',
          language: null,
          startedAt: t,
          updatedAt: t,
          endedAt: null,
          speakers: [],
          entries: [],
        };
        return { meeting: await write(meeting), resumed: false };
      });
    },

    // Merges transcript progress from the content script.
    update(id, patch) {
      return serial(async () => {
        const meeting = await read(id);
        if (!meeting) return null;
        for (const k of ['title', 'language', 'speakers', 'entries']) {
          if (patch[k] !== undefined && patch[k] !== null) meeting[k] = patch[k];
        }
        meeting.updatedAt = now();
        return write(meeting);
      });
    },

    // Marks the meeting as ended (now, or at `at` when it is known to have stopped earlier); returns it, or null
    // if it was already ended or does not exist.
    end(id, at = null) {
      return serial(async () => {
        const meeting = await read(id);
        if (!meeting || meeting.endedAt) return null;
        meeting.endedAt = at ?? now();
        return write(meeting);
      });
    },

    rename(id, title) {
      return serial(async () => {
        const meeting = await read(id);
        if (!meeting) return null;
        meeting.title = String(title || '').trim() || meeting.code || meeting.title;
        return write(meeting);
      });
    },

    remove(id) {
      return serial(async () => {
        const index = (await readIndex()).filter((m) => m.id !== id);
        await storage.set({ [INDEX]: index });
        await storage.remove(key(id));
        return true;
      });
    },
  };
}
