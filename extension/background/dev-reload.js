// Development helper for the unpacked extension: when the local dev server (npm run dev) is running,
// reload the extension as soon as files under extension/ change. Content scripts on Meet tabs drive the
// checks with `dev:ping` messages, which also keeps the service worker alive while a Meet tab is open.
const VERSION_URL = 'http://localhost:8765/__version';

let isUnpacked = null;
let knownVersion = null;

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
export async function devStatus() {
  if (!(await unpacked())) return false;
  const version = await fetchVersion();
  if (version && knownVersion === null) knownVersion = version;
  return !!version;
}

export async function devPing() {
  if (!(await unpacked())) return false;
  const version = await fetchVersion();
  if (!version) return false;
  if (knownVersion === null) knownVersion = version;
  if (version !== knownVersion) {
    console.info('[meet-transcriber] files changed, reloading extension');
    setTimeout(() => chrome.runtime.reload(), 50);
  }
  return true;
}
