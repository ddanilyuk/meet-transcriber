// Read-only queries over Google Meet's DOM. All text is read with textContent: the captions overlay is hidden
// with visibility:hidden, and innerText returns an empty string for hidden content.
(function (root) {
  const MT = (root.MT = root.MT || {});
  const S = MT.sel;
  const L = MT.ligature;

  const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

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

  function meetingTitle() {
    const el = first(document, S.meetingTitle);
    const fromDom = text(el);
    if (fromDom) return fromDom;
    const t = document.title.replace(/^Meet\s*[-–—:]\s*/i, '').trim();
    return t && !/^google meet$/i.test(t) ? t : meetingCode();
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
    const buttons = S.panelIcons.map((ic) => buttonsByIcon(ic).find((b) => b.getBoundingClientRect().top > innerHeight * 0.6)).filter(Boolean);
    if (buttons.length < 2) return null;
    const [firstBtn, other] = buttons;
    let wrapper = firstBtn;
    while (wrapper.parentElement && !wrapper.parentElement.contains(other)) wrapper = wrapper.parentElement;
    if (!wrapper.parentElement) return null;
    return { group: wrapper.parentElement, before: wrapper };
  }

  // Meet's own side panel (chat, people, …) if one is open, so ours can sit next to it.
  function nativePanel() {
    for (const s of S.nativePanel) {
      const el = document.querySelector(s);
      if (el && el.getBoundingClientRect().width > 200) return el;
    }
    return null;
  }

  MT.dom = {
    text, buttonsByIcon, leaveButton, isInCall, captionsState, captionsButton, findRegion, parseBlocks,
    captionRoot, languageCombobox, languageLabel, isUkrainian, meetingCode, meetingTitle, selfName,
    controlBarAnchor, nativePanel,
  };
})(globalThis);
