# Testing

There are three levels: unit tests in node, a harness in a regular browser without the extension installed, and a real Google Meet call through Claude in Chrome.

## 1. Unit tests

```bash
npm test                                                         # all
node --test test/store.test.js                                   # one file
node --test --test-name-pattern="adopts" test/transcript.test.js # one test by name
```

| File | What it covers |
| --- | --- |
| `test/transcript.test.js` | `TranscriptBuilder`: word-by-word growth, tail revisions, whitespace normalization, several speakers, simultaneous speech, paragraphs at pauses, splitting without cutting words, continuous speech, head truncation, adoption of re-rendered blocks (including history spanning several blocks), refusal to adopt old blocks, system lines, "You" → name, `liveId`, `load()` without id collisions, "no changes" |
| `test/store.test.js` | `store`: settings, creation and updates, resume after a reload and after Rejoin, a new meeting after `RESUME_IDLE_MS`, idempotent `end`, concurrent writes without losing the index, deletion. `router`: `tab:bye` → `scheduleEnd`, `tabGone`, a `tab:hello` from another page ends the meeting at once, reloading the same call keeps the end pending until `session:start`, `sweep()` (vanished tab, lost link + `STALE_MS`, `endedAt` = last update, idempotency) |
| `test/format.test.js` | Markdown, TXT, JSON, file names (sanitizing, truncation), duration of an unfinished meeting. Auto-save only for non-empty meetings and only once; deletion of empty ones; manual export |

The tests import the same files as the extension: `shared/*.js` as side-effect modules, `background/*.js` as ES modules. The clock in `TranscriptBuilder` and `createStore` is injected via `now`.

## 2. Harness (without installing the extension)

```bash
npm run dev
```

- `http://localhost:8765/dev/harness.html?speed=4` — a Meet simulator. Parameters:
  - `speed=1..8` — scenario speed;
  - `cc=on` — captions are on from the start, otherwise the extension has to turn them on;
  - `autoplay=0` — the scenario does not start by itself;
  - `prejoin=1` — the page starts on a "Ready to join?" screen without call controls; "Join now" opens the call. This is how the "outside a call" state is tested.
- The "Harness" panel at the top left:
  - ▶/⏸ and speed;
  - **re-render region** — clones the region the way Meet does; there must be no duplicates;
  - **leave call** — the "You left the meeting" screen;
  - **reset storage** — clears the shim storage.
- `http://localhost:8765/dev/archive.html` — the archive on the same storage.
- `http://localhost:8765/design/mockup.html` — every sidebar state.

The harness loads the content scripts from the `manifest.json` list, `chrome.*` is replaced by `dev/chrome-shim.js`, and the background runs on the real `createRouter()`. Downloads are not saved to files; they go to `window.__downloads`.

Useful checks in the harness console (`MT` is available here because everything runs in a single world):

```js
MT.session.builder.snapshot().map(e => `${e.speaker}: ${e.text}`)
MT.session.status; MT.session.language; MT.session.settings
window.__downloads.map(d => d.filename)
```

Harness limitations:
- it has no `<main>`, so shrinking the stage is not tested;
- it lacks Meet's real behavior: space reserved for captions, the responsive control bar, rAF rendering. These are tested only in a real call.

## 3. Real E2E through Claude in Chrome

Prerequisites:
- the extension is loaded via Load unpacked;
- `npm run dev` is running so edits are picked up automatically;
- the Meet tab is **visible**;
- sound plays through the speakers, not headphones.

1. Open `https://meet.google.com/new`. An empty call is created and opened immediately.
2. Check the startup (snippets from [dom-troubleshooting.md](dom-troubleshooting.md)):
   - `#meet-transcriber-root` exists, `window.__meetTranscriberRaf === true`;
   - CC is on (ligature `closed_caption`), language "Ukrainian (Ukraine)";
   - `<main>` has `inset: 64px 16px 136px` — no space is reserved.
3. Generate speech:

   ```bash
   # "Good afternoon, colleagues. This is a test of the caption recording extension."
   say -v Lesya "Добрий день, колеги. Це перевірка розширення для запису субтитрів."
   ```

4. Compare the text in the sidebar (shadow DOM, snippet 7) with `.ygicle` in Meet's DOM.
5. Scenarios tested on 24.09.2026:
   - **auto language**: manually set English → Leave → Rejoin → Join now → the language switches to Ukrainian by itself;
   - **background tab**: switch to another tab, play a phrase → the text updates (`document.hidden: true`);
   - **overlay**: turn on "Субтитри на екрані" (Captions on screen) → Meet's text is visible; turn it off → `inset` returns to `136px`;
   - **sidebar**: open → the video shifts left, the pill sits next to the group, the chat is visible; close → the video is full-screen;
   - **page reload mid-meeting** → Join now → the same record continues;
   - **Leave call** → a file in `~/Downloads/Meet Transcripts/`; an empty meeting produces no file;
   - **Leave → immediately "Return to home screen"** → the file is saved all the same (`tab:hello` from `/home` ends the meeting);
   - **extension update mid-call** (`touch extension/content/main.js` while `npm run dev` is running):
     - in the tab console: `replaced by a newer content script`, then `resumed <the same id>`;
     - there is one `#meet-transcriber-root`;
     - the phrase from before the update appears in the panel once, new phrases are appended;
     - after "Leave" the file contains both phrases;
   - **lost meeting** (open without a tab, e.g. from a version before 1.1.1) → within ~1–3 min of the extension reload at most, `sweep` saves its file; the meeting's end is the time of its last update.
   - **panel visibility**: the `meet.google.com` home page, the "Join now" screen and "You left the meeting" → `.mt-panel` has `hidden`, there is no `.mt-cb-float` pill, `<html>` has no `mt-panel-open`. In a call, right after joining, the pill is there and the panel is closed (`.mt-panel` without `is-open`, `visibility: hidden`), even if it was open before the reload.
   - **sliding in like Meet's chat** (the tab must be visible; animations stall in the background). Sample `getBoundingClientRect()` of the panel and of `<main>` every ~50 ms after clicking the pill. Expected:
     - within ~0.5 s the panel moves in x from `innerWidth` to `innerWidth − 376`, and the stage width shrinks in sync;
     - the final rectangle equals the `.R3Gmyc` rectangle with the chat open (`940,64 360×695`, `right 16`, `bottom 136` at 1316×895);
     - with the chat open, our panel shifts to `right 392` in sync;
     - without the reactions bar (the `mood` button) the bottom becomes 88 px;
     - closing performs the same motion in reverse, followed by `visibility: hidden`.

### Pitfalls we ran into

- **Screenshots.** `computer screenshot` fails ("Failed to capture screenshot via CDP") when the tab is in the background. Ask the user to bring the window to the front.
- **Background timers.** Chrome throttles timers (≈1/s), and even more for silent tabs after 5 min. The harness in a background tab nearly "stands still".
- **Execution world.** `javascript_tool` runs in the MAIN world: the content script's `MT` and `chrome.runtime` are not available there. Checking `chrome.runtime?.id` in the MAIN world tells you nothing about the extension's state.
- **Output filter.** Output that looks like tokens or base64 is replaced with "[BLOCKED: …]". Do not return `outerHTML`, long class lists or strings made only of digits.
- **Extension pages.** `chrome://extensions` and `chrome-extension://…` are not accessible. In the real extension the archive is opened by a button in the sidebar in a new tab outside Claude's tab group, so test it through `dev/archive.html` or ask the user.
- **Navigation.** After an extension auto-reload the Meet tab does not need to be reloaded: the SW injects the new script itself. The exception is a tab loaded with code older than 1.1.1: then the old and new instances coexist (two `#meet-transcriber-root`), and the tab must be reloaded. A long `await` in `javascript_tool` that is still running during a navigation (e.g. a click on "Rejoin") fails with "Inspected target navigated".
- **Port 8765 in use.** If another process is already listening on 8765, `npm run dev` fails. For the harness and the mockup, `PORT=8766 npm run dev` works: the pages run on any port. The extension's dev-reload expects exactly 8765 (see [parameters.md](parameters.md#dev-tools)).
- **Window size.** `resize_window` resizes the window but not the tab's viewport if emulation is active on it. This does not work for layout tests.
