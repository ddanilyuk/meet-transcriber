import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../extension/shared/util.js';
import '../extension/shared/format.js';
import { createRouter } from '../extension/background/router.js';

const { format } = globalThis.MT;

const at = (h, m, s = 0) => new Date(2026, 8, 24, h, m, s).getTime();
const meeting = {
  id: 'abc-defg-hij_1',
  code: 'abc-defg-hij',
  title: 'Щотижневий синк: реліз/тести?',
  language: 'Ukrainian (Ukraine)',
  startedAt: at(14, 2),
  endedAt: at(14, 47),
  entries: [
    { id: 'e-1', speaker: 'Олена Коваль', text: 'Добрий день усім.', startedAt: at(14, 2, 10) },
    { id: 'e-2', speaker: 'Олена Коваль', text: 'Почнімо з релізу.', startedAt: at(14, 3, 0) },
    { id: 'e-3', speaker: 'Андрій Мельник', text: 'Бекенд готовий.', startedAt: at(14, 4, 15) },
  ],
};

test('markdown has a header, metadata and speaker turns', () => {
  const md = format.toMarkdown(meeting);
  assert.match(md, /^# Щотижневий синк: реліз\/тести\?\n/);
  assert.match(md, /- \*\*Дата:\*\* 24\.09\.2026, 14:02–14:47 \(45 хв\)/);
  assert.match(md, /- \*\*Учасники:\*\* Олена Коваль, Андрій Мельник/);
  assert.match(md, /- \*\*Мова субтитрів:\*\* Ukrainian \(Ukraine\)/);
  // consecutive entries of one speaker are grouped under a single heading
  assert.equal(md.match(/\*\*Олена Коваль\*\*/g).length, 1);
  assert.match(md, /\*\*Олена Коваль\*\* · 14:02:10\nДобрий день усім\.\n\nПочнімо з релізу\.\n\n\*\*Андрій Мельник\*\* · 14:04:15\nБекенд готовий\.\n$/);
});

test('plain text has one timestamped line per entry', () => {
  const txt = format.toText(meeting);
  assert.match(txt, /\[14:02:10\] Олена Коваль: Добрий день усім\./);
  assert.match(txt, /\[14:04:15\] Андрій Мельник: Бекенд готовий\./);
});

test('json is machine-readable with ISO timestamps', () => {
  const data = JSON.parse(format.toJson(meeting));
  assert.equal(data.code, 'abc-defg-hij');
  assert.equal(data.entries.length, 3);
  assert.equal(data.entries[0].startedAt, new Date(at(14, 2, 10)).toISOString());
  assert.deepEqual(data.speakers, ['Олена Коваль', 'Андрій Мельник']);
});

test('file names are dated, sanitised and placed in the transcripts folder', () => {
  assert.equal(format.fileName(meeting, 'md'), 'Meet Transcripts/2026-09-24 14-02 Щотижневий синк реліз тести.md');
  assert.equal(format.fileName({ ...meeting, title: '' , code: null }, 'txt'), 'Meet Transcripts/2026-09-24 14-02 Google Meet.txt');
  assert.equal(format.fileName({ ...meeting, title: 'a'.repeat(200) }, 'json').length, 'Meet Transcripts/2026-09-24 14-02 '.length + 80 + '.json'.length);
});

test('duration falls back to the last entry for unfinished meetings', () => {
  const md = format.toMarkdown({ ...meeting, endedAt: null, entries: meeting.entries.map((e) => ({ ...e, updatedAt: e.startedAt })) });
  assert.match(md, /14:02–14:04 \(2 хв\)/);
});

function memoryStorage() {
  const data = new Map();
  return {
    async get(k) { const o = {}; for (const x of [].concat(k)) if (data.has(x)) o[x] = structuredClone(data.get(x)); return o; },
    async set(items) { for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v)); },
    async remove(k) { for (const x of [].concat(k)) data.delete(x); },
  };
}

test('ending a meeting auto-downloads Markdown when enabled and non-empty', async () => {
  const downloads = [];
  const router = createRouter({ storage: memoryStorage(), download: async (d) => downloads.push(d) });
  const sender = { tab: { id: 1 } };
  const { meeting: m } = await router.handle({ type: 'session:start', code: 'abc-defg-hij', title: 'Синк' }, sender);
  await router.handle({ type: 'session:update', id: m.id, patch: { entries: meeting.entries } }, sender);
  await router.handle({ type: 'session:end', id: m.id }, sender);
  await router.handle({ type: 'session:end', id: m.id }, sender);
  assert.equal(downloads.length, 1, 'only once');
  assert.match(downloads[0].filename, /^Meet Transcripts\/.* Синк\.md$/);
  assert.equal(downloads[0].mime, 'text/markdown');
  assert.match(downloads[0].text, /Бекенд готовий/);
});

test('no auto-download for empty meetings or when disabled', async () => {
  const downloads = [];
  const router = createRouter({ storage: memoryStorage(), download: async (d) => downloads.push(d) });
  const a = (await router.handle({ type: 'session:start', code: 'aaa-aaaa-aaa' }, {})).meeting;
  await router.handle({ type: 'session:end', id: a.id }, {});
  await router.handle({ type: 'settings:set', patch: { autoDownload: false } }, {});
  const b = (await router.handle({ type: 'session:start', code: 'bbb-bbbb-bbb' }, {})).meeting;
  await router.handle({ type: 'session:update', id: b.id, patch: { entries: meeting.entries } }, {});
  await router.handle({ type: 'session:end', id: b.id }, {});
  assert.equal(downloads.length, 0);
});

test('manual export renders the requested format', async () => {
  const downloads = [];
  const router = createRouter({ storage: memoryStorage(), download: async (d) => { downloads.push(d); return { filename: d.filename }; } });
  const m = (await router.handle({ type: 'session:start', code: 'abc-defg-hij' }, {})).meeting;
  await router.handle({ type: 'session:update', id: m.id, patch: { entries: meeting.entries } }, {});
  const res = await router.handle({ type: 'meeting:export', id: m.id, format: 'json' }, {});
  assert.match(res.filename, /\.json$/);
  assert.equal(JSON.parse(downloads[0].text).entries.length, 3);
});
