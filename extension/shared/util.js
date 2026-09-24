// Small pure helpers shared by the content script, the archive page, the service worker and tests.
(function (root) {
  const MT = (root.MT = root.MT || {});

  const AVATAR_COLORS = ['#1a73e8', '#d93025', '#188038', '#e8710a', '#9334e6', '#e52592', '#12a4af', '#b06000'];

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatTime(ts, withSeconds = false) {
    const d = new Date(ts);
    const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    return withSeconds ? `${hm}:${pad2(d.getSeconds())}` : hm;
  }

  function formatDate(ts) {
    const d = new Date(ts);
    return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
  }

  function formatDuration(ms) {
    const min = Math.max(0, Math.round(ms / 60000));
    if (min < 60) return `${min} хв`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} год ${m} хв` : `${h} год`;
  }

  // Meet shows a single letter in avatar fallbacks.
  function initials(name) {
    return (String(name || '').trim()[0] || '?').toUpperCase();
  }

  function avatarColor(name) {
    return AVATAR_COLORS[hash(String(name || '')) % AVATAR_COLORS.length];
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Escapes `text` and wraps case-insensitive matches of `query` in <mark>.
  function highlight(text, query) {
    const safe = escapeHtml(text);
    const q = String(query || '').trim();
    if (!q) return safe;
    const re = new RegExp(escapeRegExp(escapeHtml(q)), 'gi');
    return safe.replace(re, (m) => `<mark class="mt-hl">${m}</mark>`);
  }

  function matches(text, query) {
    const q = String(query || '').trim().toLowerCase();
    return !q || String(text || '').toLowerCase().includes(q);
  }

  // Groups consecutive entries of the same speaker into turns: [{speaker, startedAt, entries: [...]}].
  function groupTurns(entries) {
    const turns = [];
    for (const e of entries) {
      const last = turns[turns.length - 1];
      if (last && last.speaker === e.speaker) last.entries.push(e);
      else turns.push({ speaker: e.speaker, startedAt: e.startedAt, entries: [e] });
    }
    return turns;
  }

  MT.util = { escapeHtml, formatTime, formatDate, formatDuration, initials, avatarColor, highlight, matches, groupTurns, pad2 };
})(globalThis);
