// Content script entry point on meet.google.com.
(function () {
  const MT = globalThis.MT;

  // Messages to the service worker; resolves to null when the extension context is gone (after a reload).
  MT.send = function send(type, payload = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...payload }, (res) => {
          if (chrome.runtime.lastError || !res) return resolve(null);
          resolve(res.ok ? res.result : null);
        });
      } catch {
        resolve(null);
      }
    });
  };

  MT.contextAlive = function contextAlive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };

  async function startDevReload() {
    if (!(await MT.send('dev:status'))) return;
    const timer = setInterval(async () => {
      if (!MT.contextAlive()) return clearInterval(timer);
      await MT.send('dev:ping');
    }, 2000);
  }

  console.info('[meet-transcriber] content script loaded');
  startDevReload();
})();
