// Service worker: the single writer of extension storage and the owner of downloads.
import { createRouter } from './router.js';
import { devPing, devStatus } from './dev-reload.js';

const ARCHIVE_URL = chrome.runtime.getURL('archive/archive.html');
const END_ALARM = 'end:';
const END_GRACE_MIN = 1.5;

// tabId -> meeting id, kept in session storage so it survives service worker restarts.
const tabMap = {
  get: async (tabId) => (await chrome.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`] || null,
  set: (tabId, id) => chrome.storage.session.set({ [`tab:${tabId}`]: id }),
  remove: (tabId) => chrome.storage.session.remove(`tab:${tabId}`),
};

// Saves text into the Downloads folder. Service workers have no URL.createObjectURL, so use a data: URL.
async function download({ filename, text, mime }) {
  const url = `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
  const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  return { id, filename };
}

const router = createRouter({
  storage: chrome.storage.local,
  tabMap,
  download,
  openArchive: (hash = '') => chrome.tabs.create({ url: ARCHIVE_URL + hash }),
  scheduleEnd: (tabId) => chrome.alarms.create(END_ALARM + tabId, { delayInMinutes: END_GRACE_MIN }),
  cancelEnd: (tabId) => chrome.alarms.clear(END_ALARM + tabId),
});

router.handlers['dev:status'] = () => devStatus();
router.handlers['dev:ping'] = () => devPing();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!router.handlers[msg?.type]) return false;
  router
    .handle(msg, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => {
      console.error('[meet-transcriber]', msg.type, err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    });
  return true; // async response
});

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: ARCHIVE_URL }));

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.alarms.clear(END_ALARM + tabId);
  router.tabGone(tabId);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(END_ALARM)) router.tabGone(Number(alarm.name.slice(END_ALARM.length)));
});
