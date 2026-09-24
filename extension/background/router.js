// Message handlers of the service worker, built from injected dependencies so the same code runs in the
// extension, in dev/harness.html and in node tests.
import { createStore } from './store.js';

// scheduleEnd/cancelEnd: when a meeting page unloads we cannot tell a reload from leaving Meet, so the
// meeting is ended after a grace period unless a Meet page in the same tab says hello again.
export function createRouter({
  storage,
  tabMap = memoryTabMap(),
  openArchive = async () => {},
  scheduleEnd = async () => {},
  cancelEnd = async () => {},
  now = () => Date.now(),
}) {
  const store = createStore(storage, { now });

  async function endMeeting(id) {
    return store.end(id);
  }

  const handlers = {
    'settings:get': () => store.getSettings(),
    'settings:set': ({ patch }) => store.setSettings(patch || {}),

    'tab:hello': async (_msg, sender) => {
      if (sender?.tab?.id != null) await cancelEnd(sender.tab.id);
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
    'meeting:rename': ({ id, title }) => store.rename(id, title).then((m) => !!m),
    'meeting:delete': ({ id }) => store.remove(id),
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
  };
}

export function memoryTabMap() {
  const map = new Map();
  return {
    get: async (tabId) => map.get(tabId) || null,
    set: async (tabId, id) => void map.set(tabId, id),
    remove: async (tabId) => void map.delete(tabId),
  };
}
