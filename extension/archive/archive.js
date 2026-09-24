// Archive page: every recorded meeting, full-text search, rename, export and delete.
// Reads chrome.storage.local directly; all writes go through the service worker (the single writer).
const { util, format, icon, t } = globalThis.MT;
const { escapeHtml: esc, formatTime, formatDuration, avatarColor, initials, highlight, matches, groupTurns } = util;

const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

const state = {
  index: [],
  cache: new Map(), // id -> full meeting
  selectedId: null,
  query: '',
  hits: new Map(), // id -> number of matching entries
  settings: null,
};

const $ = (sel) => document.querySelector(sel);
const listEl = $('#meeting-list');
const detailEl = $('#detail');

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res?.ok) return reject(new Error(res?.error || 'No response'));
      resolve(res.result);
    });
  });
}

function hydrateIcons(rootEl = document) {
  for (const el of rootEl.querySelectorAll('[data-icon]')) {
    if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size || 24));
  }
}

let snackTimer;
function toast(text) {
  const el = $('#snackbar');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

// ---------- data ----------

async function loadIndex() {
  state.index = (await chrome.storage.local.get('meetings')).meetings || [];
}

async function loadMeeting(id, force = false) {
  if (!force && state.cache.has(id)) return state.cache.get(id);
  const m = (await chrome.storage.local.get(`meeting:${id}`))[`meeting:${id}`] || null;
  if (m) state.cache.set(id, m);
  return m;
}

async function loadAll() {
  const missing = state.index.filter((m) => !state.cache.has(m.id)).map((m) => `meeting:${m.id}`);
  if (!missing.length) return;
  const got = await chrome.storage.local.get(missing);
  for (const m of Object.values(got)) state.cache.set(m.id, m);
}

async function computeHits() {
  state.hits.clear();
  const q = state.query.trim();
  if (!q) return;
  await loadAll();
  for (const meta of state.index) {
    const m = state.cache.get(meta.id);
    if (!m) continue;
    let n = m.entries.filter((e) => matches(e.text, q) || matches(e.speaker, q)).length;
    if (matches(m.title, q)) n = Math.max(n, 1);
    if (n) state.hits.set(m.id, n);
  }
}

// ---------- list ----------

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (diff === 0) return 'Сьогодні';
  if (diff === 1) return 'Вчора';
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === today.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

function avatars(speakers) {
  const shown = speakers.slice(0, 5);
  const more = speakers.length - shown.length;
  return `<div class="avatars">${shown.map((s) => `<span class="av" style="background:${avatarColor(s)}" title="${esc(s)}">${esc(initials(s))}</span>`).join('')}${more > 0 ? `<span class="more">+${more}</span>` : ''}</div>`;
}

function renderList() {
  const q = state.query.trim();
  const items = q ? state.index.filter((m) => state.hits.has(m.id)) : state.index;
  if (!state.index.length) {
    listEl.innerHTML = '<p class="list-empty">Поки що немає записаних мітингів.</p>';
    return;
  }
  if (!items.length) {
    listEl.innerHTML = `<p class="list-empty">${t.searchNone}</p>`;
    return;
  }
  let html = '';
  let lastDay = null;
  for (const m of items) {
    const day = dayLabel(m.startedAt);
    if (day !== lastDay) {
      html += `<div class="group-label">${day}</div>`;
      lastDay = day;
    }
    const end = m.endedAt || m.updatedAt;
    const live = !m.endedAt && Date.now() - m.updatedAt < 2 * 60 * 1000;
    const hits = state.hits.get(m.id);
    html += `
      <button class="meeting${m.id === state.selectedId ? ' is-selected' : ''}" data-id="${esc(m.id)}">
        <span class="meeting-title">${highlight(m.title || m.code, q)}</span>
        <span class="meeting-sub">
          ${live ? '<span class="meeting-live">Записується</span>' : ''}
          <span>${formatTime(m.startedAt)}–${formatTime(end)} · ${formatDuration(end - m.startedAt)} · ${m.entryCount} реплік</span>
          ${hits ? `<span class="meeting-hits">${hits}</span>` : ''}
        </span>
        ${m.speakers?.length ? avatars(m.speakers) : ''}
      </button>`;
  }
  listEl.innerHTML = html;
}

// ---------- detail ----------

function renderEmptyDetail() {
  detailEl.innerHTML = `
    <div class="empty">
      <div class="empty-art">${icon('transcript', 48)}</div>
      <h2>${state.index.length ? 'Оберіть мітинг' : 'Тут зʼявляться ваші мітинги'}</h2>
      <p>${state.index.length
        ? 'Виберіть мітинг зліва, щоб переглянути транскрипт.'
        : 'Приєднайтеся до дзвінка в Google Meet — розширення само ввімкне субтитри й почне зберігати транскрипт.'}</p>
    </div>`;
}

async function renderDetail({ keepScroll = false } = {}) {
  const id = state.selectedId;
  if (!id) return renderEmptyDetail();
  const m = await loadMeeting(id);
  if (!m) return renderEmptyDetail();
  const q = state.query.trim();
  const end = m.endedAt || m.updatedAt;
  const speakers = [...new Set(m.entries.map((e) => e.speaker))];
  const prevScroll = detailEl.scrollTop;
  const atBottom = detailEl.scrollHeight - detailEl.scrollTop - detailEl.clientHeight < 40;

  const turns = groupTurns(m.entries)
    .map((tr) => `
      <article class="turn">
        <div class="av" style="background:${avatarColor(tr.speaker)}">${esc(initials(tr.speaker))}</div>
        <div class="turn-main">
          <div class="turn-head"><span class="turn-speaker">${highlight(tr.speaker, q)}</span><span class="turn-time">${formatTime(tr.startedAt, true)}</span></div>
          ${tr.entries.map((e, i) => `<p class="seg">${i ? `<span class="seg-time">${formatTime(e.startedAt)}</span>` : ''}${highlight(e.text, q)}</p>`).join('')}
        </div>
      </article>`)
    .join('');

  detailEl.innerHTML = `
    <div class="detail-head">
      <div class="detail-title-row">
        <h1 class="detail-title" id="title">${esc(m.title || m.code)}</h1>
        <button class="icon-btn" data-action="rename" aria-label="Перейменувати" title="Перейменувати">${icon('edit', 20)}</button>
      </div>
      <div class="chips">
        <span class="chip">${icon('history', 18)}${util.formatDate(m.startedAt)}, ${formatTime(m.startedAt)}–${formatTime(end)} · ${formatDuration(end - m.startedAt)}</span>
        ${m.code ? `<span class="chip">${icon('openInNew', 18)}${esc(m.code)}</span>` : ''}
        ${m.language ? `<span class="chip">${icon('language', 18)}${esc(m.language)}</span>` : ''}
        <span class="chip">${icon('transcript', 18)}${m.entries.length} реплік · ${speakers.length} учасн.</span>
      </div>
      <div class="actions">
        <button class="btn is-filled" data-action="copy">${icon('copy', 18)}Копіювати</button>
        <button class="btn" data-action="download-menu">${icon('download', 18)}Завантажити</button>
        <button class="btn is-danger" data-action="delete">${icon('delete', 18)}Видалити</button>
      </div>
    </div>
    <div class="transcript">${turns || `<div class="empty"><p>У цьому мітингу поки немає реплік.</p></div>`}</div>`;

  if (keepScroll) detailEl.scrollTop = atBottom ? detailEl.scrollHeight : prevScroll;
  else if (q) detailEl.querySelector('mark')?.scrollIntoView({ block: 'center' });
}

async function select(id, { updateHash = true } = {}) {
  state.selectedId = id;
  if (updateHash) history.replaceState(null, '', id ? `#${encodeURIComponent(id)}` : location.pathname);
  renderList();
  await renderDetail();
}

// ---------- actions ----------

function closeMenus() {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
}

function openDownloadMenu(anchor) {
  closeMenus();
  const r = anchor.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.style.left = `${r.left}px`;
  menu.style.top = `${r.bottom + 4 + scrollY}px`;
  menu.innerHTML = ['md', 'txt', 'json']
    .map((f) => `<button data-format="${f}">${icon('download', 20)}${{ md: t.formatMd, txt: t.formatTxt, json: t.formatJson }[f]}</button>`)
    .join('');
  menu.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-format]');
    if (!b) return;
    closeMenus();
    await send('meeting:export', { id: state.selectedId, format: b.dataset.format });
    toast(t.downloaded);
  });
  document.body.append(menu);
}

function dialog(html) {
  const scrim = $('#scrim');
  scrim.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">${html}</div>`;
  scrim.hidden = false;
  hydrateIcons(scrim);
  return new Promise((resolve) => {
    const close = (v) => { scrim.hidden = true; scrim.innerHTML = ''; resolve(v); };
    scrim.onclick = (e) => {
      if (e.target === scrim) return close(null);
      const b = e.target.closest('[data-result]');
      if (b) close(b.dataset.result);
    };
    scrim.onkeydown = (e) => { if (e.key === 'Escape') close(null); };
    scrim.querySelector('[data-result="ok"], button')?.focus();
  });
}

async function confirmDelete() {
  const m = state.cache.get(state.selectedId);
  const ok = await dialog(`
    <h2>Видалити транскрипт?</h2>
    <p>«${esc(m?.title || '')}» буде видалено з архіву. Цю дію не можна скасувати.</p>
    <div class="dialog-actions">
      <button class="btn" data-result="cancel">Скасувати</button>
      <button class="btn is-danger" data-result="ok">Видалити</button>
    </div>`);
  if (ok !== 'ok') return;
  const id = state.selectedId;
  await send('meeting:delete', { id });
  state.cache.delete(id);
  await loadIndex();
  await select(state.index[0]?.id || null);
  toast('Транскрипт видалено');
}

function startRename() {
  const el = $('#title');
  const original = el.textContent;
  el.contentEditable = 'true';
  el.focus();
  document.getSelection().selectAllChildren(el);
  const finish = async (save) => {
    el.contentEditable = 'false';
    el.onkeydown = el.onblur = null;
    const title = el.textContent.trim();
    if (save && title && title !== original) {
      await send('meeting:rename', { id: state.selectedId, title });
      toast('Назву змінено');
    } else el.textContent = original;
  };
  el.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') finish(false);
  };
  el.onblur = () => finish(true);
}

async function copyTranscript() {
  const m = await loadMeeting(state.selectedId);
  await navigator.clipboard.writeText(format.toMarkdown(m));
  toast(t.copied);
}

async function openSettings() {
  state.settings = await send('settings:get');
  const row = (key, label, hint) => `
    <div class="setting" data-key="${key}" role="switch" aria-checked="${!!state.settings[key]}" tabindex="0">
      <span class="setting-text"><span>${label}</span><span class="setting-hint">${hint}</span></span>
      <span class="switch" aria-checked="${!!state.settings[key]}"></span>
    </div>`;
  const scrimPromise = dialog(`
    <h2>${t.settings}</h2>
    ${row('autoCaptions', t.settingAutoCaptions, t.settingAutoCaptionsHint)}
    ${row('autoUkrainian', t.settingAutoUkrainian, t.settingAutoUkrainianHint)}
    ${row('autoDownload', t.settingAutoDownload, t.settingAutoDownloadHint)}
    ${row('showOverlay', t.overlayToggle, 'Показувати рідні субтитри Meet поверх відео')}
    <div class="dialog-actions"><button class="btn" data-result="ok">Готово</button></div>`);
  const scrim = $('#scrim');
  const toggle = async (el) => {
    const key = el.dataset.key;
    const value = !state.settings[key];
    state.settings = await send('settings:set', { patch: { [key]: value } });
    el.setAttribute('aria-checked', String(value));
    el.querySelector('.switch').setAttribute('aria-checked', String(value));
  };
  scrim.addEventListener('click', (e) => { const s = e.target.closest('.setting'); if (s) toggle(s); });
  scrim.addEventListener('keydown', (e) => { const s = e.target.closest('.setting'); if (s && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); toggle(s); } });
  await scrimPromise;
}

// ---------- wiring ----------

listEl.addEventListener('click', (e) => {
  const b = e.target.closest('.meeting');
  if (b) select(b.dataset.id);
});

detailEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const action = b.dataset.action;
  if (action === 'copy') copyTranscript();
  if (action === 'download-menu') openDownloadMenu(b);
  if (action === 'delete') confirmDelete();
  if (action === 'rename') startRename();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu') && !e.target.closest('[data-action="download-menu"]')) closeMenus();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

let searchTimer;
$('#search').addEventListener('input', (e) => {
  const value = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    state.query = value;
    await computeHits();
    const visible = !state.query.trim() || state.hits.has(state.selectedId);
    if (!visible) state.selectedId = [...state.hits.keys()][0] || state.selectedId;
    renderList();
    await renderDetail();
  }, 150);
});

$('#open-settings').addEventListener('click', openSettings);

addEventListener('hashchange', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id && id !== state.selectedId) select(id, { updateHash: false });
});

// Live updates while a meeting is being recorded in another tab.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.meetings) {
    state.index = changes.meetings.newValue || [];
    if (state.query.trim()) await computeHits();
    renderList();
  }
  for (const [k, change] of Object.entries(changes)) {
    if (!k.startsWith('meeting:')) continue;
    const id = k.slice('meeting:'.length);
    if (change.newValue) state.cache.set(id, change.newValue);
    else state.cache.delete(id);
    if (id === state.selectedId) await renderDetail({ keepScroll: true });
  }
});

(async function init() {
  hydrateIcons();
  await loadIndex();
  const fromHash = decodeURIComponent(location.hash.slice(1));
  const id = state.index.some((m) => m.id === fromHash) ? fromHash : state.index[0]?.id || null;
  await select(id, { updateHash: !!id });
})();
