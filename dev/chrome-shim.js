// Minimal chrome.* shim so the extension's content scripts run on dev/harness.html without installing the
// extension. storage.local is kept in localStorage (so reload/resume can be tested); runtime.sendMessage is
// routed to window.__harnessBackground, which harness.html wires to the real background router.
(function () {
  const PREFIX = 'mtShim:';
  const listeners = [];

  function readAll() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(PREFIX)) out[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k));
    }
    return out;
  }

  function emit(changes) {
    if (!Object.keys(changes).length) return;
    for (const fn of listeners) setTimeout(() => fn(changes, 'local'), 0);
  }

  const local = {
    async get(keys) {
      const all = readAll();
      if (keys == null) return all;
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) {
        if (k in all) out[k] = all[k];
        else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[k] = keys[k];
      }
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        const old = localStorage.getItem(PREFIX + k);
        const json = JSON.stringify(v);
        localStorage.setItem(PREFIX + k, json);
        changes[k] = { oldValue: old == null ? undefined : JSON.parse(old), newValue: JSON.parse(json) };
      }
      emit(changes);
    },
    async remove(keys) {
      const changes = {};
      for (const k of [].concat(keys)) {
        const old = localStorage.getItem(PREFIX + k);
        if (old == null) continue;
        localStorage.removeItem(PREFIX + k);
        changes[k] = { oldValue: JSON.parse(old) };
      }
      emit(changes);
    },
    async clear() {
      const all = readAll();
      await local.remove(Object.keys(all));
    },
  };

  const base = new URL('../extension/', location.href);

  window.chrome = {
    runtime: {
      id: 'harness',
      lastError: undefined,
      getURL: (p) => new URL(p.replace(/^\//, ''), base).href,
      sendMessage(msg, cb) {
        const bg = window.__harnessBackground || (async () => null);
        Promise.resolve()
          .then(() => bg(msg, { tab: { id: 1, url: location.href } }))
          .then((result) => cb && cb({ ok: true, result }))
          .catch((err) => cb && cb({ ok: false, error: String(err) }));
      },
      onMessage: { addListener() {} },
    },
    storage: {
      local,
      onChanged: { addListener: (fn) => listeners.push(fn), removeListener: (fn) => listeners.splice(listeners.indexOf(fn), 1) },
    },
  };

  window.__shimResetStorage = () => local.clear();
})();
