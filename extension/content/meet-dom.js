// Read-only queries over Google Meet's DOM. All text is read with textContent: the captions overlay is hidden
// with visibility:hidden, and innerText returns an empty string for hidden content.
(function (root) {
  const MT = (root.MT = root.MT || {});
  const S = MT.sel;
  const L = MT.ligature;

  const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const px = (v) => (v ? parseFloat(v) : NaN); // '' (not set) → NaN

  function first(scope, selectors) {
    for (const s of selectors) {
      const el = scope.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function iconText(el) {
    return (el.textContent || '').trim();
  }

  // Buttons whose Material icon ligature equals `ligature`.
  function buttonsByIcon(ligature, scope = document) {
    const out = [];
    for (const i of scope.querySelectorAll(S.icon)) {
      if (iconText(i) !== ligature) continue;
      const btn = i.closest('button, [role="button"]');
      if (btn && !out.includes(btn)) out.push(btn);
    }
    return out;
  }

  function buttonByJsname(names) {
    for (const n of names) {
      const el = document.querySelector(`button[jsname="${n}"]`);
      if (el) return el;
    }
    return null;
  }

  function leaveButton() {
    return buttonsByIcon(L.callEnd)[0] || buttonByJsname(S.leaveButtonJsname);
  }

  function isInCall() {
    return !!leaveButton();
  }

  // 'on' | 'off' | null (button not found)
  function captionsState() {
    if (buttonsByIcon(L.ccOff)[0]) return 'off';
    if (buttonsByIcon(L.ccOn)[0]) return 'on';
    const btn = buttonByJsname(S.ccButtonJsname);
    if (!btn) return null;
    return btn.getAttribute('aria-pressed') === 'true' ? 'on' : 'off';
  }

  function captionsButton() {
    return buttonsByIcon(L.ccOff)[0] || buttonsByIcon(L.ccOn)[0] || buttonByJsname(S.ccButtonJsname);
  }

  function findRegion() {
    for (const s of S.captionsRegion) {
      for (const el of document.querySelectorAll(s)) {
        // The fallback selectors are broad; require caption-like structure or the known container.
        if (el.closest('[jsname="dsyhDe"]') || first(el, S.captionBlock) || /aption|убтитр/i.test(el.getAttribute('aria-label') || '')) return el;
      }
    }
    return null;
  }

  function blockElements(region) {
    for (const s of S.captionBlock) {
      const list = region.querySelectorAll(s);
      if (list.length) return [...list];
    }
    // Structural fallback: direct children that have an avatar image and some text.
    return [...region.children].filter((c) => c.querySelector('img') && text(c));
  }

  function parseBlock(block) {
    const speakerEl = first(block, S.captionSpeaker);
    const textEl = first(block, S.captionText);
    const speaker = speakerEl ? text(speakerEl) : text(block.firstElementChild);
    let body;
    if (textEl) body = textEl.textContent || '';
    else {
      const header = block.firstElementChild;
      body = [...block.children].filter((c) => c !== header).map((c) => c.textContent).join(' ');
    }
    return { key: block, speaker, text: body };
  }

  function parseBlocks(region) {
    return blockElements(region).map(parseBlock);
  }

  function captionRoot(region) {
    for (const s of S.captionRoot) {
      const el = region.closest(s);
      if (el) return el;
    }
    return region.parentElement;
  }

  function languageCombobox() {
    const combos = [...document.querySelectorAll('[role="combobox"]')];
    return (
      combos.find((c) => [...c.querySelectorAll(S.icon)].some((i) => iconText(i) === L.language)) ||
      combos.find((c) => /language|мова|язык/i.test(c.getAttribute('aria-label') || '')) ||
      null
    );
  }

  // Human-readable current caption language, e.g. "Ukrainian (Ukraine)".
  function languageLabel(combo = languageCombobox()) {
    if (!combo) return null;
    let label = '';
    for (const node of combo.querySelectorAll('*')) {
      if (node.children.length || node.matches(S.icon)) continue;
      const t = text(node);
      if (t && t !== L.language) label = t;
    }
    return label || text(combo).replace(new RegExp(`^${L.language}\\s*`), '') || null;
  }

  function isUkrainian(label) {
    return /ukrain|україн|украин|^uk\b/i.test(label || '');
  }

  const CODE_RE = /\b([a-z]{3,4}-[a-z]{4}-[a-z]{3,4})\b/;

  function meetingCode() {
    const m = location.pathname.match(/^\/([a-z]{3,4}-[a-z]{4}-[a-z]{3,4})\b/) || document.title.match(CODE_RE);
    return m ? m[1] : null;
  }

  // Meet keeps document.title as "Meet - <calendar title or code>". The top-left title element is only a
  // fallback: right after joining it can briefly hold other text (e.g. "Meeting details").
  function meetingTitle() {
    const t = document.title.replace(/^(Google\s+)?Meet\s*[-–—:]\s*/i, '').trim();
    if (t && !/^(google )?meet$/i.test(t)) return t;
    const fromDom = text(first(document, S.meetingTitle));
    return fromDom || meetingCode();
  }

  // Meet's video stage (the <main> that holds participant tiles).
  function stage() {
    const tile = document.querySelector('[data-participant-id]');
    return tile?.closest('main') || null;
  }

  // Own display name, read from the self-view tile (the only tile with reframe / effects buttons).
  function selfName() {
    const legacy = document.querySelector('[data-self-name]');
    if (legacy) return legacy.getAttribute('data-self-name');
    for (const ligature of S.selfTileIcons) {
      for (const btn of buttonsByIcon(ligature)) {
        const tile = btn.closest('[data-participant-id]');
        if (!tile) continue;
        const name = first(tile, S.tileName);
        if (text(name)) return text(name);
      }
    }
    return null;
  }

  // Where to insert our control-bar button: before the first panel toggle of the right-hand group.
  function controlBarAnchor() {
    // Visible panel toggles in the bottom area, left to right. A button can contain several icons
    // (e.g. `chat` plus a hidden `chat_bubble` badge), so keep only buttons that are really apart.
    const seen = new Set();
    const buttons = S.panelIcons
      .flatMap((ic) => buttonsByIcon(ic))
      .filter((b) => {
        const r = b.getBoundingClientRect();
        if (seen.has(b) || r.width < 16 || r.top < innerHeight * 0.6) return false;
        seen.add(b);
        return true;
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const firstBtn = buttons[0];
    const other = buttons.find((b) => b.getBoundingClientRect().left - firstBtn?.getBoundingClientRect().left > 24);
    if (!firstBtn || !other) return null;
    let wrapper = firstBtn;
    while (wrapper.parentElement && !wrapper.parentElement.contains(other)) wrapper = wrapper.parentElement;
    if (!wrapper.parentElement) return null;
    return { group: wrapper.parentElement, before: wrapper };
  }

  // Meet's slot for its own side panels (chat, people, …): the parent of the native panel, which stays in the
  // DOM parked past the right edge while closed.
  function sidePanelSlot() {
    return first(document, S.nativePanel)?.parentElement || null;
  }

  // The box Meet gives its side panels, as fixed-position insets. Read from Meet's layout targets (inline
  // styles) rather than current rects, so it is already final while Meet animates a change:
  // - top/bottom: the slot's inline top/bottom plus its padding (they move with the reactions bar);
  // - right: the stage's inline right inset, which grows from 16px by a native panel's width + gap while one
  //   is open, so our panel lands left of it.
  // Falls back to the Leave button and rects when Meet's structure is not recognised (e.g. in the harness).
  function sidePanelBox() {
    const main = stage();
    const slot = sidePanelSlot();
    let top = NaN;
    let bottom = NaN;
    if (slot) {
      const cs = getComputedStyle(slot);
      top = px(slot.style.top) + px(cs.paddingTop);
      bottom = px(slot.style.bottom) + px(cs.paddingBottom);
    }
    if (!(top >= 0 && bottom >= 0) && main) {
      top = px(main.style.top);
      bottom = px(main.style.bottom);
    }
    if (!(top >= 0 && bottom >= 0)) {
      const leave = leaveButton();
      const leaveTop = leave ? leave.getBoundingClientRect().top : 0;
      top = 64;
      bottom = leaveTop > innerHeight / 2 ? Math.round(innerHeight - leaveTop + 16) : 96;
    }
    let right = main ? px(main.style.right) : NaN;
    if (!(right >= 0)) {
      const panel = first(document, S.nativePanel);
      right = panel ? innerWidth - panel.getBoundingClientRect().left + 16 : 16;
    }
    return { top, bottom, right: Math.max(16, right) };
  }

  // The stage's size once Meet's current layout change settles: its container minus Meet's inline insets.
  // The current box lags behind while Meet animates the insets. offsetWidth/offsetHeight (they ignore our
  // transform) are the fallback.
  function stageSize(el) {
    const parent = el.offsetParent;
    const w = parent ? parent.clientWidth - px(el.style.left) - px(el.style.right) : NaN;
    const h = parent ? parent.clientHeight - px(el.style.top) - px(el.style.bottom) : NaN;
    return { w: w > 0 ? w : el.offsetWidth, h: h > 0 ? h : el.offsetHeight };
  }

  MT.dom = {
    text, buttonsByIcon, leaveButton, isInCall, captionsState, captionsButton, findRegion, parseBlocks,
    captionRoot, languageCombobox, languageLabel, isUkrainian, meetingCode, meetingTitle, selfName,
    controlBarAnchor, sidePanelSlot, sidePanelBox, stage, stageSize,
  };
})(globalThis);
