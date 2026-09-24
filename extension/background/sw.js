// Service worker: the single writer of extension storage and the owner of downloads.
import { devPing, devStatus } from './dev-reload.js';

const handlers = {
  'dev:status': () => devStatus(),
  'dev:ping': () => devPing(),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => {
      console.error('[meet-transcriber]', msg.type, err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    });
  return true; // async response
});
