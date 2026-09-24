import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, DEFAULT_SETTINGS, RESUME_IDLE_MS } from '../extension/background/store.js';
import { createRouter, memoryTabMap, STALE_MS } from '../extension/background/router.js';

// chrome.storage.local-like in-memory storage.
function memoryStorage() {
  const data = new Map();
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return {
    data,
    async get(keys) {
      const out = {};
      for (const k of [].concat(keys)) if (data.has(k)) out[k] = clone(data.get(k));
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, clone(v));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) data.delete(k);
    },
  };
}

function setup() {
  const clock = { t: Date.UTC(2026, 8, 24, 12, 0) };
  const storage = memoryStorage();
  const store = createStore(storage, { now: () => clock.t });
  return { clock, storage, store };
}

const entry = (id, speaker, text, startedAt = 0) => ({ id, speaker, text, startedAt, updatedAt: startedAt });

test('settings fall back to defaults and merge patches', async () => {
  const { store } = setup();
  assert.deepEqual(await store.getSettings(), DEFAULT_SETTINGS);
  await store.setSettings({ showOverlay: true });
  assert.deepEqual(await store.getSettings(), { ...DEFAULT_SETTINGS, showOverlay: true });
});

test('start creates a meeting and indexes it', async () => {
  const { store } = setup();
  const { meeting, resumed } = await store.start({ code: 'abc-defg-hij', title: 'Синк', url: 'https://meet.google.com/abc-defg-hij' });
  assert.equal(resumed, false);
  assert.equal(meeting.title, 'Синк');
  const index = await store.list();
  assert.equal(index.length, 1);
  assert.equal(index[0].id, meeting.id);
  assert.equal(index[0].entryCount, 0);
});

test('update stores entries and refreshes index metadata', async () => {
  const { store, clock } = setup();
  const { meeting } = await store.start({ code: 'abc-defg-hij' });
  clock.t += 60_000;
  await store.update(meeting.id, { entries: [entry('e-1', 'Олена', 'Привіт')], speakers: ['Олена'], language: 'Ukrainian (Ukraine)' });
  const saved = await store.get(meeting.id);
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.updatedAt, clock.t);
  const [meta] = await store.list();
  assert.deepEqual(meta.speakers, ['Олена']);
  assert.equal(meta.entryCount, 1);
  assert.equal(meta.language, 'Ukrainian (Ukraine)');
});

test('a reload within the idle window resumes the same meeting', async () => {
  const { store, clock } = setup();
  const first = await store.start({ code: 'abc-defg-hij' });
  clock.t += 3 * 60_000;
  const again = await store.start({ code: 'abc-defg-hij' });
  assert.equal(again.resumed, true);
  assert.equal(again.meeting.id, first.meeting.id);
});

test('rejoining shortly after leaving resumes and clears endedAt', async () => {
  const { store, clock } = setup();
  const { meeting } = await store.start({ code: 'abc-defg-hij' });
  clock.t += 60_000;
  assert.ok(await store.end(meeting.id));
  clock.t += 60_000;
  const again = await store.start({ code: 'abc-defg-hij' });
  assert.equal(again.meeting.id, meeting.id);
  assert.equal(again.meeting.endedAt, null);
});

test('the same code much later starts a new meeting', async () => {
  const { store, clock } = setup();
  const first = await store.start({ code: 'abc-defg-hij' });
  clock.t += RESUME_IDLE_MS + 1;
  const second = await store.start({ code: 'abc-defg-hij' });
  assert.equal(second.resumed, false);
  assert.notEqual(second.meeting.id, first.meeting.id);
  assert.equal((await store.list()).length, 2);
});

test('end is idempotent', async () => {
  const { store } = setup();
  const { meeting } = await store.start({ code: 'abc-defg-hij' });
  assert.ok(await store.end(meeting.id));
  assert.equal(await store.end(meeting.id), null);
});

test('concurrent updates never lose index entries', async () => {
  const { store } = setup();
  const a = (await store.start({ code: 'aaa-aaaa-aaa' })).meeting;
  const b = (await store.start({ code: 'bbb-bbbb-bbb' })).meeting;
  await Promise.all([
    store.update(a.id, { entries: [entry('e-1', 'A', 'a')] }),
    store.update(b.id, { entries: [entry('e-1', 'B', 'b'), entry('e-2', 'B', 'c')] }),
    store.rename(a.id, 'Перейменовано'),
  ]);
  const index = await store.list();
  assert.equal(index.length, 2);
  assert.equal(index.find((m) => m.id === a.id).title, 'Перейменовано');
  assert.equal(index.find((m) => m.id === b.id).entryCount, 2);
});

test('remove deletes the record and its index row', async () => {
  const { store, storage } = setup();
  const { meeting } = await store.start({ code: 'abc-defg-hij' });
  await store.remove(meeting.id);
  assert.equal((await store.list()).length, 0);
  assert.equal(storage.data.has(`meeting:${meeting.id}`), false);
});

test('router: tab bookkeeping ends a meeting whose tab disappeared', async () => {
  const storage = memoryStorage();
  const scheduled = [];
  const router = createRouter({ storage, scheduleEnd: async (tabId) => scheduled.push(tabId) });
  const sender = { tab: { id: 7 } };
  const { meeting } = await router.handle({ type: 'session:start', code: 'abc-defg-hij' }, sender);
  await router.handle({ type: 'session:update', id: meeting.id, patch: { entries: [entry('e-1', 'Ви', 'Привіт')] } }, sender);
  await router.handle({ type: 'tab:bye' }, sender);
  assert.deepEqual(scheduled, [7]);
  assert.equal(await router.tabGone(7), true);
  assert.ok((await router.store.get(meeting.id)).endedAt);
  assert.equal(await router.tabGone(7), false, 'second call is a no-op');
});

test('router: tab:bye without a meeting does not schedule anything', async () => {
  const scheduled = [];
  const router = createRouter({ storage: memoryStorage(), scheduleEnd: async (tabId) => scheduled.push(tabId) });
  await router.handle({ type: 'tab:bye' }, { tab: { id: 3 } });
  assert.deepEqual(scheduled, []);
});

// Router with a controllable clock, recorded end timers and downloads.
function routerSetup() {
  const clock = { t: Date.UTC(2026, 8, 24, 12, 0) };
  const calls = { scheduled: [], cancelled: [], downloads: [] };
  const tabMap = memoryTabMap();
  const router = createRouter({
    storage: memoryStorage(),
    tabMap,
    now: () => clock.t,
    scheduleEnd: async (tabId) => calls.scheduled.push(tabId),
    cancelEnd: async (tabId) => calls.cancelled.push(tabId),
    download: async (file) => calls.downloads.push(file.filename),
  });
  const startWithEntry = async (code, tabId) => {
    const { meeting } = await router.handle({ type: 'session:start', code }, { tab: { id: tabId } });
    await router.handle({ type: 'session:update', id: meeting.id, patch: { entries: [entry('e-1', 'Ви', 'Привіт')] } }, { tab: { id: tabId } });
    return meeting;
  };
  return { clock, calls, router, tabMap, startWithEntry };
}

test('router: leaving the call page for another Meet page ends the meeting at once', async () => {
  // Leave call → "Return to home screen" before the content script counted the call as left: the old page
  // only managed tab:bye, and the new page's hello must not keep the meeting open.
  const { calls, router, startWithEntry } = routerSetup();
  const meeting = await startWithEntry('abc-defg-hij', 7);
  calls.cancelled.length = 0;
  await router.handle({ type: 'tab:bye' }, { tab: { id: 7 } });
  await router.handle({ type: 'tab:hello', code: null }, { tab: { id: 7 } });
  assert.ok((await router.store.get(meeting.id)).endedAt);
  assert.equal(calls.downloads.length, 1);
  assert.equal(await router.tabGone(7), false, 'the tab is no longer linked');
});

test('router: a reload of the same call keeps the pending end until the call is rejoined', async () => {
  const { calls, router, startWithEntry } = routerSetup();
  const meeting = await startWithEntry('abc-defg-hij', 7);
  calls.cancelled.length = 0;
  await router.handle({ type: 'tab:bye' }, { tab: { id: 7 } });
  await router.handle({ type: 'tab:hello', code: 'abc-defg-hij' }, { tab: { id: 7 } });
  assert.deepEqual(calls.cancelled, [], 'the pre-join screen alone does not cancel the end');
  assert.equal((await router.store.get(meeting.id)).endedAt, null);
  const res = await router.handle({ type: 'session:start', code: 'abc-defg-hij' }, { tab: { id: 7 } });
  assert.equal(res.meeting.id, meeting.id);
  assert.deepEqual(calls.cancelled, [7]);
});

test('router: sweep ends meetings that no tab is recording any more', async () => {
  const { clock, calls, router, tabMap, startWithEntry } = routerSetup();
  const live = await startWithEntry('liv-eeee-aaa', 1); // silent for a while, but its tab is still in the call
  const gone = await startWithEntry('gon-eeee-aaa', 2); // its tab was closed without onRemoved reaching us
  const orphan = await startWithEntry('orp-hhhh-aaa', 3);
  const fresh = await startWithEntry('fre-ssss-aaa', 4);
  // Extension reload / browser restart: tab links are lost (chrome.storage.session is cleared) and come back
  // only from content scripts that are still in a call.
  await tabMap.remove(3);
  await tabMap.remove(4);
  clock.t += STALE_MS + 1000;
  await router.store.update(fresh.id, {}); // updated just now: its content script may still re-link

  const ended = await router.sweep({ tabExists: async (tabId) => tabId !== 2 });
  assert.deepEqual(ended.sort(), [gone.id, orphan.id].sort());
  const saved = await router.store.get(orphan.id);
  assert.equal(saved.endedAt, saved.updatedAt, 'ends when recording actually stopped, not at sweep time');
  assert.equal((await router.store.get(live.id)).endedAt, null, 'linked to a live tab');
  assert.equal((await router.store.get(fresh.id)).endedAt, null, 'unlinked but updated recently');
  assert.equal(calls.downloads.length, 2);
  assert.deepEqual(await router.sweep({ tabExists: async () => true }), [], 'idempotent');
});
