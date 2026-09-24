# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Meet Transcriber is a local-only Chrome MV3 extension that scrapes Google Meet's own live captions
(Ukrainian) from the page DOM, stores transcripts with speaker names in `chrome.storage.local`, and shows
them in a Meet-styled sidebar. There is no Meet API: everything depends on Meet's obfuscated DOM, so most
maintenance is about keeping selectors and DOM assumptions current. The user communicates in Ukrainian;
UI strings are Ukrainian (`extension/shared/strings.js`), code, comments and commit messages are English.

## Commands

```bash
npm test                                                    # all unit tests (node:test, no dependencies)
node --test test/transcript.test.js                         # one file
node --test --test-name-pattern="head truncation" test/transcript.test.js   # one test by name
npm run dev                                                 # dev server on http://localhost:8765 (see below)
npm run icons                                               # regenerate extension/icons/*.png
```

There is no build step, bundler, linter or npm dependency. The unpacked extension is loaded directly from
`extension/` (chrome://extensions → Developer mode → Load unpacked). Syntax-check a classic script with
`node --check <file>`; `package.json` has `"type": "module"`, so background modules are ES modules.

While `npm run dev` runs:
- `/dev/harness.html` — Meet simulator (DOM copied 1:1 from the live recon) that loads the content scripts
  listed in `manifest.json` with a `chrome.*` shim; query params `?speed=4`, `?cc=on`, `?autoplay=0`,
  `?prejoin=1` (start on a "Ready to join?" screen without call controls).
- `/dev/archive.html` — the archive page on the same shim storage as the harness.
- `/design/mockup.html` — every sidebar state rendered with the real templates and CSS.
- `/__version` — hash of `extension/`; the unpacked extension reloads itself when it changes (`background/dev-reload.js`).
  After an auto-reload, open Meet tabs keep the orphaned old content script: reload the tab (and click "Join now").

## Architecture

Three execution contexts, no shared module system:

1. **MAIN world, `document_start`** — `content/page-raf.js` only. Chrome pauses `requestAnimationFrame` in hidden
   tabs and Meet renders captions from rAF, so without this patch captions stop reaching the DOM when the user
   switches tabs. It routes rAF to `setTimeout` while `document.hidden`.
2. **Isolated-world content scripts** — classic scripts loaded in the order listed in `manifest.json`. Each file is an
   IIFE that attaches to `globalThis.MT` (`MT.dom`, `MT.sel`, `MT.captions`, `MT.TranscriptBuilder`, `MT.tpl`, …).
   Order matters; add new files to the manifest list at the right position (the harness reads the same list).
3. **Service worker** (`background/sw.js`, ES module) — the single writer of storage, owner of downloads, alarms and
   tab bookkeeping. `background/router.js` + `background/store.js` are pure (dependencies injected), so the same code
   runs in the SW, in the harness/archive dev pages and in node tests.

`extension/shared/*.js` are side-effect scripts on `globalThis.MT` too, so they work as content scripts, as imports in
the SW/router (`import '../shared/format.js'`) and in node tests.

Data flow: `CaptionTracker` (MutationObserver on the captions region, throttled scans) → `MT.dom.parseBlocks()` →
`TranscriptBuilder.update(blocks)` → `MeetingSession` debounced `session:update` message → router → `store.update`
→ `chrome.storage.local` (`meetings` index + `meeting:<id>` records) → archive page listens to `storage.onChanged`.

Key pieces and the non-obvious reasons behind them:
- `shared/transcript.js` — Meet rewrites caption text in place, keeps one block growing for minutes, may truncate its
  head and re-renders the whole region on layout changes. The builder tracks blocks by DOM element, splits them into
  paragraph entries at pauses, re-anchors offsets on truncation, and lets a re-rendered block *adopt* the entries of a
  recently released one (otherwise history is duplicated). This is the most test-covered file; change it test-first.
- `content/session.js` — call lifecycle (in call ⇔ a button with the `call_end` icon exists; left after 3 missed polls),
  resume of the same record after reload/quick rejoin, auto CC + Ukrainian once per session, status for the UI,
  `reclaimSpaceSoon()` (see below). Titles follow `document.title` only when it changes, so archive renames survive.
- `content/page.css` (manifest `css`, bypasses page CSP) — collapses the captions overlay. Meet measures the overlay
  **when captions are switched on** and reserves that height under the video; hiding it later does not give the space
  back. The `:has([jsname="dsyhDe"])` rule collapses it before Meet measures; if space is still reserved,
  `MT.captions.remeasure()` toggles CC off/on (max twice per meeting). Never use `display:none` or turn captions off to
  hide them — the region disappears from the DOM.
- `content/sidebar/` — panel in a shadow root; slots re-render only when their HTML changes and the list is reconciled
  per speaker turn (live captions update ~3×/s). Panel and button are shown only while `Sidebar.inCall()` (active
  session + Meet's Leave button) — never on the Meet home page, the pre-join screen or after leaving; the persisted
  `meetTranscriber:panelOpen` flag is only the preference for the next call. The open/close button is a separate pill positioned next to Meet's
  right control group, **not inserted into it**: Meet's control bar is responsive, hides its own chat button to make
  room for foreign nodes and later drops them. While the panel is open the Meet stage (`<main>`) is scaled with a CSS
  transform via `data-mt-stage` + CSS variables on `<html>`; Meet's inline styles on `<main>` are rewritten by Meet.
- `background/router.js` — message protocol (`tab:hello|bye`, `session:start|update|end`, `settings:get|set`,
  `meeting:get|export|rename|delete`, `archive:open`, `dev:status|ping`). Without the `tabs` permission the SW cannot see
  navigations, so `tab:bye` on `pagehide` schedules an `alarms`-based end that `tab:hello`/`session:start` cancels.
  Ending a meeting auto-downloads Markdown (data: URL; SW has no `URL.createObjectURL`) and drops meetings with no entries.

## Working with Meet's DOM

All Meet hooks live in `content/selectors.js` (fallback chains) and are consumed only through `content/meet-dom.js`.
Rules that were learned the hard way (details in `docs/meet-dom.md`):
- Prefer language-independent hooks: Material icon ligatures (`i.google-symbols` text such as `call_end`,
  `closed_caption_off`, `language`, `chat`), ARIA roles, `jsname`; aria-labels are localized.
- Read caption text with `textContent`, never `innerText` (empty when the overlay is hidden).
- Caption language option: `[role="option"][data-value="uk-UA"]` inside the combobox that contains the `language` icon.
- `.fJsklc` is a generic overlay-layer class (several exist); the captions one is the one containing `[jsname="dsyhDe"]`.
- A button can hold several icons (e.g. `chat` + hidden `chat_bubble`); filter by visible size when locating buttons.
- Anything measured with `getBoundingClientRect()` on the stage is affected by our own transform — use
  `offsetTop/offsetHeight` for layout decisions (a bug here once toggled captions every 2 s).

When Meet changes its DOM, follow `docs/dom-troubleshooting.md`: reproduce in a real call with Claude in Chrome,
dump the structure with the snippets there, update `selectors.js` (add to chains, don't replace), mirror the new
structure in `dev/meet-sim.js`, run `npm test` + the harness, re-test in a real call, and record findings in
`docs/meet-dom.md`.

## Testing notes

- Unit tests cover the builder (`test/transcript.test.js`), storage/router (`test/store.test.js`) and export formats
  (`test/format.test.js`). The harness covers DOM parsing, captions control and the UI without installing anything.
- Real E2E uses Claude in Chrome on the user's Chrome: `meet.google.com/new` joins an empty call immediately; speech
  comes from macOS `say -v Lesya "…"` (uk_UA voice) through the speakers. Screenshots and timers only work while the
  Meet tab is visible; `javascript_tool` runs in the MAIN world (it sees the DOM and shadow roots, not `MT` or
  `chrome.runtime`); Claude in Chrome cannot open `chrome-extension://` pages or `chrome://extensions`.
- Tunable timings and thresholds are listed with their effects in `docs/parameters.md`.

## Commits

Commits go through the user's `git-plugin:create-commit` skill (attribution helper script); title format
`feature|fix|refactor|delete: Imperative summary` (no Jira key in this personal repo), English body of 2–5 sentences.
