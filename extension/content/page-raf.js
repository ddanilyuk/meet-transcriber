// Runs in Meet's MAIN world at document_start.
// Meet renders captions from requestAnimationFrame callbacks, and Chrome pauses rAF in background tabs, so
// captions stop reaching the DOM while the user is in another tab (verified live, see docs/meet-dom.md).
// While the tab is hidden, route rAF through timers so captions keep rendering and can be recorded.
(() => {
  if (window.__meetTranscriberRaf) return;
  window.__meetTranscriberRaf = true;

  const nativeRaf = window.requestAnimationFrame;
  const nativeCaf = window.cancelAnimationFrame;
  const timers = new Map();
  let nextId = 2 ** 30;

  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    if (!document.hidden) return nativeRaf.call(window, callback);
    const id = nextId++;
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      callback(performance.now());
    }, 16));
    return id;
  };

  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    } else {
      nativeCaf.call(window, id);
    }
  };
})();
