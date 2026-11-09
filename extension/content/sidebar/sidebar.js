// The transcript side panel and its control-bar button, rendered into shadow roots on the Meet page.
// Rendering is split by what changed: transcript updates (several times a second while someone speaks) touch
// only the list, and inside the list only the head and segments whose data changed; session state, settings
// and UI actions re-render the slots; geometry (panel box, stage scale, button position) is recomputed on
// open/close, on Meet's own layout changes (MutationObserver, resize) and from a cheap 1 s tick.
(function (root) {
  const MT = (root.MT = root.MT || {});
  const { tpl, util, t } = MT;

  const AT_BOTTOM_PX = 48;
  const LAYOUT_KINDS = new Set(['all', 'state', 'open', 'settings']); // render kinds after which geometry may differ

  class Sidebar {
    constructor(session) {
      this.session = session;
      this.open = false; // opened only by the button, never restored on page load
      this.query = '';
      this.menu = null;
      this.snackbar = null;
      this.showNewPill = false;
      this.slots = {};
      this.slotHtml = {};
      this.turnEls = new Map(); // turn key (first entry id) -> { el, main, speaker, head, segs: Map(entry id -> seg) }
      this.listKind = null; // 'turns' | empty-state html
      this.sheet = null;
      this.pillPos = '';
    }

    async mount() {
      this.host = document.createElement('div');
      this.host.id = 'meet-transcriber-root';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      await this.loadStyles(this.shadow);
      if (this.destroyed) return;
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
      const { signal } = (this.pageListeners = new AbortController());
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.menu) this.setMenu(null); }, { signal });
      addEventListener('resize', () => { this.layout(); this.positionButton(); }, { signal });

      this.session.on((kind) => this.onSession(kind));
      this.tickTimer = setInterval(() => this.tick(), 1000);
      this.render('all');
    }

    // A newer copy of the content script took over this page: leave no UI, listeners or stage transform behind.
    destroy() {
      this.destroyed = true;
      clearInterval(this.tickTimer);
      clearTimeout(this.toastTimer);
      this.pageListeners?.abort();
      this.layoutObserver?.disconnect();
      this.host?.remove();
      document.documentElement.classList.remove('mt-panel-open');
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

    // The panel and its button exist only during a call: not on the Meet home page, the pre-join screen or
    // after leaving. The session decides (with tolerance for Meet's control-bar rebuilds); within a call the
    // panel is always rendered and slides in and out like Meet's own panels.
    inCall() {
      return !!this.session.meeting && this.session.inCall;
    }

    isShown() {
      return this.panel.classList.contains('is-open');
    }

    onSession(kind) {
      if (kind === 'transcript') return this.renderTranscript();
      this.render(kind);
    }

    // Captions changed: only the list can differ. Called several times a second while someone speaks.
    renderTranscript() {
      if (!this.isShown()) return;
      this.renderList(this.vm());
    }

    render(kind = 'all') {
      if (!this.session.meeting) this.open = false; // every call starts with the panel closed
      const inCall = this.inCall();
      const shown = this.open && inCall;
      this.panel.hidden = !inCall;
      this.panel.classList.toggle('is-open', shown);
      this.panel.inert = !shown;
      this.renderButton();
      if (LAYOUT_KINDS.has(kind) || !shown) this.layout();
      if (!shown) return;
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
        keep.add(key);
        let rec = this.turnEls.get(key);
        if (!rec) {
          rec = this.createTurn(tr);
          this.turnEls.set(key, rec);
        }
        this.updateTurn(rec, tr, vm);
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

    createTurn(tr) {
      const tmp = document.createElement('div');
      tmp.innerHTML = tpl.turnShell(tr);
      const el = tmp.firstElementChild;
      return { el, main: el.querySelector('.mt-turn-main'), speaker: tr.speaker, head: null, segs: new Map() };
    }

    // Patches a turn in place. Entry texts are compared by value, but an unchanged entry keeps the same string,
    // so for everything but the live segment this is a handful of pointer comparisons and no HTML is built.
    updateTurn(rec, tr, vm) {
      const isLiveTurn = tr.entries.some((e) => e.id === vm.liveId);
      rec.el.classList.toggle('has-live', isLiveTurn);
      if (rec.speaker !== tr.speaker) {
        rec.speaker = tr.speaker;
        const avatar = rec.el.querySelector('.mt-avatar');
        avatar.style.background = util.avatarColor(tr.speaker);
        avatar.textContent = util.initials(tr.speaker);
      }
      const last = tr.entries[tr.entries.length - 1];
      const head = { speaker: tr.speaker, startedAt: tr.startedAt, single: tr.entries.length === 1, lastLive: last.id === vm.liveId };
      const h = rec.head;
      if (!h || h.speaker !== head.speaker || h.startedAt !== head.startedAt || h.single !== head.single || h.lastLive !== head.lastLive) {
        rec.head = head;
        const node = fromHtml(tpl.turnHead(tr, vm.liveId));
        const old = rec.main.querySelector('.mt-turn-head');
        if (old) old.replaceWith(node);
        else rec.main.prepend(node);
      }
      const keep = new Set();
      let cursor = rec.main.firstElementChild; // the head
      tr.entries.forEach((e, i) => {
        keep.add(e.id);
        const live = e.id === vm.liveId;
        const showTime = i > 0;
        let seg = rec.segs.get(e.id);
        if (!seg || seg.text !== e.text || seg.live !== live || seg.showTime !== showTime || seg.query !== vm.query || seg.startedAt !== e.startedAt) {
          const node = fromHtml(tpl.segment(e, vm.query, live, showTime));
          if (seg) seg.el.replaceWith(node);
          seg = { el: node, text: e.text, live, showTime, query: vm.query, startedAt: e.startedAt };
          rec.segs.set(e.id, seg);
        }
        if (cursor.nextElementSibling !== seg.el) cursor.after(seg.el);
        cursor = seg.el;
      });
      for (const [id, seg] of rec.segs) {
        if (!keep.has(id)) { seg.el.remove(); rec.segs.delete(id); }
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

    // Puts the panel in the box Meet gives its own side panels (left of one that is open) and shrinks the
    // video stage so the panel does not cover it. Closed, the panel waits just past the right edge.
    layout() {
      const html = document.documentElement;
      const stage = MT.dom.stage();
      this.watchLayout(stage);
      const shrink = this.isShown() && !!stage;
      html.classList.toggle('mt-panel-open', shrink);
      if (this.panel.hidden) return;

      const box = MT.dom.sidePanelBox();
      this.host.style.setProperty('--mt-top', `${box.top}px`);
      this.host.style.setProperty('--mt-right', `${box.right}px`);
      this.host.style.setProperty('--mt-bottom', `${box.bottom}px`);

      if (shrink) {
        if (!stage.hasAttribute('data-mt-stage')) stage.setAttribute('data-mt-stage', '');
        // Meet's target size, unaffected by our transform, so this converges instead of shrinking repeatedly.
        const { w, h } = MT.dom.stageSize(stage);
        const scale = w > 0 ? Math.max(0.4, Math.min(1, (w - 360 - 16) / w)) : 1;
        html.style.setProperty('--mt-stage-scale', scale.toFixed(4));
        html.style.setProperty('--mt-stage-ty', `${Math.round((h - h * scale) / 2)}px`);
      }
    }

    // Meet moves its layout (a native panel opening, the reactions bar appearing) by rewriting inline styles
    // on the stage and on the side-panel slot. Follow them at once, so the panel moves in step with Meet's
    // own animation instead of on the next tick.
    watchLayout(stage) {
      const slot = MT.dom.sidePanelSlot();
      if (this.watched && this.watched.stage === stage && this.watched.slot === slot) return;
      this.layoutObserver ||= new MutationObserver(() => this.layout());
      this.layoutObserver.disconnect();
      for (const el of [stage, slot]) if (el) this.layoutObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
      this.watched = { stage, slot };
    }

    // Once a second: follow Meet's control bar with the button and notice when Meet replaced the stage or the
    // panel slot (the observer then watches dead nodes). Everything here works on cached anchors.
    tick() {
      if (this.panel.hidden) return;
      this.positionButton();
      if (this.watched && (this.watched.stage !== MT.dom.stage() || this.watched.slot !== MT.dom.sidePanelSlot())) this.layout();
    }

    // ---------- control-bar button ----------
    // The button is not inserted into Meet's control bar: Meet's bar is responsive and hides its own
    // buttons (e.g. chat) to make room for foreign ones, then rebuilds and drops them. Instead it is a
    // separate pill styled like Meet's right-hand group, positioned just left of that group.

    renderButton() {
      if (!this.inCall()) {
        this.pillPos = '';
        return this.setSlot('fab', '');
      }
      const recording = this.session.status === 'recording';
      if (this.setSlot('fab', `<div class="mt-cb-float">${tpl.controlButton({ open: this.open, recording })}</div>`)) this.pillPos = '';
      this.positionButton();
    }

    positionButton() {
      const pill = this.slots.fab.firstElementChild;
      if (!pill) return;
      const PILL = 56;
      const GAP = 8;
      const group = MT.dom.controlGroup();
      const leave = MT.dom.leaveButton();
      let left;
      let top;
      if (group) {
        const g = group.getBoundingClientRect();
        left = g.left - GAP - PILL;
        top = g.top + (g.height - PILL) / 2;
        // Not enough room between the centre controls and the right group: sit above the group instead.
        const centreRight = leave ? leave.getBoundingClientRect().right : 0;
        if (left < centreRight + 12) {
          left = g.right - PILL;
          top = g.top - GAP - PILL;
        }
      } else {
        left = innerWidth - 16 - PILL;
        top = (leave ? leave.getBoundingClientRect().top : innerHeight - 72) - GAP - PILL;
      }
      const pos = `${Math.round(left)}|${Math.round(top)}`;
      if (pos === this.pillPos) return;
      this.pillPos = pos;
      pill.style.left = `${Math.round(left)}px`;
      pill.style.top = `${Math.round(top)}px`;
    }

    // ---------- interaction ----------

    setOpen(open) {
      this.open = open;
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

  function fromHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.firstElementChild;
  }

  MT.Sidebar = Sidebar;
})(globalThis);
