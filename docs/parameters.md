# Parameters

All numeric thresholds and timings of the extension, where they are defined and what happens if you change them. The values are tuned to Meet's behavior as measured on 24.09.2026 (see [meet-dom.md](meet-dom.md)). If you change anything in `shared/transcript.js`, run `npm test` first: almost every threshold there is covered by a test.

## User settings

Stored in `chrome.storage.local` → `settings`. The defaults are defined twice and must be kept identical: `DEFAULT_SETTINGS` in `background/store.js` and in `content/session.js`.

| Key | Default | What it does |
| --- | --- | --- |
| `autoCaptions` | `true` | Turns CC on when joining a call. If CC gets turned off, makes up to 3 attempts per session to turn it back on. |
| `autoUkrainian` | `true` | Once per session, when the captions region appears, selects `uk-UA` in the "Meeting language" combobox. |
| `showOverlay` | `false` | Shows Meet's native captions overlay. When the value is `false`, the overlay is collapsed (`html.mt-hide-captions`). |
| `autoDownload` | `true` | After a meeting with utterances ends, saves a `.md` file to `Downloads/Meet Transcripts/`. |

The "panel open" state is not persisted. The panel opens only from the button and is closed on every page load and every new call. The `meetTranscriber:panelOpen` key in Meet's `localStorage` is left over from versions before 1.0.0 and is no longer read.

## Caption merging — `extension/shared/transcript.js` (`DEFAULTS`)

| Parameter | Value | Meaning | If decreased / increased |
| --- | --- | --- | --- |
| `pauseMs` | 4000 | How long a silence lasts before new text in the same Meet block becomes a new paragraph (entry) with a new timestamp. It also determines how long an entry stays "live". | Lower: more small paragraphs, the "now" highlight shows up more often. Higher: long paragraphs and an inaccurate start time. |
| `anchorLen` | 24 | Length of the fragment used to find the continuation of a block after head truncation and to match during adoption. | Lower: higher risk of a false match. Higher: a truncation that shifted by fewer than 24 characters is not recognized. |
| `minAnchor` | 12 | Minimum overlap for two texts to be considered the same block. | Lower: false merges. Higher: missed merges, i.e. duplicates. |
| `adoptWindowMs` | 15000 | How long a block that disappeared from the DOM can be "adopted" by a re-rendered block with the same text. | Lower: duplicated history if Meet re-renders slowly. Higher: a new utterance with the same beginning ("Так, …", "Yes, …") can get glued to the old one. |
| truncation heuristic | `prev > 80` characters, `cur < 0.8·prev`, common prefix `< minAnchor` | The condition under which Meet is considered to have cut off the head of a block. | A condition that is too loose confuses an ordinary revision with truncation. |
| `selfLabels` | `you`, `ви`, `вы` | Labels of your own speech that are replaced with your name from the self-view tile. | For a new Meet UI language, add its label here. |

## Caption tracker — `content/caption-tracker.js`

| Parameter | Value | Meaning |
| --- | --- | --- |
| `throttleMs` | 150 | Scan delay after a batch of mutations. Meet updates the text roughly every 330 ms. |
| `checkMs` | 1000 | Interval for checking whether Meet replaced the region node. The same tick ends the "live" state when there are no mutations. |

## Session — `content/session.js`

| Parameter | Value | Meaning |
| --- | --- | --- |
| `POLL_MS` | 1000 | Main loop: in a call or not, CC state, language, name, title. |
| `SAVE_DEBOUNCE_MS` | 1500 | Debounce for sending `session:update` to the SW. An immediate save also happens on `pagehide` and on ending. |
| `LEAVE_MISSES` | 3 | How many consecutive polls without the `call_end` button are needed to consider that the user has left. Protects against momentary re-renders. |
| `NOT_FOUND_MS` | 10000 | How long CC can be on without a found region before the status "Не вдається знайти субтитри" (Can't find captions) appears. This is a sign that the selectors broke. |
| `CC_ATTEMPTS` | 3 | How many times per session the extension turns CC back on. No attempt is made while Meet's captions popup is open: the user is changing something there. |
| `CC_RETRY_MS` | 8000 | The first attempt runs as soon as the call is detected; later attempts wait this long after the previous one. Lower: captions the user switched off come back sooner (and more annoyingly). |
| `RECLAIMS_MAX` | 1 | How many times per meeting the extension toggles CC off/on so that Meet re-measures the collapsed overlay. In the new UI this is a popup round trip the user sees, so once. |
| `RECLAIM_CONFIRM_MS` | 1000 | The reservation must still be there after this long before the toggle runs: Meet's layout settles late after joining. |
| `reclaimSpaceSoon` delay | 1500 / 600 ms | After the region appears or after "Субтитри на екрані" (Captions on screen) is turned off. |
| `session.inCall` tolerance | `LEAVE_MISSES` polls | The sidebar hides the panel and the button only when the session says the call is over, so a one-poll rebuild of Meet's control bar does not flash the UI. |

## Captions control — `content/captions-control.js`

| Parameter | Value | Meaning |
| --- | --- | --- |
| `spaceReserved()` threshold | 150 px | Distance from the bottom edge of the stage (`<main>`, the layout box via `offset*`) to the "Leave call" button. Normally it is ~70 px, with space reserved for captions ~280 px. |
| `setUkrainian()` timeouts | 3000 / 2000 / 2000 ms | Waiting for the combobox, for the `uk-UA` option and for confirmation that the language changed. |
| `remeasure()` timeouts | 2000 + 300 + 3000 ms | Waits for CC to turn off, pauses, waits for the new region. |
| `POPUP_CLOSE_MS` | 800 | After clicking the menu button to close the captions popup, how long to wait for it to leave the DOM before clicking once more. Shorter than Meet's close animation would toggle it open again. |
| `REACTIONS_BACK_MS` | 1500 | After the popup closed, how long Meet gets to bring the reactions bar back (`aria-pressed` of "Send a reaction") before the extension clicks that button itself. Only when the bar was on before the round trip. Every round trip is logged to the console with these states. |
| `mt-hide-captions` / `data-mt-caption-root` | — | The class on `<html>` and the attribute that `content/page.css` relies on. |
| `mt-pip-style` | — | The `<style>` appended to Meet's picture-in-picture document on `enter` (and re-checked every poll). It only sets `visibility: hidden` on the captions region there (`sel.pipCaptionContent`) while `mt-hide-captions` is on the PiP `<html>`; the band's 160 px layout box is never changed, because collapsing it was followed by Meet closing its reactions bar (`docs/meet-dom.md`). |
| `reactions bar on\|off` log | — | `captions.watchReactions()` logs every flip of "Send a reaction" `aria-pressed` with the tab's hidden state and duration, PiP size, popup state, `toggling`, `spaceReserved()` and the session's `status`/`reclaiming`/`ccAttempts`. Diagnostics for the intermittent loss of the bar; no behaviour attached. |

## Sidebar — `content/sidebar/sidebar.js`, `sidebar.css`

| Parameter | Value | Meaning |
| --- | --- | --- |
| `--mt-top` / `--mt-bottom` | usually 64 / 136 px (88 without the reactions bar) | `MT.dom.sidePanelBox()`: inline `top`/`bottom` of the native panel slot + its padding. Fallbacks: the inline insets of `<main>`, then `innerHeight − top(Leave) + 16` (or 96). |
| `--mt-right` | 16 px; 392 px while a native panel is open | The right inline inset of `<main>` (Meet's target value). Fallback: the rectangle of `.R3Gmyc`. |
| `--mt-width` | 360 px | Width of Meet's native panel. |
| `--mt-slide` | `500ms cubic-bezier(0.4, 0, 0.2, 1)` | The panel slide-in and the `top/right/bottom` transitions. This is the value from Meet's `ASIDE.R3Gmyc` and `<main>`. The same transition for the stage `transform` is set in `page.css`. |
| stage scale | `(w − 360 − 16) / w`, minimum 0.4 | Shrinks Meet's `<main>` to the left of the panel. `w`/`h` come from `MT.dom.stageSize()`: the container minus the inline insets, i.e. the target size, even while Meet is animating. `translateY` centers the result. |
| `PILL` / `GAP` | 56 / 8 px | The pill button to the left of Meet's right button group. If less than 12 px is left before the center group, the pill moves above the group. |
| `AT_BOTTOM_PX` | 48 | Threshold for "the user is at the bottom of the list". Below it: auto-scroll; above it: the "Нові репліки" (New utterances) pill. |
| `EXIT_MS` | 160 | How long a closing menu, snackbar or "new replies" pill stays in the DOM with `is-closing` for its exit animation (the CSS animations are 120–160 ms). |
| tick | 1000 ms | Repositions the pill next to Meet's control group and notices when Meet replaced the stage or the panel slot. It works on anchors cached in `MT.dom` and does not re-render the panel; transcript updates re-render only the list. |
| search debounce | 80 ms | |
| snackbar | 3000 ms | |

## Storage and background — `background/store.js`, `background/sw.js`

| Parameter | Value | Meaning |
| --- | --- | --- |
| `RESUME_IDLE_MS` | 10 min | After a page reload or rejoining with the same code, the meeting continues in the same record if the last update was no longer ago than this. |
| `RESUME_AFTER_END_MS` | 5 min | …and if the meeting ended no longer ago than this (an accidental leave and Rejoin). |
| `END_GRACE_MIN` | 1.5 min | Alarm after `tab:bye`. If the tab has not returned to the same call (`session:start`) within this time, the meeting ends and is saved. |
| `STALE_MS` (`router.js`) | 2 min | An open meeting with no tab link and no updates for longer than this is considered ended by `sweep()`. This is enough time for a reinjected script to link a live call again. |
| `SWEEP_PERIOD_MIN` (`sw.js`) | 1 min | Period of the `sweep` alarm. The alarm is created on `onInstalled` and `onStartup`, and on `onStartup` `sweep()` itself also runs immediately. |
| empty meetings | — | A meeting without utterances is deleted when it ends; no file is created for it. |
| file name | `Meet Transcripts/YYYY-MM-DD HH-mm <title>.<ext>` | The title is truncated to 80 characters, the characters `<>:"/\|?*` and control characters are replaced. `conflictAction: uniquify`. |

## Dev tools

| Parameter | Where | Value |
| --- | --- | --- |
| dev server port | `dev/server.mjs` (`PORT`), `background/dev-reload.js`, `host_permissions` in the manifest | 8765. If you change it, change it in all three places. |
| dev-reload ping | `content/main.js` | 2000 ms, only when `installType === 'development'` and the server responds |
| `/__version` timeout | `background/dev-reload.js` | 800 ms |
| `__devLoadedVersion` | `chrome.storage.local` | The version the extension last reloaded with (protection against a race). |
| `WORD_MS` | `dev/meet-sim.js` | 330 ms per word, divided by `?speed=` |
| rAF fallback timer | `content/page-raf.js` | 16 ms. In the background Chrome still throttles timers to ~1/s, and for silent tabs after 5 min to ~1/min. |

## Manifest permissions

| Permission | Why |
| --- | --- |
| `storage`, `unlimitedStorage` | Transcripts in `chrome.storage.local` without the 10 MB limit. |
| `downloads` | Auto-save and export to the `Meet Transcripts/` folder. |
| `alarms` | Ending a meeting if the tab was reloaded or navigated away without "Leave call", and the per-minute `sweep`. |
| `scripting` | After the extension is installed, reloaded or updated, injects the content scripts into already open Meet tabs so the call keeps being recorded. |
| `host_permissions: https://meet.google.com/*` | For `scripting` and for `tabs.query({ url })` over Meet tabs. No new warnings: the content scripts already have access to this site. |
| `host_permissions: http://localhost:8765/*` | Only for dev-reload. |

There is deliberately no `tabs` permission: the SW sees the URLs of Meet tabs only, not of all tabs. Hence the `tab:hello` / `tab:bye` mechanism.
