// Development helper for the unpacked extension: when the local dev server (npm run dev) is running,
// reload the extension as soon as files under extension/ change. Content scripts on Meet tabs drive the
// checks with `dev:ping` messages, which also keeps the service worker alive while a Meet tab is open.
const VERSION_URL = 'http://localhost:8765/__version';
// The version the extension was (re)loaded with. Stored in storage.local (session storage is cleared on
// reload), so edits that land between a reload trigger and the reload itself cause one more reload.
const VERSION_KEY = '__devLoadedVersion';

let isUnpacked = null;
let knownVersion = null;
const loaded = chrome.storage.local.get(VERSION_KEY).then((r) => {
  if (knownVersion === null && r[VERSION_KEY]) knownVersion = r[VERSION_KEY];
});

async function unpacked() {
  if (isUnpacked === null) {
    const self = await chrome.management.getSelf();
    isUnpacked = self.installType === 'development';
  }
  return isUnpacked;
}

async function fetchVersion() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 800);
  try {
    const res = await fetch(VERSION_URL, { cache: 'no-store', signal: ctrl.signal });
    return res.ok ? (await res.text()).trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Returns true when the dev server is reachable and the page should keep pinging.
async function remember(version) {
  knownVersion = version;
  await chrome.storage.local.set({ [VERSION_KEY]: version });
}

export async function devStatus() {
  if (!(await unpacked())) return false;
  await loaded;
  const version = await fetchVersion();
  if (version && knownVersion === null) await remember(version);
  return !!version;
}

export async function devPing() {
  if (!(await unpacked())) return false;
  await loaded;
  const version = await fetchVersion();
  if (!version) return false;
  if (knownVersion === null) await remember(version);
  if (version !== knownVersion) {
    console.info('[meet-transcriber] files changed, reloading extension');
    await remember(version);
    setTimeout(() => chrome.runtime.reload(), 50);
  }
  return true;
}
