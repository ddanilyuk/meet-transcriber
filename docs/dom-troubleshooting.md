# When Google Meet changes its DOM: a runbook

The extension has no API and depends entirely on Meet's DOM. The classes there are obfuscated (`nMcdL`, `fJsklc`, …) and change between releases. This document describes how to quickly find what exactly broke and fix it without breaking anything else.

All Meet hooks are collected in one place, `extension/content/selectors.js`. The code reads them only through `extension/content/meet-dom.js`. Behavioral findings (what Meet measures, when it re-renders, etc.) are recorded in [meet-dom.md](meet-dom.md).

## 1. Symptom → likely cause → where to fix

| Symptom | Likely cause | Where to look |
| --- | --- | --- |
| Status "Не вдається знайти субтитри" (Can't find captions) (`notfound`) while CC is on | The captions region is not found | `sel.captionsRegion`, `dom.findRegion()` |
| Status "Запис" (Recording), but no utterances appear | Blocks, speaker or text markup changed | `sel.captionBlock`, `captionSpeaker`, `captionText`, `dom.parseBlocks()` |
| The speaker name is empty, or system lines ("… joined") get recorded | The speaker selector matches a notification line or does not match the real speaker | `sel.captionSpeaker`. Lines without a speaker are dropped on purpose in `TranscriptBuilder.update()` |
| Your own utterances are labeled "Ви" (You) instead of your name | The self-view tile or the name on it is not found | `sel.selfTileIcons`, `sel.tileName`, `dom.selfName()` |
| History is duplicated after screen sharing or a layout change | Meet re-rendered the region and the block text changed | `adopt()` and `adoptWindowMs` in `shared/transcript.js` |
| CC does not turn on automatically | The ligatures or the `jsname` of the CC button changed | `MT.ligature.ccOff/ccOn`, `sel.ccButtonJsname`, `dom.captionsState()` |
| The language does not switch to Ukrainian, a banner appears | The language combobox or the option is not found | `dom.languageCombobox()` (looks for the `language` icon), `sel.languageOptionUk` |
| Captions are visible although "Субтитри на екрані" (Captions on screen) is off | The CSS does not find the overlay root | `content/page.css`, `sel.captionRoot`, `captions.markRoot()` |
| A black strip under the video, the video is not full-size | Meet reserved space for captions: the `:has()` rule did not apply before the measurement | `content/page.css`, `captions.spaceReserved()`, `session.reclaimSpaceSoon()` |
| The "Транскрипт" (Transcript) button is missing or misplaced | The right button group is not found | `sel.panelIcons`, `dom.controlBarAnchor()`, `Sidebar.positionButton()` |
| The sidebar covers Meet's native panel (chat, people), does not match its height or overlaps the reactions bar | The native panel slot is not found, or Meet stopped writing target insets inline | `sel.nativePanel`, `dom.sidePanelSlot()`, `dom.sidePanelBox()` (compare with `main.style.inset` and the `style` of the `.R3Gmyc` parent) |
| The sidebar appears without sliding in, or the video shrinks out of sync with it | Meet changed the duration or curve of its panel animation, or a rule for `<main>` overrode our `transition` | `--mt-slide` in `sidebar.css`, `[data-mt-stage]` in `page.css`; compare with `getComputedStyle(.R3Gmyc).transition` |
| The video does not shift when the sidebar is open | The stage is not found | `dom.stage()` (looks for `[data-participant-id]` → `closest('main')`) |
| The meeting does not end, the file is not saved | The leave button is not recognized | `MT.ligature.callEnd`, `sel.leaveButtonJsname`, `dom.isInCall()` |
| Wrong meeting title | The `document.title` format changed | `dom.meetingTitle()`, `sel.meetingTitle` |
| In a background tab captions "freeze" and arrive in a batch when you open the tab | Meet no longer renders through rAF, or grabbed rAF before our patch | `content/page-raf.js` (see snippet 8) |
| CC turns itself off and on | A `remeasure()` loop: `spaceReserved()` fires falsely | It must measure the layout box (`offset*`), not `getBoundingClientRect()` |

## 2. Reproducing

1. Start the dev server: `npm run dev`. The unpacked extension then picks up changes by itself.
2. Open `https://meet.google.com/new` through Claude in Chrome. The page immediately joins an empty call with your account.
3. Keep the tab visible. While the tab is in the background, CDP screenshots fail and timers are throttled.
4. Speak yourself or play a voice:

   ```bash
   say -v Lesya "Добрий день, колеги. Це перевірка субтитрів."
   ```

   The voice comes out of the speakers and the microphone hears it. This does not work with headphones.
5. Check the console: `read_console_messages` with the pattern `meet-transcriber|Uncaught`.

Tool specifics:
- `javascript_tool` runs code in the **MAIN world**. It sees the DOM and our open shadow roots (`#meet-transcriber-root`), but not the content script's `MT` and `chrome.runtime`.
- The tool blocks output that looks like tokens or base64 ("[BLOCKED: …]"). Do not print `outerHTML` or long class strings; use the structural dump (snippet 2) and `slice()`.
- Claude in Chrome cannot open `chrome://extensions` or `chrome-extension://` pages. Check the archive through `dev/archive.html` or ask the user.
- After an extension reload the SW injects a fresh content script into open Meet tabs by itself, and it takes over the call. The tab console should show `replaced by a newer content script` → `content script loaded` → `resumed <id>`, and there should be only one `#meet-transcriber-root`. If the tab was opened with code older than 1.1.1, reload it and click "Join now".
- An `await` inside `javascript_tool` that is still running during a navigation fails with an error.

## 3. Diagnostic snippets (`javascript_tool`)

**1. Which icons and buttons exist right now.** Ligatures do not depend on the UI language.

```js
const icons = {};
for (const i of document.querySelectorAll('i.google-symbols, i.google-material-icons')) icons[i.textContent.trim()] = true;
({ icons: Object.keys(icons), buttons: [...document.querySelectorAll('button')].filter(b => b.querySelector('i')).map(b => ({
  icon: b.querySelector('i').textContent.trim(), aria: b.getAttribute('aria-label'), jsname: b.getAttribute('jsname'),
  w: Math.round(b.getBoundingClientRect().width) })) })
```

**2. Structural dump of the captions region.** Shows only safe attributes.

```js
function dump(el, d = 0, max = 8) {
  if (d > max) return '';
  const attrs = ['class','jsname','role','aria-label','tabindex','jscontroller'].map(a => el.getAttribute?.(a) ? `${a}="${String(el.getAttribute(a)).slice(0,40)}"` : '').filter(Boolean).join(' ');
  const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' | ').slice(0, 50);
  let out = `${'  '.repeat(d)}<${el.tagName.toLowerCase()} ${attrs}>${own ? ` "${own}"` : ''}\n`;
  if (el.tagName !== 'BUTTON') for (const c of el.children) out += dump(c, d + 1, max);
  return out;
}
const region = [...document.querySelectorAll('[role="region"]')].find(r => r.querySelector('img') || /aption|убтитр/i.test(r.getAttribute('aria-label') || ''));
region ? dump(region, 0, 6) : [...document.querySelectorAll('[role="region"]')].map(r => r.getAttribute('aria-label'))
```

Expected structure (09.2026): `region > .nMcdL (block) > [.adE6rb > img + .KcIKyf > span.NWpY1d (speaker)] + .ygicle (text)`. The last two children of the captions region contain no captions.

**3. How Meet updates the text.** A mutation logger, also useful for checking the background tab.

```js
window.__log = [];
const region = document.querySelector('[jsname="dsyhDe"] [role="region"]');
window.__obs?.disconnect();
window.__obs = new MutationObserver(m => __log.push({ t: performance.now() | 0, hidden: document.hidden, n: m.length,
  tail: region.textContent.replace(/\s+/g, ' ').slice(-60) }));
window.__obs.observe(region, { subtree: true, childList: true, characterData: true });
'ok'   // next: say -v Lesya "…", then read __log
```

**4. Caption language and available options.**

```js
const combo = [...document.querySelectorAll('[role="combobox"]')].find(c => [...c.querySelectorAll('i')].some(i => i.textContent.trim() === 'language'));
combo.click(); await new Promise(r => setTimeout(r, 800));
const opts = [...document.querySelectorAll('[role="option"]')].map(o => `${o.getAttribute('data-value')} ${o.textContent.trim().slice(0, 30)}`);
combo.click(); ({ current: combo.textContent.trim(), uk: opts.filter(o => /uk|ukrain/i.test(o)) })
```

**5. Whether Meet reserves space for captions.** Normal: `inset … 136px`, reserved: `… 352px`.

```js
const main = document.querySelector('[data-participant-id]')?.closest('main');
const leave = [...document.querySelectorAll('i.google-symbols')].find(i => i.textContent.trim() === 'call_end')?.closest('button');
const bottom = main.offsetParent.getBoundingClientRect().top + main.offsetTop + main.offsetHeight;
({ inset: main.getAttribute('style'), gap: Math.round(leave.getBoundingClientRect().top - bottom),
   htmlClass: document.documentElement.className,
   captionRoots: [...document.querySelectorAll('.fJsklc')].filter(e => e.querySelector('[jsname="dsyhDe"]')).map(e => e.getBoundingClientRect().height) })
```

**6. The right button group and our pill.**

```js
const r = el => { const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); };
const chat = [...document.querySelectorAll('i.google-symbols')].filter(i => i.textContent.trim() === 'chat').map(i => i.closest('button')).find(b => b?.getBoundingClientRect().width > 0);
let g = chat; while (g && g.parentElement && g.parentElement.children.length < 3) g = g.parentElement;
({ group: g && r(g.parentElement), kids: g ? [...g.parentElement.children].map(c => `${String(c.className).slice(0, 20)} ${r(c)}`) : null,
   pill: r(document.getElementById('meet-transcriber-root').shadowRoot.querySelector('.mt-cb-float') || document.body) })
```

**7. State of our UI (the shadow DOM is open).** A closed panel does not render its slots, so the snippet opens it first.

```js
const sh = document.getElementById('meet-transcriber-root').shadowRoot;
if (!sh.querySelector('.mt-panel').classList.contains('is-open')) { sh.querySelector('.mt-cb-float [data-action="toggle-panel"]')?.click(); await new Promise(r => setTimeout(r, 600)); }
({ chip: sh.querySelector('.mt-chip')?.textContent, banner: sh.querySelector('.mt-banner')?.textContent.trim().slice(0, 80),
   turns: [...sh.querySelectorAll('.mt-turn')].slice(-3).map(t => t.querySelector('.mt-speaker').textContent + ': ' + t.textContent.slice(-80)) })
```

**8. Background tab.** Run snippet 3, move the tab to the background, play a phrase, read `__log`. If all entries have `hidden: false`, or there are no entries while the tab is hidden, the rAF patch no longer helps. Next:
- check that `window.__meetTranscriberRaf === true` (the patch is installed);
- Meet may have switched to another scheduler (`requestIdleCallback`, `scheduler.postTask`, `IntersectionObserver`), and then the patch has to be extended;
- another possible cause: Meet checks `document.hidden`. During the recon, spoofing `visibilityState` turned out to be unnecessary, but it is worth checking again.

## 4. How to fix

1. **Add, don't replace.** Put a new selector at the start of its chain in `selectors.js` and keep the old one: Meet often rolls out UI versions gradually, and different users see different DOM.
2. **Prefer language-independent hooks.** Order: icon ligature, `role`, `jsname`, class. Use `aria-label` only as the last fallback: it is localized (`Captions` / `Субтитри`).
3. **Read text only through `textContent`.** Hidden elements give an empty `innerText`.
4. **Do not insert nodes into Meet's DOM.** Meet throws out foreign nodes and rebuilds its responsive panels. Our UI lives in its own shadow roots, is positioned by the rectangles of Meet's elements and affects Meet only through CSS (`page.css`) and marker attributes.
5. **Do not turn captions off or use `display:none` to hide them.** The region then disappears from the DOM.
6. **Mirror the new structure in the simulator** `dev/meet-sim.js` (classes, `jsname`, ligatures) so that the harness matches the real Meet.
7. **If the merge behavior changed** (for example, Meet started truncating the head of a block again), first add a test to `test/transcript.test.js`, then edit `shared/transcript.js`.

## 5. Verification after a fix

1. `npm test`: all tests pass.
2. `http://localhost:8765/dev/harness.html?speed=4`: utterances appear in the sidebar, CC turns on by itself, the language becomes `uk-UA`, the overlay is hidden. The "re-render region" button must not create duplicates.
3. A real call, always with the tab visible:
   - joining: CC turns on, the language is Ukrainian, no black strip under the video (snippet 5 → `136px`);
   - `say -v Lesya` → utterances with your name appear in the sidebar;
   - open and close the sidebar → the video shifts and comes back, the pill sits next to the group, the chat is visible;
   - "Субтитри на екрані" → the overlay is visible; turn it off → the space is given back, CC is re-toggled at most once;
   - tab in the background + a phrase → the text arrives (snippet 8);
   - "Leave call" → a file in `~/Downloads/Meet Transcripts/` (`ls` in the terminal).
4. Record the findings in [meet-dom.md](meet-dom.md) with a date. If a threshold changed, update [parameters.md](parameters.md).
