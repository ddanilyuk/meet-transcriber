# Installation

Meet Transcriber is not published in the Chrome Web Store. It is installed as an unpacked extension
("Load unpacked") from a folder on your computer. It takes about two minutes.

## Requirements

- Google Chrome 116 or later on a desktop (macOS, Windows, Linux). Mobile is not supported.
- Google Meet in the browser. Meet captions must be available for your account (they are in regular Google Workspace).
- For development only: Node.js 20+. Regular use does not need Node.

## Install from GitHub Releases

1. Open the [Releases](https://github.com/ddanilyuk/meet-transcriber/releases) page and download
   **Source code (zip)** of the latest release (the "Assets" section under the release notes).
2. Unpack the archive into a permanent folder, for example `~/Apps/meet-transcriber/`. **Do not delete or move it
   later**: Chrome loads an unpacked extension straight from this folder on every start.
3. In Chrome, open `chrome://extensions` (paste the address into the address bar).
4. Turn on **Developer mode** (the toggle at the top right).
5. Click **Load unpacked** and select the `extension/` folder inside the unpacked archive (the one that contains
   `manifest.json`), not the archive root.
6. "Meet Transcriber" appears in the list. Done.

Developers may prefer to clone the repository and load `extension/` from the clone, so updating is a `git pull`
(see "Development" in the [README](../README.md)). Steps 3–6 are the same.

## After installing

- **Pin the icon.** Click the puzzle icon to the right of the address bar and pin "Meet Transcriber". Clicking the
  icon opens the meeting archive.
- **Chrome warning.** After a restart Chrome may show "Disable developer mode extensions" with a list of unpacked
  extensions. This is the standard warning for any extension installed with Load unpacked. Close it with the cross
  or click **Cancel**: the extension keeps working.
- **Download settings.** If Chrome's "Ask where to save each file before downloading" is on
  (`chrome://settings/downloads`), a save dialog opens after every meeting. Turn it off so files are saved on their own.

## First call

1. Join any Meet call (`meet.google.com/new` works for a test: an empty call opens immediately).
2. The extension turns Meet captions on and sets the recognition language to "Ukrainian (Ukraine)". Meet's native
   captions overlay is hidden and takes no space under the video.
3. A **"Транскрипт"** (Transcript) button appears at the bottom right, next to Meet's controls. A red dot on it means
   recording is on. Click it to open the panel with the live transcript. Recording continues while the panel is closed.
4. Say a few sentences (or unmute and let someone else speak). Lines appear in the panel with the speaker's name and
   the time.
5. Click **Leave call**. The meeting ends, and a file named `YYYY-MM-DD HH-MM <meeting title>.md` appears in
   `Downloads/Meet Transcripts/`. An empty meeting produces no file.

All meetings also stay in the archive (the extension icon or the button in the panel): a list by day, full-text search,
renaming, export to Markdown / TXT / JSON, deletion.

## Settings

⚙ in the panel or in the archive. The UI is in Ukrainian; English translations are in parentheses.

| Setting | Default | What it does |
| --- | --- | --- |
| Автоматично вмикати субтитри (Turn captions on automatically) | on | Turns Meet CC on when you join a call. Without it nothing is recorded until you turn CC on yourself. |
| Ставити українську мову (Set Ukrainian language) | on | Switches the recognition language to Ukrainian once per call. |
| Зберігати файл після мітингу (Save a file after the meeting) | on | Downloads a `.md` automatically after you leave the call. |
| Субтитри на екрані (Captions on screen) | off | Shows Meet's native captions overlay over the video. |

## Permissions the extension asks for

| Permission | Why |
| --- | --- |
| `storage`, `unlimitedStorage` | Transcripts are stored in `chrome.storage.local`. Without `unlimitedStorage` the limit would be 10 MB. |
| `downloads` | The automatic `.md` save and manual export. |
| `alarms` | Ends a meeting when its tab was closed, and runs a check for "lost" meetings every minute. |
| `scripting` + `https://meet.google.com/*` | After an extension update, injects the fresh script into Meet tabs that are already open so recording is not interrupted. |
| `http://localhost:8765/*` | Development only: auto-reload during `npm run dev`. Outside development the extension makes one request to localhost when Meet opens and nothing after that. |

No data is sent anywhere. There are no servers, no analytics and no external requests apart from the local dev server.

## Updating

Download **Source code (zip)** of the new release, replace the folder contents with the new ones (so `extension/`
stays at the same path), then `chrome://extensions` → **Reload** (the circular arrow on the extension card). If the
extension is installed from a cloned repository, run `git pull` instead of replacing the folder, then the same **Reload**.

If a call was open during the update, recording continues on its own: the new version takes over the tab without a
page reload. Exception: tabs opened with a version older than 1.1.1 need one reload.

Release notes for every version are on the [Releases](https://github.com/ddanilyuk/meet-transcriber/releases) page.

## Uninstalling

**Remove** in `chrome://extensions`. Chrome deletes the extension's `chrome.storage.local` together with it, which means
the whole archive. If you need it, export the meetings from the archive first. Files in `Downloads/Meet Transcripts/` stay.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No "Транскрипт" (Transcript) button in the call | The button exists only during a call: never on the Meet home page, the "Join now" screen or after leaving. Check that the extension is enabled in `chrome://extensions` and that the window is not incognito. Reload the Meet tab. |
| The panel warns that captions were not found | Turn CC off and on by hand. If that doesn't help, Google Meet changed its markup: see [dom-troubleshooting.md](dom-troubleshooting.md). |
| The language does not switch to Ukrainian | The switch happens once per call. Set the language by hand in Meet's caption settings (the ⚙ next to CC). If Ukrainian is not in the list, your account doesn't have it. |
| No file after the meeting | An empty meeting produces no file. Check the "Зберігати файл після мітингу" (Save a file after the meeting) setting and whether Chrome's "Ask where to save each file" is on. The meeting is always in the archive: export it by hand. |
| Two panels in the call after an update | The tab was opened with a version older than 1.1.1. Reload it and click "Join now". |
| Text arrives late in a background tab | Chrome throttles timers in muted tabs. This is expected: lines arrive in batches but are not lost. |

How the extension works is described in the [README](../README.md) and [architecture.md](architecture.md).
