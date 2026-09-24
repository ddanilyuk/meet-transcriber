// Every Google Meet DOM hook lives here. Meet's class names are obfuscated and change between releases,
// so each hook is a fallback chain, most specific first. Icon ligatures (`call_end`, `closed_caption_off`, …)
// and ARIA roles are preferred because they do not depend on the UI language. See docs/meet-dom.md.
(function (root) {
  const MT = (root.MT = root.MT || {});

  MT.sel = {
    icon: 'i.google-symbols, i.google-material-icons, .google-symbols, .google-material-icons',

    captionsRegion: [
      '[jsname="dsyhDe"] div[role="region"]',
      'div[role="region"][tabindex="0"][aria-label*="aption" i]',
      'div[role="region"][aria-label*="убтитр" i]',
      'div[role="region"][tabindex="0"]',
      '.vNKgIf',
    ],
    captionBlock: ['.nMcdL'],
    captionSpeaker: ['.NWpY1d', '.KcIKyf', '.zs7s8d'],
    captionText: ['.ygicle', '[jsname="tgaKEf"]', '.bh44bd'],
    // Root of the whole captions overlay (region + language bar); hidden with visibility:hidden.
    captionRoot: ['.fJsklc', '[jsname="dsyhDe"]'],

    ccButtonJsname: ['RrG0hf', 'r8qRAd'],
    leaveButtonJsname: ['CQylAd'],
    languageOptionUk: '[role="option"][data-value^="uk"]',
    meetingTitle: ['[jsname="NeC6gb"]', '.u6vdEc'],
    // Buttons that only exist on the self-view tile (reframe / visual effects).
    selfTileIcons: ['visual_effects', 'frame_person', 'auto_awesome'],
    tileName: ['span.notranslate', '[data-self-name]'],
    // Panel toggle icons in the right-hand group of the control bar, in insertion preference order.
    panelIcons: ['chat', 'chat_bubble', 'people', 'group', 'apps', 'info', 'lock_person'],
    nativePanel: ['.R3Gmyc'],
  };

  MT.ligature = {
    callEnd: 'call_end',
    ccOff: 'closed_caption_off',
    ccOn: 'closed_caption',
    language: 'language',
  };
})(globalThis);
