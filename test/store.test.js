import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, DEFAULT_SETTINGS, RESUME_IDLE_MS } from '../extension/background/store.js';
import { createRouter, memoryTabMap, STALE_MS, DRIVE_RETRY_MIN, DRIVE_IN_FLIGHT_MS } from '../extension/background/router.js';

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

test('meetings without a code never resume each other', async () => {
  const { store, clock } = setup();
  const first = await store.start({ code: null, title: 'Eng Management Sync' });
  clock.t += 60_000;
  const second = await store.start({ code: null, title: 'Meet' });
  assert.equal(second.resumed, false);
  assert.notEqual(second.meeting.id, first.meeting.id);
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

// ---------- Google Drive copy ----------

// Router with a fake Drive: uploads are recorded, `fail` makes the next ones throw, `gate` holds them open.
function driveSetup({ enabled = true } = {}) {
  const clock = { t: Date.UTC(2026, 8, 24, 12, 0) };
  const storage = memoryStorage();
  const fake = { uploads: [], connected: true, fail: null, gate: null, nextId: 1 };
  const drive = {
    connected: async () => fake.connected,
    upload: async (file) => {
      fake.uploads.push(file);
      if (fake.gate) await fake.gate;
      if (fake.fail) throw fake.fail;
      return { fileId: file.fileId || `file-${fake.nextId++}` };
    },
  };
  const router = createRouter({ storage, drive, now: () => clock.t });
  const record = async (code = 'abc-defg-hij', tabId = 7) => {
    const { meeting } = await router.handle({ type: 'session:start', code, title: 'Синк' }, { tab: { id: tabId } });
    await router.handle({ type: 'session:update', id: meeting.id, patch: { entries: [entry('e-1', 'Ви', 'Привіт')] } }, { tab: { id: tabId } });
    return meeting;
  };
  const end = (id, tabId = 7) => router.handle({ type: 'session:end', id }, { tab: { id: tabId } });
  const ready = enabled ? router.handle({ type: 'settings:set', patch: { driveUpload: true } }) : Promise.resolve();
  return { clock, storage, fake, router, record, end, ready };
}

const authError = () => Object.assign(new Error('sign in again'), { kind: 'auth' });

test('drive: nothing is uploaded unless the setting is on', async () => {
  const { fake, router, record, end } = driveSetup({ enabled: false });
  const meeting = await record();
  await end(meeting.id);
  assert.equal(fake.uploads.length, 0);
  assert.equal((await router.store.get(meeting.id)).drive, undefined);
  assert.equal((await router.store.list())[0].drive, null);
});

test('drive: an ended meeting is uploaded as Markdown and remembers its file', async () => {
  const { fake, router, record, end, ready, clock } = driveSetup();
  await ready;
  const meeting = await record();
  await end(meeting.id);
  assert.equal(fake.uploads.length, 1);
  assert.equal(fake.uploads[0].fileId, null);
  assert.match(fake.uploads[0].name, /^\d{4}-\d\d-\d\d \d\d-\d\d Синк\.md$/, 'no local folder prefix');
  assert.ok(fake.uploads[0].text.includes('Привіт'));
  const saved = await router.store.get(meeting.id);
  assert.deepEqual(saved.drive, { fileId: 'file-1', attempts: 0, nextAt: null, error: null, uploadedAt: clock.t, status: 'done' });
  assert.equal((await router.store.list())[0].drive, 'done');
});

test('drive: empty meetings are dropped, not uploaded', async () => {
  const { fake, router, end, ready } = driveSetup();
  await ready;
  const { meeting } = await router.handle({ type: 'session:start', code: 'abc-defg-hij' }, { tab: { id: 7 } });
  await end(meeting.id);
  assert.equal(fake.uploads.length, 0);
});

test('drive: the pending state is stored before the network call', async () => {
  const { fake, router, record, end, ready, clock } = driveSetup();
  await ready;
  const meeting = await record();
  let release;
  fake.gate = new Promise((r) => { release = r; });
  const ending = end(meeting.id);
  while (!fake.uploads.length) await new Promise((r) => setImmediate(r));
  const during = (await router.store.get(meeting.id)).drive;
  assert.equal(during.status, 'pending');
  assert.equal(during.nextAt, clock.t + DRIVE_IN_FLIGHT_MS);
  release();
  await ending;
  assert.equal((await router.store.get(meeting.id)).drive.status, 'done');
});

test('drive: a failed upload is retried by the sweep only after its pause', async () => {
  const { fake, router, record, end, ready, clock } = driveSetup();
  await ready;
  const meeting = await record();
  fake.fail = new Error('offline');
  await end(meeting.id);
  let state = (await router.store.get(meeting.id)).drive;
  assert.equal(state.status, 'error');
  assert.equal(state.attempts, 1);
  assert.equal(state.error, 'offline');
  assert.equal(state.nextAt, clock.t + DRIVE_RETRY_MIN[0] * 60_000);

  fake.fail = null;
  clock.t += 30_000;
  await router.sweep();
  assert.equal(fake.uploads.length, 1, 'too early');
  clock.t += 31_000;
  await router.sweep();
  assert.equal(fake.uploads.length, 2);
  state = (await router.store.get(meeting.id)).drive;
  assert.equal(state.status, 'done');
  assert.equal(state.attempts, 0);
  await router.sweep();
  assert.equal(fake.uploads.length, 2, 'done copies are left alone');
});

test('drive: automatic retries stop after the last pause', async () => {
  const { fake, router, record, end, ready, clock } = driveSetup();
  await ready;
  const meeting = await record();
  fake.fail = new Error('offline');
  await end(meeting.id);
  for (let i = 0; i < DRIVE_RETRY_MIN.length + 3; i++) {
    clock.t += 24 * 3600_000;
    await router.sweep();
  }
  assert.equal(fake.uploads.length, DRIVE_RETRY_MIN.length + 1);
  const state = (await router.store.get(meeting.id)).drive;
  assert.equal(state.status, 'error');
  assert.equal(state.nextAt, null);
  fake.fail = null;
  assert.equal((await router.handle({ type: 'meeting:upload', id: meeting.id })).status, 'done', 'the manual retry still works');
});

test('drive: triggers at the same time never create two files', async () => {
  const { fake, router, record, end, ready } = driveSetup();
  await ready;
  const meeting = await record();
  let release;
  fake.gate = new Promise((r) => { release = r; });
  const all = Promise.all([end(meeting.id), router.handle({ type: 'meeting:upload', id: meeting.id }), router.sweep()]);
  while (!fake.uploads.length) await new Promise((r) => setImmediate(r));
  release();
  await all;
  assert.deepEqual(fake.uploads.map((u) => u.fileId), [null, 'file-1'], 'the second upload updates the first file');
  assert.equal((await router.store.get(meeting.id)).drive.fileId, 'file-1');
});

test('drive: ending a resumed meeting updates the same file', async () => {
  const { fake, router, record, end, ready, clock } = driveSetup();
  await ready;
  const meeting = await record();
  await end(meeting.id);
  clock.t += 60_000;
  const again = await router.handle({ type: 'session:start', code: 'abc-defg-hij' }, { tab: { id: 7 } });
  assert.equal(again.meeting.id, meeting.id);
  await router.sweep();
  assert.equal(fake.uploads.length, 1, 'a meeting in progress is not uploaded by the sweep');
  await router.handle({ type: 'session:update', id: meeting.id, patch: { entries: [entry('e-1', 'Ви', 'Привіт'), entry('e-2', 'Ви', 'Ще')] } }, { tab: { id: 7 } });
  await end(meeting.id);
  assert.equal(fake.uploads.length, 2);
  assert.equal(fake.uploads[1].fileId, 'file-1');
  assert.ok(fake.uploads[1].text.includes('Ще'));
});

test('drive: without a sign-in the meeting waits, and drive:resume uploads it', async () => {
  const { fake, router, record, end, ready, clock } = driveSetup();
  await ready;
  fake.connected = false;
  const meeting = await record();
  await end(meeting.id);
  assert.equal(fake.uploads.length, 0);
  assert.equal((await router.store.get(meeting.id)).drive.status, 'auth');
  clock.t += 3600_000;
  await router.sweep();
  assert.equal(fake.uploads.length, 0, 'never retried on its own');
  fake.connected = true;
  await router.handle({ type: 'drive:resume' });
  assert.equal(fake.uploads.length, 1);
  assert.equal((await router.store.get(meeting.id)).drive.status, 'done');
});

test('drive: an expired sign-in parks the upload until the user signs in again', async () => {
  const { fake, router, record, end, ready, clock } = driveSetup();
  await ready;
  const meeting = await record();
  fake.fail = authError();
  await end(meeting.id);
  const state = (await router.store.get(meeting.id)).drive;
  assert.equal(state.status, 'auth');
  assert.equal(state.nextAt, null);
  clock.t += 3600_000;
  await router.sweep();
  assert.equal(fake.uploads.length, 1);
});

test('drive: a rename follows to Drive, a delete does not', async () => {
  const { fake, router, record, end, ready } = driveSetup();
  await ready;
  const meeting = await record();
  await end(meeting.id);
  await router.handle({ type: 'meeting:rename', id: meeting.id, title: 'Планування' });
  assert.equal(fake.uploads.length, 2);
  assert.equal(fake.uploads[1].fileId, 'file-1');
  assert.match(fake.uploads[1].name, / Планування\.md$/);
  await router.handle({ type: 'meeting:delete', id: meeting.id });
  assert.equal(fake.uploads.length, 2);
});

test('drive: renaming a meeting that was never uploaded does not upload it', async () => {
  const { fake, router, record, end } = driveSetup({ enabled: false });
  const meeting = await record();
  await end(meeting.id);
  await router.handle({ type: 'meeting:rename', id: meeting.id, title: 'Планування' });
  assert.equal(fake.uploads.length, 0);
});

test('drive: manual upload works for old meetings and without the setting', async () => {
  const { fake, router, record, end } = driveSetup({ enabled: false });
  const meeting = await record();
  await end(meeting.id);
  const state = await router.handle({ type: 'meeting:upload', id: meeting.id });
  assert.equal(state.status, 'done');
  assert.equal(fake.uploads.length, 1);
  await assert.rejects(router.handle({ type: 'meeting:upload', id: 'nope' }), /not found/);
  const plain = createRouter({ storage: memoryStorage() });
  await assert.rejects(plain.handle({ type: 'meeting:upload', id: meeting.id }), /not available/);
});
