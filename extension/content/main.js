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

  const settings = { autoCaptions: true, autoUkrainian: true, showOverlay: false };
  const builder = new MT.TranscriptBuilder();
  let languageTried = false;
  const tracker = new MT.CaptionTracker({
    builder,
    onRegion: async (region) => {
      console.debug('[meet-transcriber] captions region', region ? 'found' : 'gone');
      if (!region) return;
      MT.captions.markRoot(region);
      if (settings.autoUkrainian && !languageTried) {
        languageTried = true;
        const ok = await MT.captions.setUkrainian();
        console.debug('[meet-transcriber] ukrainian', ok);
      }
    },
    onChange: () => {},
  });
  MT.debug = { builder, tracker };

  console.info('[meet-transcriber] content script loaded');
  MT.captions.setOverlayVisible(settings.showOverlay);
  tracker.start();
  const ccTimer = setInterval(() => {
    if (!MT.dom.isInCall()) return;
    if (settings.autoCaptions) MT.captions.enableCaptions();
    clearInterval(ccTimer);
  }, 1000);
  startDevReload();
})();
