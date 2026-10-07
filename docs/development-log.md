# Development log

A chronology of the first version: what was done, which decisions were made and why, and which bugs turned up in the real Meet. Everything was done on 24.09.2026 in a single session with Claude Code.

## Requirements

- **Extension:** a local Chrome extension for Google Meet that reads **Meet's Ukrainian captions** from the page.
- **Storage:** the text of every meeting, together with the speakers, is stored locally.
- **Design:** a sidebar that looks native in Meet; the design has to be worked out first.
- **Captions:** Meet's own captions are hidden but can still be viewed.
- **Process:** a git repository with step-by-step commits; testing through Claude in Chrome.

The user's decisions before the start:

| Question | Choice |
| --- | --- |
| Where the sidebar lives | A panel inside Meet, not `chrome.sidePanel` |
| Storage | `chrome.storage.local`, an archive, export and **`.md` auto-save** after the meeting |
| Language | Turn on CC and select Ukrainian automatically |
| E2E | A test meeting with the macOS voice `say -v Lesya` |
| Commits | Commit independently from here on, in the format of the `git-plugin:create-commit` skill |

## Stages

| # | Commit | What was done |
| --- | --- | --- |
| 0 | — | Studied open-source extensions (TranscripTonic, zenmz/meet-transcript, recall.ai, gMeetTranscriptCapture, chen-ye, meet-captions-collector, openclaw): selectors, merge algorithms, hiding, language. Drew a wireframe. |
| 1 | `58263b2` | Scaffold: `package.json` (no dependencies), README, `.gitignore`. |
| 2 | `a7797ec` | Live DOM recon in a real call → [meet-dom.md](meet-dom.md). |
| 3 | `2fdb331` | Design: `sidebar.css`, `templates.js`, icons, Ukrainian strings, `design/mockup.html`. |
| 4 | `9b9dd57` | MV3 skeleton: manifest, module SW, icons (`scripts/make-icons.mjs`, plain node+zlib), rAF patch, dev server and dev-reload. |
| 5 | `f488e54` | `TranscriptBuilder` and 18 unit tests. |
| 6 | `aabd6f5` | Scraper: `selectors.js`, `meet-dom.js`, `caption-tracker.js`; harness (`dev/meet-sim.js`, `chrome-shim.js`). |
| 7 | `053fa7a` | Captions control: auto-CC, `uk-UA`, hiding the overlay. |
| 8 | `6790421` | Storage with a write queue, router, session lifecycle, resume, `tab:hello/bye` + `alarms`. |
| 9 | `fbcf79d` | Sidebar: slots, per-turn reconciliation, search, menu, settings, copying. |
| 10 | `316a47e` | md/txt/json export and `.md` auto-save to `Downloads/Meet Transcripts/`. |
| 11 | `08eaa16` | Archive: grouping by day, full-text search, renaming, export, deletion, settings. |
| 12 | `559b693`, `70a504c`, `3f21e12` | Fixes after the real E2E (see below). |
| 13 | `4a4c3f8` | README (installation, usage, development, limitations), additions to [meet-dom.md](meet-dom.md). |
| 14 | `82cebe8` | `CLAUDE.md` and the documentation in `docs/`. |
| 15 | `01ad2aa`, `29647bd` | Panel only during a call; a "Ready to join?" screen in the harness (`?prejoin=1`). |
| 16 | `72314fb` | Version 1.0.0, tag `v1.0.0`, private repository `github.com/ddanilyuk/meet-transcriber` (via `gh`). |
| 17 | `3cc17f5`, `40b94f1` | The panel starts closed and opens only from the button. It slides in like Meet's native chat: the same `transform`, 0.5 s, the same curve. The geometry is taken from Meet's target layout (see [meet-dom.md](meet-dom.md#side-panel-motion-and-layout-targets-2026-09-24)). |
| 18 | `dc46e3c` | Version 1.1.0, tag `v1.1.0`: the updated panel UI (stage 17). GitHub Releases for 1.0.0 and 1.1.0 (a zip of `extension/`; these zips were later removed, and installation uses the release's automatic "Source code" archive). |
| 19 | `7a2b984`, `d4b6f94`, `658fbae` | Bug fix for "left the call, but the meeting is still recording and there is no file": ending on a `tab:hello` from another page, `sweep()` for lost meetings, reinjecting the content scripts after an extension update with a takeover of the call. Version 1.1.1. |

## Live recon findings

These findings are described in detail in [meet-dom.md](meet-dom.md).

1. **Captions region.** Structure: `div[role=region][aria-label=Captions][tabindex=0]` → blocks `.nMcdL` → speaker `.NWpY1d`, text `.ygicle`. The text is split across many text nodes.
2. **Language.** The "Meeting language" combobox has 91 options. Ukrainian has `data-value="uk-UA"`. The language can be selected with a programmatic click.
3. **One block per speaker.** While a person is speaking, Meet keeps appending to one block for minutes: a block grew to 1264 characters in ~6 min. Head truncation was not observed, but the protection against it was kept.
4. **Background tab.** When the tab is hidden, Meet recognizes speech but **does not update the DOM**: 0 mutations, then a batch of 48 as soon as the tab is visible again. Redirecting `requestAnimationFrame` to timers fixes this. Spoofing `visibilityState` is not needed.
5. **Hiding and text.** `innerText` is empty under `visibility:hidden`, so text must be read only with `textContent`.
6. **Meet's 2026 side panels are dark** (`#202124`), so the design was reworked for a dark theme.

## Bugs found in the real Meet and their fixes

| Bug | Cause | Fix |
| --- | --- | --- |
| Captions are hidden, but a black strip remains under the video and the video is not full-screen (noticed by the user) | Meet measures the captions overlay height **at the moment CC is turned on** and reserves it under the video (`inset … 352px` instead of `136px`). Any hiding after that changes nothing, and neither does a synthetic `resize`. | `page.css` collapses the container with the rule `.fJsklc:has([jsname="dsyhDe"])` before the measurement. Fallback: `remeasure()` (CC off/on) at most 2 times. Commit `70a504c`. |
| CC was toggled off and on every 2 s | `spaceReserved()` measured `getBoundingClientRect()` of the stage, which we had shrunk ourselves with a `transform`, so it kept "seeing" a reservation. | Measure the layout box via `offsetTop/offsetHeight`; limit `reclaims ≤ 2`. |
| The "Транскрипт" (Transcript) button ended up inside the chat button | The chat button holds two icons (`chat` + a hidden `chat_bubble`), and the algorithm took it for two "neighbors". | Look only for visible buttons that are horizontally apart. |
| The chat button disappeared, and later our button disappeared too | Meet's control bar is responsive: a foreign node made Meet hide the chat (width 0), and the node was dropped when the group was rebuilt. | The button became a separate "pill" next to the group; Meet's DOM is not modified. |
| The sidebar covered the video | Native panels shrink the stage through Meet's layout model; that is not accessible from outside. | Scale `<main>` via `data-mt-stage` and CSS variables. |
| Meeting title "Meeting details" | Right after joining, `[jsname="NeC6gb"]` temporarily contained different text. | The title is taken from `document.title`; it auto-updates only when that changes and without overwriting renames. |
| After an extension auto-reload the old code was running | The new SW took the current file hash as its baseline, so edits that arrived during the reload were lost. | Store the version the reload happened with in `storage.local` (`559b693`). |
| The transcript panel was shown on the Meet home page (noticed by the user) | The panel was rendered from a saved "open" flag (`localStorage`), regardless of whether a call was in progress. | Visibility requires `Sidebar.inCall()` (session + the "Leave call" button); the flag remained a preference (`01ad2aa`). Verified in Chrome: home page, "Join now", call, "You left the meeting". |
| The panel opened by itself after the page loaded (noticed by the user) | The "open" state was stored in Meet's `localStorage`. | The state is not persisted and is reset when the session ends (`3cc17f5`). |
| The panel appeared without sliding in, did not match Meet's chat in height and overlapped the reactions bar (noticed by the user) | The animation was a 200 ms fade + 24 px. The bottom was computed from the "Leave call" button + 16 and ignored the reactions bar. | Slide in like `ASIDE.R3Gmyc`. The bounds come from the inline styles of the slot and `<main>`. A `MutationObserver` keeps the motion in sync with Meet (`40b94f1`). |
| The stage scale lagged by ~1 s when Meet's chat opened | The stage's `offsetWidth` is still the old one at the start of Meet's animation. Our `transition` rule for `<main>` was overridden by Meet's rule, so the `transform` was not animated at all. | `MT.dom.stageSize()` takes the target inline insets. `transition … !important` in `page.css` (`40b94f1`). |
| After leaving the call the meeting was still "recording", and the file was not saved (noticed by the user) | The extension reloaded mid-call (a version change during dev-reload). The content script in the tab was "orphaned": without `chrome.runtime` it could neither save nor send `session:end`, but the red dot stayed. `storage.session` with the tab links was cleared, so the SW could not end the meeting either. Reproduced in the real Meet (`swu-kxdc-wpb`). | On `onInstalled` the SW injects the scripts into open Meet tabs, and the new instance takes over the call (`658fbae`). `sweep()` ends lost meetings (`d4b6f94`) and that is how it rescued the user's meeting `cnb-pxty-hzz`. |
| Leave → a quick move to the Meet home page left the meeting open forever | The new page's `tab:hello` cancelled the scheduled end even when it was no longer a call. | Only `session:start` cancels the end, and a `tab:hello` with another code ends the meeting at once (`7a2b984`). |
| After a takeover the history on screen would be duplicated | The new `TranscriptBuilder` sees the existing caption blocks as new DOM nodes. | `load()` makes the loaded blocks available for adoption and restores the user's own name (`658fbae`). |
| Empty meetings piled up in the archive | Joining a call without any speech created a record. | Empty meetings are deleted when they end (`3f21e12`). |
| In the harness: `insertAdjacentHTML` on a `ShadowRoot`; search did not filter | `ShadowRoot` has no `insertAdjacentHTML`; after dispatch `e.target` is retargeted to the shadow host. | A container inside the shadow root; the field value is read synchronously. |
| In the harness: adoption did not work | The old block was released after the new one had been processed in the same snapshot. | Release vanished blocks at the start of `update()`. |

## What was verified at the end

- **Unit tests:** 37/37.
- **Harness:** streaming, revisions, system lines, "You" → name, re-renders without duplicates, CC, language, overlay, search, menu, downloads, resume, archive.
- **Real Meet:**
  - CC and Ukrainian turn on automatically (including from English);
  - recording works in a background tab;
  - no space is reserved for the hidden captions;
  - the sidebar shrinks the video;
  - the pill sits next to the group, and the chat is visible;
  - the overlay turns on and off;
  - the session continues after a page reload;
  - the file is saved after "Leave call", and an empty meeting produces no file;
  - after an extension update mid-call, recording continues in the same record without duplicates, and the file after "Leave" contains the phrases from before and after the update. `sweep` saved a lost meeting a minute after the extension reload;
  - the panel starts closed. Sliding in and out takes 0.5 s, in sync with the stage. The rectangle matches Meet's chat: next to it the panel shifts to `right 392`, and without the reactions bar it drops to `bottom 88`.

## Known open issues

- The archive in the real extension was not verified directly: Claude in Chrome cannot open `chrome-extension://`. The same code was verified on `dev/archive.html`.
- A meeting with several participants was not tested in the real Meet, only in the harness.
- The `.fJsklc` class in the `:has()` rule is obfuscated. When it changes, the `remeasure()` fallback kicks in: that is a brief CC toggle, so the rule should be updated (see [dom-troubleshooting.md](dom-troubleshooting.md)).
- Scaling the stage for the sidebar also shrinks the name labels on the tiles. Meet's native panels do not shrink them.
