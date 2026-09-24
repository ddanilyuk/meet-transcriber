// Content script entry point on meet.google.com.
(function () {
  const MT = globalThis.MT;

  // Messages to the service worker; resolves to null when the extension context is gone (after a reload).
  MT.send = function send(type, payload = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...payload }, (res) => {
          if (chrome.runtime.lastError || !res) return resolve(null);
          if (!res.ok) console.warn('[meet-transcriber]', type, res.error);
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

  const session = new MT.MeetingSession();
  MT.session = session;
  session.init();
  if (MT.Sidebar) {
    MT.sidebar = new MT.Sidebar(session);
    MT.sidebar.mount();
  }
  startDevReload();
  console.info('[meet-transcriber] content script loaded');
})();
