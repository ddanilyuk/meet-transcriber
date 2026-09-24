import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../extension/shared/strings.js';
import '../extension/shared/transcript.js';

const { TranscriptBuilder } = globalThis.MT;

// Builder with a controllable clock.
function setup(opts = {}) {
  const clock = { t: 1_000_000 };
  const b = new TranscriptBuilder({ now: () => clock.t, ...opts });
  const tick = (ms = 300) => { clock.t += ms; };
  const texts = () => b.snapshot().map((e) => [e.speaker, e.text]);
  return { b, clock, tick, texts };
}

const A = { id: 'block-a' };
const B = { id: 'block-b' };

test('word-by-word growth produces one entry with the final text', () => {
  const { b, tick, texts } = setup();
  for (const t of ['Добрий', 'Добрий день', 'Добрий день усім ', 'Добрий день усім це тест']) {
    b.update([{ key: A, speaker: 'Олена', text: t }]);
    tick();
  }
  assert.deepEqual(texts(), [['Олена', 'Добрий день усім це тест']]);
});

test('in-place revisions of the tail replace the text, latest wins', () => {
  const { b, tick, texts } = setup();
  b.update([{ key: A, speaker: 'Олена', text: 'перевірка субтитри' }]);
  tick();
  b.update([{ key: A, speaker: 'Олена', text: 'перевірка субтитрів' }]);
  tick();
  b.update([{ key: A, speaker: 'Олена', text: 'перевірка субтитрів.' }]);
  assert.deepEqual(texts(), [['Олена', 'перевірка субтитрів.']]);
});

test('whitespace from split text nodes is normalised', () => {
  const { b, texts } = setup();
  b.update([{ key: A, speaker: 'Олена', text: 'Добрий день  усім це тестовий мітинг для   перевірки ' }]);
  assert.deepEqual(texts(), [['Олена', 'Добрий день усім це тестовий мітинг для перевірки']]);
});

test('different blocks become separate entries in DOM order', () => {
  const { b, tick, texts } = setup();
  b.update([{ key: A, speaker: 'Олена', text: 'Привіт усім' }]);
  tick();
  b.update([
    { key: A, speaker: 'Олена', text: 'Привіт усім' },
    { key: B, speaker: 'Андрій', text: 'Привіт' },
  ]);
  tick();
  b.update([
    { key: A, speaker: 'Олена', text: 'Привіт усім' },
    { key: B, speaker: 'Андрій', text: 'Привіт, я готовий' },
  ]);
  assert.deepEqual(texts(), [['Олена', 'Привіт усім'], ['Андрій', 'Привіт, я готовий']]);
});

test('two speakers talking at once both keep updating', () => {
  const { b, tick, texts } = setup();
  b.update([{ key: A, speaker: 'Олена', text: 'Я думаю' }, { key: B, speaker: 'Андрій', text: 'Можна' }]);
  tick();
  b.update([{ key: A, speaker: 'Олена', text: 'Я думаю що так' }, { key: B, speaker: 'Андрій', text: 'Можна я скажу' }]);
  assert.deepEqual(texts(), [['Олена', 'Я думаю що так'], ['Андрій', 'Можна я скажу']]);
});

test('a pause inside one block starts a new paragraph entry', () => {
  const { b, tick, texts } = setup();
  b.update([{ key: A, speaker: 'Ви', text: 'Перше речення про реліз' }]);
  tick(6000);
  b.update([{ key: A, speaker: 'Ви', text: 'Перше речення про реліз Друге' }]);
  tick();
  b.update([{ key: A, speaker: 'Ви', text: 'Перше речення про реліз Друге речення вже про тести' }]);
  const entries = b.snapshot();
  assert.equal(entries.length, 2);
  assert.deepEqual(texts(), [['Ви', 'Перше речення про реліз'], ['Ви', 'Друге речення вже про тести']]);
  assert.ok(entries[1].startedAt > entries[0].startedAt);
});

test('a split never cuts a word when the tail is revised at the same time', () => {
  const { b, tick, texts } = setup();
  b.update([{ key: A, speaker: 'Ви', text: 'Привіт усім' }]);
  tick(5000);
  b.update([{ key: A, speaker: 'Ви', text: 'Привіт усім. Як справи' }]);
  assert.deepEqual(texts(), [['Ви', 'Привіт усім.'], ['Ви', 'Як справи']]);
});

test('continuous speech without pauses stays one entry', () => {
  const { b, tick } = setup();
  let text = '';
  for (let i = 0; i < 60; i++) {
    text += `слово${i} `;
    b.update([{ key: A, speaker: 'Ви', text }]);
    tick(330);
  }
  assert.equal(b.snapshot().length, 1);
  assert.ok(b.snapshot()[0].text.endsWith('слово59'));
});

test('head truncation keeps earlier text and appends new words', () => {
  const { b, tick, texts } = setup();
  const head = 'Це дуже довгий монолог про плани команди на квартал і не тільки. ';
  const middle = 'Ми обговоримо бекенд, фронтенд, тестування і реліз у пʼятницю ввечері. ';
  b.update([{ key: A, speaker: 'Ви', text: head + middle }]);
  tick();
  // Meet drops the head and keeps appending.
  b.update([{ key: A, speaker: 'Ви', text: middle + 'Ще одне речення.' }]);
  assert.deepEqual(texts(), [['Ви', (head + middle + 'Ще одне речення.').replace(/\s+/g, ' ').trim()]]);
});

test('head truncation after a paragraph split freezes the scrolled-out paragraph', () => {
  const { b, tick, texts } = setup();
  const p1 = 'Перший абзац, який буде повністю обрізаний Meet після довгої промови. ';
  const p2 = 'Другий абзац лишається у вікні субтитрів і продовжує рости далі. ';
  b.update([{ key: A, speaker: 'Ви', text: p1 }]);
  tick(5000);
  b.update([{ key: A, speaker: 'Ви', text: p1 + p2 }]);
  tick();
  b.update([{ key: A, speaker: 'Ви', text: p2 + 'Кінець.' }]);
  assert.deepEqual(texts(), [['Ви', p1.trim()], ['Ви', (p2 + 'Кінець.').trim()]]);
});

test('a re-rendered block adopts the old entries instead of duplicating them', () => {
  const { b, tick, texts } = setup();
  b.update([{ key: A, speaker: 'Олена', text: 'Добрий день усім, почнімо з релізу' }]);
  tick();
  // Meet replaces the DOM: key A disappears, key B shows the same text.
  b.update([{ key: B, speaker: 'Олена', text: 'Добрий день усім, почнімо з релізу' }]);
  tick();
  b.update([{ key: B, speaker: 'Олена', text: 'Добрий день усім, почнімо з релізу і тестів' }]);
  assert.deepEqual(texts(), [['Олена', 'Добрий день усім, почнімо з релізу і тестів']]);
});

test('re-rendered history with several blocks is not duplicated', () => {
  const { b, tick } = setup();
  const K1 = {}, K2 = {}, K3 = {}, K4 = {};
  b.update([{ key: K1, speaker: 'Олена', text: 'Перша репліка Олени про план' }, { key: K2, speaker: 'Андрій', text: 'Відповідь Андрія про тести' }]);
  tick();
  b.update([{ key: K3, speaker: 'Олена', text: 'Перша репліка Олени про план' }, { key: K4, speaker: 'Андрій', text: 'Відповідь Андрія про тести' }]);
  assert.equal(b.snapshot().length, 2);
});

test('an old released block is not adopted by new speech after the window', () => {
  const { b, tick } = setup();
  b.update([{ key: A, speaker: 'Олена', text: 'Так, погоджуюсь з цим планом' }]);
  tick(20000);
  b.update([]);
  tick(20000);
  b.update([{ key: B, speaker: 'Олена', text: 'Так, погоджуюсь з цим планом' }]);
  assert.equal(b.snapshot().length, 2);
});

test('rows without a speaker (system notices) are ignored', () => {
  const { b, texts } = setup();
  b.update([{ key: A, speaker: '', text: 'Your camera is off' }, { key: B, speaker: 'Ви', text: 'Привіт' }]);
  assert.deepEqual(texts(), [['Ви', 'Привіт']]);
});

test('the "You" label resolves to the own name once it is known', () => {
  const { b, tick, texts } = setup();
  b.update([{ key: A, speaker: 'You', text: 'Привіт' }]);
  assert.deepEqual(texts(), [['Ви', 'Привіт']]);
  tick();
  assert.equal(b.setSelfName('Denys Danyliuk'), true);
  b.update([{ key: A, speaker: 'You', text: 'Привіт усім' }]);
  assert.deepEqual(texts(), [['Denys Danyliuk', 'Привіт усім']]);
});

test('liveId points at the segment that is still changing', () => {
  const { b, tick } = setup();
  let r = b.update([{ key: A, speaker: 'Ви', text: 'Раз два' }]);
  assert.equal(r.liveId, b.snapshot()[0].id);
  tick(5000);
  r = b.update([{ key: A, speaker: 'Ви', text: 'Раз два' }]);
  assert.equal(r.liveId, null);
  assert.equal(r.changed, true, 'live state change is reported so the UI can drop the highlight');
});

test('load() restores entries and continues ids without collisions', () => {
  const first = setup();
  first.b.update([{ key: A, speaker: 'Ви', text: 'До перезавантаження' }]);
  const saved = JSON.parse(JSON.stringify(first.b.snapshot()));

  const { b, texts } = setup();
  b.load(saved);
  b.update([{ key: B, speaker: 'Ви', text: 'Після перезавантаження' }]);
  const ids = b.snapshot().map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(texts(), [['Ви', 'До перезавантаження'], ['Ви', 'Після перезавантаження']]);
});

test('unchanged snapshots report no change', () => {
  const { b, tick } = setup();
  b.update([{ key: A, speaker: 'Ви', text: 'Тиша' }]);
  tick(5000);
  b.update([{ key: A, speaker: 'Ви', text: 'Тиша' }]);
  tick();
  const r = b.update([{ key: A, speaker: 'Ви', text: 'Тиша' }]);
  assert.equal(r.changed, false);
});
