// HTML templates for the sidebar. Pure functions of a view model, shared by the live sidebar and design/mockup.html.
(function (root) {
  const MT = (root.MT = root.MT || {});
  const { escapeHtml: esc, formatTime, initials, avatarColor, highlight } = MT.util;
  const t = MT.t;
  const icon = MT.icon;

  function statusChip(status) {
    if (status === 'recording') return `<span class="mt-chip is-recording"><span class="mt-dot"></span>${t.statusRecording}</span>`;
    if (status === 'off' || status === 'notfound') return `<span class="mt-chip is-warning">${t.statusCaptionsOff}</span>`;
    if (status === 'ended') return `<span class="mt-chip">${t.statusEnded}</span>`;
    return `<span class="mt-chip">${t.statusWaiting}</span>`;
  }

  function header(vm) {
    return `
      <header class="mt-header">
        <h2 class="mt-title">${t.panelTitle}</h2>
        ${statusChip(vm.status)}
        <button class="mt-icon-btn" data-action="close" aria-label="${t.closePanel}" data-tooltip="${t.closePanel}" data-tooltip-pos="bottom">${icon('close')}</button>
      </header>`;
  }

  function meta(vm) {
    const m = vm.meeting || {};
    const parts = [];
    if (m.title) parts.push(`<span class="mt-meta-title" title="${esc(m.title)}">${esc(m.title)}</span>`);
    if (m.startedAt) parts.push(`<span>${t.since} ${formatTime(m.startedAt)}</span>`);
    const lang = m.language
      ? `<span class="mt-lang${m.languageOk === false ? ' is-wrong' : ''}">${icon('language', 14)}${esc(m.language)}</span>`
      : '';
    return `<div class="mt-meta">${parts.join('<span class="mt-meta-sep">·</span>')}${lang}</div>`;
  }

  function search(vm) {
    const count = vm.query ? `<span class="mt-search-count">${vm.matchCount ? t.searchCount(vm.matchCount) : t.searchNone}</span>` : '';
    return `
      <label class="mt-search">
        ${icon('search', 20)}
        <input type="search" data-role="search" placeholder="${t.searchPlaceholder}" value="${esc(vm.query || '')}" autocomplete="off" spellcheck="false">
        ${count}
      </label>`;
  }

  function banner(b) {
    if (!b) return '';
    if (b.kind === 'lang') {
      return `
        <div class="mt-banner" role="status">
          ${icon('language', 20)}
          <div class="mt-banner-body">
            <strong>${t.langBannerTitle}</strong>
            <span>${esc(t.langBannerText(b.lang))}</span>
            <div class="mt-banner-actions">
              <button class="mt-btn is-text" data-action="dismiss-banner">${t.langBannerDismiss}</button>
              <button class="mt-btn is-text" data-action="set-ukrainian">${t.langBannerAction}</button>
            </div>
          </div>
        </div>`;
    }
    if (b.kind === 'reload') {
      return `
        <div class="mt-banner is-warning" role="alert">
          ${icon('warning', 20)}
          <div class="mt-banner-body"><strong>${t.reloadBannerTitle}</strong><span>${t.reloadBannerText}</span></div>
        </div>`;
    }
    return '';
  }

  function segment(entry, query, isLive, showTime) {
    const time = showTime ? `<span class="mt-seg-time">${formatTime(entry.startedAt)}</span>` : '';
    return `<div class="mt-seg${isLive ? ' is-live' : ''}" data-id="${esc(entry.id)}">${time}${highlight(entry.text, query)}</div>`;
  }

  function turn(tr, query, liveId) {
    const isLiveTurn = tr.entries.some((e) => e.id === liveId);
    const lastIsLive = tr.entries[tr.entries.length - 1].id === liveId;
    const timeLabel = lastIsLive && tr.entries.length === 1 ? `<span class="mt-live-label">${t.now}</span>` : formatTime(tr.startedAt);
    return `
      <article class="mt-turn${isLiveTurn ? ' has-live' : ''}" data-turn="${esc(tr.entries[0].id)}">
        <div class="mt-avatar" style="background:${avatarColor(tr.speaker)}" aria-hidden="true">${esc(initials(tr.speaker))}</div>
        <div class="mt-turn-main">
          <div class="mt-turn-head"><span class="mt-speaker">${esc(tr.speaker)}</span><span class="mt-time">${timeLabel}</span></div>
          ${tr.entries.map((e, i) => segment(e, query, e.id === liveId, i > 0)).join('')}
        </div>
      </article>`;
  }

  function empty(kind) {
    const map = {
      waiting: ['transcript', t.emptyTitle, t.emptyText, ''],
      off: ['captions', t.offTitle, t.offText, `<button class="mt-btn is-filled" data-action="enable-captions">${t.offAction}</button>`],
      notfound: ['warning', t.notFoundTitle, t.notFoundText, ''],
      search: ['search', t.searchEmptyTitle, t.searchEmptyText, ''],
    };
    const [ic, title, text, action] = map[kind] || map.waiting;
    return `
      <div class="mt-empty">
        <div class="mt-empty-art">${icon(ic, 32)}</div>
        <p class="mt-empty-title">${title}</p>
        <p class="mt-empty-text">${text}</p>
        ${action}
      </div>`;
  }

  function footer(vm) {
    const on = !!vm.settings?.showOverlay;
    return `
      <footer class="mt-footer">
        <label class="mt-footer-toggle">
          <button class="mt-switch" role="switch" aria-checked="${on}" data-action="toggle-overlay" aria-label="${t.overlayToggle}"></button>
          <span>${t.overlayToggle}</span>
        </label>
        <button class="mt-icon-btn" data-action="copy" aria-label="${t.copy}" data-tooltip="${t.copy}">${icon('copy', 20)}</button>
        <button class="mt-icon-btn${vm.menu === 'download' ? ' is-active' : ''}" data-action="menu-download" aria-label="${t.download}" data-tooltip="${t.download}">${icon('download', 22)}</button>
        <button class="mt-icon-btn" data-action="archive" aria-label="${t.archive}" data-tooltip="${t.archive}">${icon('history', 22)}</button>
        <button class="mt-icon-btn${vm.menu === 'settings' ? ' is-active' : ''}" data-action="menu-settings" aria-label="${t.settings}" data-tooltip="${t.settings}" data-tooltip-pos="left">${icon('settings', 20)}</button>
      </footer>`;
  }

  function settingRow(key, label, hint, value) {
    return `
      <div class="mt-menu-item" data-action="setting" data-key="${key}" role="menuitemcheckbox" aria-checked="${!!value}" tabindex="0">
        <span class="mt-menu-item-text"><span>${label}</span><span class="mt-menu-item-hint">${hint}</span></span>
        <span class="mt-switch" aria-checked="${!!value}"></span>
      </div>`;
  }

  function menu(vm) {
    if (vm.menu === 'download') {
      return `
        <div class="mt-menu" role="menu">
          <div class="mt-menu-label">${t.downloadAs}</div>
          <button class="mt-menu-item" role="menuitem" data-action="download" data-format="md">${icon('download', 20)}<span class="mt-menu-item-text">${t.formatMd}</span></button>
          <button class="mt-menu-item" role="menuitem" data-action="download" data-format="txt">${icon('download', 20)}<span class="mt-menu-item-text">${t.formatTxt}</span></button>
          <button class="mt-menu-item" role="menuitem" data-action="download" data-format="json">${icon('download', 20)}<span class="mt-menu-item-text">${t.formatJson}</span></button>
        </div>`;
    }
    if (vm.menu === 'settings') {
      const s = vm.settings || {};
      return `
        <div class="mt-menu" role="menu" style="min-width:292px">
          ${settingRow('autoCaptions', t.settingAutoCaptions, t.settingAutoCaptionsHint, s.autoCaptions)}
          ${settingRow('autoUkrainian', t.settingAutoUkrainian, t.settingAutoUkrainianHint, s.autoUkrainian)}
          ${settingRow('autoDownload', t.settingAutoDownload, t.settingAutoDownloadHint, s.autoDownload)}
        </div>`;
    }
    return '';
  }

  function snackbar(text) {
    return text ? `<div class="mt-snackbar" role="status"><span>${esc(text)}</span></div>` : '';
  }

  function listInner(vm) {
    if (vm.status === 'off' && !vm.turns.length) return empty('off');
    if (vm.status === 'notfound' && !vm.turns.length) return empty('notfound');
    if (!vm.turns.length) return vm.query ? empty('search') : empty('waiting');
    return vm.turns.map((tr) => turn(tr, vm.query, vm.liveId)).join('');
  }

  function body(vm) {
    const pill = vm.showNewPill ? `<button class="mt-new-pill" data-action="scroll-bottom">${icon('arrowDown', 18)}${t.newReplies}</button>` : '';
    return `<div class="mt-body"><div class="mt-list" data-role="list">${listInner(vm)}</div>${pill}</div>`;
  }

  function panel(vm) {
    return `${header(vm)}${meta(vm)}${search(vm)}${banner(vm.banner)}${body(vm)}${footer(vm)}${menu(vm)}${snackbar(vm.snackbar)}`;
  }

  function controlButton({ open, recording }) {
    return `
      <div class="mt-cb-wrap">
        <button class="mt-cb-btn${open ? ' is-open' : ''}" data-action="toggle-panel" aria-label="${t.openPanel}" aria-pressed="${!!open}" data-tooltip="${t.openPanel}">
          ${icon('transcript')}
          ${recording ? '<span class="mt-cb-badge"></span>' : ''}
        </button>
        <span class="mt-cb-indicator"></span>
      </div>`;
  }

  MT.tpl = { panel, header, meta, search, banner, body, listInner, turn, segment, empty, footer, menu, snackbar, controlButton, statusChip };
})(globalThis);
