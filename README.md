# Meet Transcriber

A local Chrome extension for Google Meet. It saves meeting captions (in Ukrainian) together with speaker names.

- Reads Google Meet's built-in captions straight from the page. No API or external servers are needed, and no data leaves your computer.
- Shows the transcript in a sidebar styled like Meet's own side panels.
- Hides Meet's native captions overlay so it takes no space from the video. You can bring it back with the "Субтитри на екрані" (Captions on screen) toggle.
- Turns captions on when you join a call and switches the recognition language to Ukrainian.
- Stores everything locally in `chrome.storage.local`. Includes a searchable meeting archive and export to Markdown, TXT or JSON.
- Saves a `.md` file to `Downloads/Meet Transcripts/` automatically when a meeting ends.

The extension UI is in Ukrainian.

## Installation

1. Download **Source code (zip)** of the latest release from the [Releases](https://github.com/ddanilyuk/meet-transcriber/releases) page and unpack it into a permanent folder (or clone the repository).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder.

Requires Chrome 116 or later. The full guide (first call, permissions, updates, troubleshooting) is in
[docs/installation.md](docs/installation.md).

## Usage

1. Join a Google Meet call. The extension turns captions on and sets the language to "Ukrainian (Ukraine)".
2. During the call a **"Транскрипт"** (Transcript) button appears at the bottom right, next to Meet's controls. There is no button or panel on the Meet home page, on the "Join now" screen or after you leave. A red dot on the button means recording is on. Recording continues while the panel is closed. The panel always starts closed and opens only from this button. It slides in from the right like Meet's own chat and takes its place, or sits to the left of the chat if the chat is open. The panel has:
   - a live transcript grouped by speaker, with a timestamp for every line;
   - search with highlighting;
   - the **"Субтитри на екрані"** (Captions on screen) toggle that shows Meet's native captions;
   - copy as Markdown, download (.md / .txt / .json), the archive and settings.
3. When you leave the call, the meeting ends and is saved to a file. The same happens if you close the tab or go straight to the Meet home page. If the extension is updated or reloaded mid-call, recording continues on its own and you don't need to reload the page. A meeting that nothing records any more (for example after a browser restart) is ended and saved automatically within a few minutes.
4. **Archive**: the extension icon in the Chrome toolbar or the button in the sidebar. It lists meetings by day and supports full-text search, renaming, export and deletion.

Settings (⚙ in the sidebar or in the archive):

| Setting | Default |
| --- | --- |
| Автоматично вмикати субтитри (Turn captions on automatically) | on |
| Ставити українську мову (Set Ukrainian language) | on |
| Зберігати файл після мітингу (Save a file after the meeting) | on |
| Субтитри на екрані (Captions on screen) | off |

## How it works

- `content/page-raf.js` runs in the MAIN world. Chrome pauses `requestAnimationFrame` in background tabs, and then Meet stops updating captions in the DOM. The script routes rAF to timers, so recording continues while you are in another tab.
- `content/caption-tracker.js` watches the captions region with a `MutationObserver`. `shared/transcript.js` turns Meet's stream of edits into stable lines: appended words, tail corrections, pauses, truncated long blocks and region re-renders.
- `content/page.css` collapses the captions overlay before Meet measures it, so Meet doesn't reserve space for it.
- `background/` is the service worker, the only writer to storage. It also tracks meeting tabs and downloads.
- All Meet DOM selectors live in `content/selectors.js`, with fallbacks. Notes from the live DOM recon are in [docs/meet-dom.md](docs/meet-dom.md).

All documentation is in [docs/](docs/README.md): architecture, parameters, a runbook for Meet DOM changes, testing, design and the development log.

## Development

```bash
npm test          # unit tests (node:test, no dependencies)
npm run dev       # dev server on http://localhost:8765
npm run icons     # regenerate the icons
npm run store     # build dist/meet-transcriber-<version>.zip for the Chrome Web Store
```

Publishing to the Chrome Web Store is described in [store/README.md](store/README.md).

While `npm run dev` is running:
- the unpacked extension reloads itself as soon as files under `extension/` change, and injects the new code into open Meet tabs;
- `http://localhost:8765/dev/harness.html` is a Meet simulator with a 1:1 DOM structure and a stream of Ukrainian captions. Parameters: `?speed=4`, `?cc=on`, `?autoplay=0`, `?prejoin=1` (start on the "Ready to join?" screen);
- `http://localhost:8765/dev/archive.html` is the archive on the same storage as the harness;
- `http://localhost:8765/design/mockup.html` is a mockup of the sidebar in every state.

## Limitations

- Meet captions contain only what Google recognized. Ukrainian is marked BETA there and has no punctuation.
- Meet's DOM classes are obfuscated and change over time. If captions can no longer be found, the sidebar shows a warning. The fix will most likely be needed only in `content/selectors.js`.
- If Chrome's "Ask where to save each file before downloading" is on, the automatic save opens a dialog.
- In a muted background tab (for example when you are alone in the call) Chrome throttles timers. Captions then arrive less often, in batches, and pauses between lines are detected less precisely.

## Privacy

Transcripts never leave your computer. See [docs/privacy.md](docs/privacy.md).

## License

[MIT](LICENSE).
