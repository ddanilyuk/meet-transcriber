// Service worker: the single writer of extension storage and the owner of downloads.
import { createRouter } from './router.js';
import { devPing, devStatus } from './dev-reload.js';

const ARCHIVE_URL = chrome.runtime.getURL('archive/archive.html');
const MEET_TABS = 'https://meet.google.com/*';
const END_ALARM = 'end:';
const END_GRACE_MIN = 1.5;
const SWEEP_ALARM = 'sweep';
const SWEEP_PERIOD_MIN = 1;

// tabId -> meeting id, kept in session storage so it survives service worker restarts (but not an extension
// reload or a browser restart: router.sweep() covers meetings whose link was lost).
const tabMap = {
  get: async (tabId) => (await chrome.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`] || null,
  set: (tabId, id) => chrome.storage.session.set({ [`tab:${tabId}`]: id }),
  remove: (tabId) => chrome.storage.session.remove(`tab:${tabId}`),
  entries: async () =>
    Object.entries(await chrome.storage.session.get(null))
      .filter(([k]) => k.startsWith('tab:'))
      .map(([k, id]) => [Number(k.slice(4)), id]),
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
  if (alarm.name === SWEEP_ALARM) sweep();
});

function sweep() {
  const tabExists = (tabId) => chrome.tabs.get(tabId).then(() => true, () => false);
  return router.sweep({ tabExists }).catch((err) => console.error('[meet-transcriber] sweep failed', err));
}

// After an install, reload or update, the content scripts already running in Meet tabs are orphaned: they
// keep running but can no longer reach the extension, so a call in progress would silently stop being saved.
// Inject fresh copies (same files as the manifest); the new copy retires the orphan and resumes the same
// meeting record (content/main.js).
async function reinjectMeetTabs() {
  const scripts = chrome.runtime.getManifest().content_scripts || [];
  for (const tab of await chrome.tabs.query({ url: MEET_TABS })) {
    const target = { tabId: tab.id };
    try {
      for (const cs of scripts) {
        if (cs.css?.length) await chrome.scripting.insertCSS({ target, files: cs.css });
        if (cs.js?.length) await chrome.scripting.executeScript({ target, files: cs.js, world: cs.world || 'ISOLATED' });
      }
    } catch (err) {
      console.warn('[meet-transcriber] could not reinject into tab', tab.id, err);
    }
  }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: SWEEP_PERIOD_MIN });
  if (reason === 'install' || reason === 'update') reinjectMeetTabs();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: SWEEP_PERIOD_MIN });
  sweep(); // meetings open when the browser was closed
});
