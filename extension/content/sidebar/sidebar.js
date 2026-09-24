// The transcript side panel and its control-bar button, rendered into shadow roots on the Meet page.
// The panel is split into slots that are re-rendered only when their HTML changes; the transcript list is
// reconciled turn by turn so the live caption can update several times a second without losing scroll or focus.
(function (root) {
  const MT = (root.MT = root.MT || {});
  const { tpl, util, t } = MT;

  const OPEN_KEY = 'meetTranscriber:panelOpen';
  const AT_BOTTOM_PX = 48;

  function readOpen() {
    try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
  }
  function writeOpen(open) {
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* storage blocked */ }
  }

  class Sidebar {
    constructor(session) {
      this.session = session;
      this.open = readOpen();
      this.query = '';
      this.menu = null;
      this.snackbar = null;
      this.showNewPill = false;
      this.slots = {};
      this.slotHtml = {};
      this.turnEls = new Map(); // turn key -> { el, html }
      this.listKind = null; // 'turns' | empty-state html
      this.sheet = null;
    }

    async mount() {
      this.host = document.createElement('div');
      this.host.id = 'meet-transcriber-root';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      await this.loadStyles(this.shadow);
      this.shadow.innerHTML += `
        <div class="mt-panel" hidden>
          <div data-slot="header"></div>
          <div data-slot="meta"></div>
          <div data-slot="search"></div>
          <div data-slot="banner"></div>
          <div class="mt-body"><div class="mt-list" data-role="list"></div><div data-slot="pill"></div></div>
          <div data-slot="footer"></div>
          <div data-slot="menu"></div>
          <div data-slot="snackbar"></div>
        </div>
        <div data-slot="fab"></div>`;
      this.panel = this.shadow.querySelector('.mt-panel');
      this.list = this.shadow.querySelector('[data-role="list"]');
      for (const el of this.shadow.querySelectorAll('[data-slot]')) this.slots[el.dataset.slot] = el;
      document.documentElement.append(this.host);

      this.shadow.addEventListener('click', (e) => this.onClick(e));
      this.shadow.addEventListener('input', (e) => this.onInput(e));
      this.shadow.addEventListener('keydown', (e) => this.onKeyDown(e));
      this.list.addEventListener('scroll', () => this.onScroll(), { passive: true });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.menu) this.setMenu(null); });
      addEventListener('resize', () => this.layout());

      this.session.on((kind) => this.render(kind));
      setInterval(() => this.tick(), 1000);
      this.render('all');
    }

    async loadStyles(target) {
      if (!this.sheet) {
        const css = await fetch(chrome.runtime.getURL('content/sidebar/sidebar.css')).then((r) => r.text()).catch(() => '');
        try {
          this.sheet = new CSSStyleSheet();
          this.sheet.replaceSync(css);
        } catch {
          this.sheet = null;
          this.cssText = css;
        }
      }
      if (this.sheet) target.adoptedStyleSheets = [this.sheet];
      else target.append(Object.assign(document.createElement('style'), { textContent: this.cssText }));
    }

    // ---------- view model ----------

    vm() {
      const s = this.session;
      const meeting = s.currentMeeting();
      const entries = s.entries();
      const q = this.query.trim();
      let turns = util.groupTurns(entries);
      let matchCount = 0;
      if (q) {
        turns = turns
          .map((tr) => ({ ...tr, entries: util.matches(tr.speaker, q) ? tr.entries : tr.entries.filter((e) => util.matches(e.text, q)) }))
          .filter((tr) => tr.entries.length);
        matchCount = turns.reduce((n, tr) => n + tr.entries.length, 0);
      }
      const lang = s.language || (meeting?.language ? { label: meeting.language, ukrainian: MT.dom.isUkrainian(meeting.language) } : null);
      return {
        status: s.contextLost ? 'ended' : s.status,
        meeting: meeting && {
          title: meeting.title,
          startedAt: meeting.startedAt,
          language: lang ? (lang.ukrainian ? 'Українська' : lang.label) : null,
          languageOk: lang ? lang.ukrainian : null,
        },
        banner: s.banner,
        query: this.query,
        matchCount,
        turns,
        liveId: s.liveId(),
        settings: s.settings,
        menu: this.menu,
        snackbar: this.snackbar,
        showNewPill: this.showNewPill,
      };
    }

    // ---------- rendering ----------

    setSlot(name, html) {
      if (this.slotHtml[name] === html) return false;
      this.slotHtml[name] = html;
      this.slots[name].innerHTML = html;
      return true;
    }

    render() {
      this.renderButton();
      this.panel.hidden = !this.open;
      if (!this.open) return;
      const vm = this.vm();
      this.setSlot('header', tpl.header(vm));
      this.setSlot('meta', tpl.meta(vm));
      this.renderSearch(vm);
      this.setSlot('banner', tpl.banner(vm.banner));
      this.renderList(vm);
      this.setSlot('pill', vm.showNewPill ? `<button class="mt-new-pill" data-action="scroll-bottom">${MT.icon('arrowDown', 18)}${t.newReplies}</button>` : '');
      this.setSlot('footer', tpl.footer(vm));
      this.setSlot('menu', tpl.menu(vm));
      this.setSlot('snackbar', tpl.snackbar(vm.snackbar));
      this.layout();
    }

    // The search field is rendered once so typing never loses focus; only the match counter changes.
    renderSearch(vm) {
      if (!this.slots.search.firstElementChild) this.setSlot('search', tpl.search({ query: '' }));
      const label = this.slots.search.querySelector('.mt-search');
      let count = label.querySelector('.mt-search-count');
      const text = vm.query.trim() ? (vm.matchCount ? t.searchCount(vm.matchCount) : t.searchNone) : '';
      if (!text) { count?.remove(); return; }
      if (!count) label.append((count = Object.assign(document.createElement('span'), { className: 'mt-search-count' })));
      count.textContent = text;
    }

    renderList(vm) {
      const wasAtBottom = this.isAtBottom();
      const before = this.list.scrollHeight;
      if (!vm.turns.length) {
        const html = tpl.listInner(vm);
        if (this.listKind !== html) {
          this.list.innerHTML = html;
          this.listKind = html;
          this.turnEls.clear();
        }
        return;
      }
      if (this.listKind !== 'turns') {
        this.list.innerHTML = '';
        this.listKind = 'turns';
        this.turnEls.clear();
      }

      const keep = new Set();
      let cursor = null; // previous element in document order
      for (const tr of vm.turns) {
        const key = tr.entries[0].id;
        const html = tpl.turn(tr, vm.query, vm.liveId);
        keep.add(key);
        let rec = this.turnEls.get(key);
        if (!rec || rec.html !== html) {
          const tmp = document.createElement('div');
          tmp.innerHTML = html;
          const el = tmp.firstElementChild;
          if (rec) rec.el.replaceWith(el);
          rec = { el, html };
          this.turnEls.set(key, rec);
        }
        const expected = cursor ? cursor.nextElementSibling : this.list.firstElementChild;
        if (rec.el !== expected) {
          if (cursor) cursor.after(rec.el);
          else this.list.prepend(rec.el);
        }
        cursor = rec.el;
      }
      for (const [key, rec] of this.turnEls) {
        if (!keep.has(key)) { rec.el.remove(); this.turnEls.delete(key); }
      }

      const grew = this.list.scrollHeight > before;
      if (wasAtBottom) this.scrollToBottom();
      else if (grew && !vm.query && !this.showNewPill) {
        this.showNewPill = true;
        this.setSlot('pill', `<button class="mt-new-pill" data-action="scroll-bottom">${MT.icon('arrowDown', 18)}${t.newReplies}</button>`);
      }
    }

    isAtBottom() {
      const l = this.list;
      return l.scrollHeight - l.scrollTop - l.clientHeight < AT_BOTTOM_PX;
    }

    scrollToBottom() {
      this.list.scrollTop = this.list.scrollHeight;
      if (this.showNewPill) {
        this.showNewPill = false;
        this.setSlot('pill', '');
      }
    }

    onScroll() {
      if (this.showNewPill && this.isAtBottom()) {
        this.showNewPill = false;
        this.setSlot('pill', '');
      }
    }

    // Keeps the panel between Meet's top bar and control bar, left of Meet's own side panel if one is open.
    layout() {
      if (!this.open) return;
      const style = this.host.style;
      const native = MT.dom.nativePanel();
      const right = native ? Math.max(16, innerWidth - native.getBoundingClientRect().left + 16) : 16;
      const leave = MT.dom.leaveButton();
      const top = leave ? leave.getBoundingClientRect().top : 0;
      const bottom = top > innerHeight / 2 ? Math.round(innerHeight - top + 16) : 96;
      style.setProperty('--mt-right', `${right}px`);
      style.setProperty('--mt-bottom', `${bottom}px`);
    }

    // ---------- control-bar button ----------

    renderButton() {
      const recording = this.session.status === 'recording';
      const html = tpl.controlButton({ open: this.open, recording });
      if (this.buttonSlot && this.buttonHost?.isConnected) {
        if (this.buttonHtml !== html) {
          this.buttonSlot.innerHTML = html;
          this.buttonHtml = html;
        }
        this.setSlot('fab', '');
        return;
      }
      // Not attached to Meet's control bar (yet): offer a floating button while in a call.
      const inCall = this.session.meeting && MT.dom.isInCall();
      this.setSlot('fab', inCall && this.fabAllowed
        ? `<button class="mt-cb-btn mt-fab${this.open ? ' is-open' : ''}" data-action="toggle-panel" aria-label="${t.openPanel}" data-tooltip="${t.openPanel}">${MT.icon('transcript')}${recording ? '<span class="mt-cb-badge"></span>' : ''}</button>`
        : '');
    }

    async attachButton() {
      if (this.buttonHost?.isConnected || this.attaching) return;
      const anchor = MT.dom.controlBarAnchor();
      if (!anchor) return;
      this.attaching = true;
      const host = document.createElement('div');
      host.className = 'meet-transcriber-button';
      host.style.display = 'flex';
      const shadow = host.attachShadow({ mode: 'open' });
      await this.loadStyles(shadow);
      const slot = document.createElement('div');
      slot.style.display = 'contents';
      shadow.append(slot);
      shadow.addEventListener('click', (e) => this.onClick(e));
      anchor.group.insertBefore(host, anchor.before);
      this.buttonHost = host;
      this.buttonSlot = slot;
      this.buttonHtml = null;
      this.attaching = false;
      this.renderButton();
    }

    tick() {
      if (this.session.meeting && MT.dom.isInCall()) {
        this.attachButton();
        this.inCallSince ??= Date.now();
        this.fabAllowed = Date.now() - this.inCallSince > 5000;
      } else {
        this.inCallSince = null;
      }
      this.render('tick');
    }

    // ---------- interaction ----------

    setOpen(open) {
      this.open = open;
      writeOpen(open);
      if (!open) this.setMenu(null, false);
      this.render('open');
      if (open) requestAnimationFrame(() => this.scrollToBottom());
    }

    setMenu(menu, rerender = true) {
      this.menu = this.menu === menu ? null : menu;
      if (rerender) this.render('menu');
    }

    toast(text) {
      this.snackbar = text;
      this.render('toast');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { this.snackbar = null; this.render('toast'); }, 3000);
    }

    async copy() {
      const meeting = this.session.currentMeeting();
      if (!meeting) return;
      const md = MT.format.toMarkdown({ ...meeting, entries: this.session.entries() });
      try {
        await navigator.clipboard.writeText(md);
      } catch {
        const ta = Object.assign(document.createElement('textarea'), { value: md });
        this.shadow.append(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      this.toast(t.copied);
    }

    async download(format) {
      const meeting = this.session.currentMeeting();
      if (!meeting) return;
      await this.session.saveNow();
      const res = await MT.send('meeting:export', { id: meeting.id, format });
      if (res) this.toast(t.downloaded);
    }

    onClick(e) {
      const el = e.target.closest('[data-action]');
      if (!el) {
        if (this.menu && !e.target.closest('.mt-menu')) this.setMenu(null);
        return;
      }
      const action = el.dataset.action;
      const s = this.session;
      if (action !== 'menu-download' && action !== 'menu-settings' && action !== 'setting' && this.menu) this.menu = null;
      switch (action) {
        case 'toggle-panel': return this.setOpen(!this.open);
        case 'close': return this.setOpen(false);
        case 'toggle-overlay': return s.setSetting('showOverlay', !s.settings.showOverlay);
        case 'copy': return this.copy();
        case 'menu-download': return this.setMenu('download');
        case 'menu-settings': return this.setMenu('settings');
        case 'download': this.menu = null; return this.download(el.dataset.format);
        case 'setting': return s.setSetting(el.dataset.key, !s.settings[el.dataset.key]);
        case 'archive': this.render('menu'); return MT.send('archive:open', { id: s.currentMeeting()?.id });
        case 'enable-captions': return s.enableCaptions();
        case 'set-ukrainian': return s.chooseUkrainian();
        case 'dismiss-banner': return s.dismissBanner();
        case 'scroll-bottom': return this.scrollToBottom();
        default: return undefined;
      }
    }

    onInput(e) {
      if (e.target.dataset?.role !== 'search') return;
      // Read the value now: once dispatch ends, e.target is retargeted to the shadow host.
      const value = e.target.value || '';
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.query = value;
        this.render('search');
        if (!this.query) this.scrollToBottom();
      }, 80);
    }

    onKeyDown(e) {
      // Meet has single-key shortcuts (c, d, e, …); keep typing in the search field from triggering them.
      if (e.target.dataset?.role === 'search') e.stopPropagation();
      if (e.key === 'Escape' && this.menu) this.setMenu(null);
      if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset?.action === 'setting') {
        e.preventDefault();
        e.target.click();
      }
    }
  }

  MT.Sidebar = Sidebar;
})(globalThis);
