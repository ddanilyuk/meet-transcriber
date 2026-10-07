# Architecture

## Principles

- **Local only.** No external requests or fonts (the "Архів" (Archive) page uses system fonts, the sidebar uses the fonts the Meet page has already loaded). The only network access is `http://localhost:8765` for dev-reload.
- **No build step, no dependencies.** The extension is loaded from `extension/` as is. Shared code is not imported as modules but registers itself on `globalThis.MT`, so the same file works as a content script, as an import in the service worker and as a module in node tests.
- **Do not interfere with Meet's DOM.** Our own UI lives in shadow roots. We change Meet only through CSS from the manifest (`content/page.css`), marker attributes (`data-mt-caption-root`, `data-mt-stage`) and clicks on its own controls (CC, language).
- **Single writer.** Only the service worker writes to `chrome.storage.local`, through a queue, so concurrent messages do not lose the index.

## Execution contexts

```
meet.google.com
├── MAIN world, document_start
│   └── content/page-raf.js          rAF → setTimeout while the tab is hidden
└── isolated world, document_idle     (order = order in manifest.json)
    ├── shared/icons.js, util.js, strings.js, transcript.js, format.js
    ├── content/selectors.js          all Meet DOM hooks (fallback chains)
    ├── content/meet-dom.js           read-only DOM queries (MT.dom)
    ├── content/caption-tracker.js    MutationObserver → TranscriptBuilder
    ├── content/captions-control.js   CC, language, overlay collapse, remeasure
    ├── content/session.js            meeting lifecycle (MT.MeetingSession)
    ├── content/sidebar/templates.js  HTML templates (shared with design/mockup.html)
    ├── content/sidebar/sidebar.js    panel, pill button, stage shrinking
    ├── content/main.js               MT.send(), dev-reload pings, startup
    └── content/page.css              CSS that affects Meet (manifest "css")

service worker (module)
├── background/sw.js                  wiring of chrome.* APIs: storage, alarms, downloads, tabs, scripting (reinjection)
├── background/router.js              message protocol (pure, deps injected)
├── background/store.js               storage schema + write queue (pure)
└── background/dev-reload.js          auto-reload of the unpacked extension

extension page
└── archive/archive.html|js|css       archive: reads storage directly, writes through the SW
```

## Data flow

```
Meet DOM (region > .nMcdL blocks)
   │  MutationObserver (childList, subtree, characterData)
   ▼
CaptionTracker ── throttle 150 ms ──► MT.dom.parseBlocks() → [{key: <element>, speaker, text}]
   ▼
TranscriptBuilder.update(blocks) → entries [{id, block, speaker, text, startedAt, updatedAt, self?}], liveId
   ▼ onChange
MeetingSession ── debounce 1.5 s ──► MT.send('session:update', {id, patch})
   │                                        │
   ▼ emit('transcript')                     ▼ chrome.runtime.sendMessage
Sidebar.render()                     router → store.update() → chrome.storage.local
                                                              │ storage.onChanged
                                                              ▼
                                                        archive.js (live update)
```

### TranscriptBuilder

Meet keeps **one block per speaker turn** in the DOM. Words are appended every ~330 ms, the tail is rewritten as recognition refines it, and a single block can keep growing for minutes. The builder:

1. **Tracks a block** by its DOM element (`key`). A new element becomes a new block, and an element that disappears becomes final.
2. **Splits a block into segments** at pauses (`pauseMs`). A segment is a range `[start, end)` of the block's text, with one entry per segment. The text of all segments is recomputed from the block's current text, so tail revisions land in the correct paragraph.
3. **Handles head truncation.** If the text shrinks sharply and no longer starts like the previous one, the builder finds where the new text starts inside the old one and shifts the segment boundaries. Text that has left the window is kept in the segment's `base`, and a segment that has left it entirely is frozen.
4. **Does adoption.** When Meet re-renders the region, the old elements disappear and new ones show the same text. A new block with the same speaker and the same beginning of text picks up the entries of a recently released block (`adoptWindowMs`). Release happens **before** the new blocks of the same snapshot are processed.
5. **Replaces "You"/"Ви"** with the user's own name as soon as it is known (`setSelfName`). The `self` flag on an entry allows renaming turns that are already saved, too.
6. **Drops lines without a speaker** — Meet's system messages.

## Meeting lifecycle (`content/session.js`)

```
idle ──(call_end button appeared)──► session:start ──► waiting ──(region found)──► recording
  ▲                                     │ resume if same code,                  │
  │                                     │ updatedAt < 10 min and (not ended     │ CC turned off → off
  │                                     │ or ended < 5 min ago)                 │ no region > 10 s → notfound
  │                                                                              ▼
  └──────── ended ◄── session:end ◄── 3 consecutive polls without call_end ◄────┘
```

- **Joining a call.** The state counts as "in call" when there is a button with the `call_end` ligature. The `meet.google.com/new` page joins immediately, without the "Join now" screen.
- **After `session:start`.** The tracker starts and CC is turned on (`autoCaptions`). When the region is found for the first time, the code marks the overlay root, selects `uk-UA` once (`autoUkrainian`) and after 1.5 s checks whether Meet has reserved space for the captions. If it has, `remeasure()` runs: CC is turned off and on again, at most 2 times.
- **The meeting title** is taken from `document.title`, in the format "Meet - <title or code>". It is updated only when it changes in Meet, and sent to the SW only after a change. This way a rename in the archive is not overwritten.
- **Context loss.** After an extension update `chrome.runtime.id` disappears: the session shows the banner "Розширення оновлено — перезавантажте сторінку" (Extension updated — reload the page) and stops working.

### How the SW learns that a meeting has ended

There is no `tabs` permission, so the SW does not watch tab navigations. Instead:

| Event | What happens |
| --- | --- |
| "Leave call" button | The content script notices that `call_end` is gone (3 polls), calls `saveNow()` and sends `session:end`. |
| Tab closed | `chrome.tabs.onRemoved` → `router.tabGone(tabId)` (the `tabId → meetingId` mapping in `storage.session`). |
| Reload or navigation away from the page | `pagehide` → `tab:bye` → `alarms` after 1.5 min. Only rejoining the same call (`session:start`) cancels the alarm. |
| Another Meet page opened in the tab | `tab:hello` with a different meeting code or none (the home page after "Leave" → "Return to home screen") ends that tab's meeting at once. `tab:hello` with the same code (reload, the "Join now" screen) keeps the alarm. |
| Extension reloaded or updated mid-call | The old content script is "orphaned": `chrome.runtime` is unavailable and nothing can be saved. It clears the "recording" status (`onContextLost`). On `onInstalled` the SW injects fresh copies of the scripts into open Meet tabs (`scripting`). The new copy dispatches the DOM event `meet-transcriber:takeover`, the old one destroys its UI and timers (`destroy()`), and the new one continues the same record (`session:start` → resume). |
| Link between tab and meeting lost | `storage.session` is cleared on extension reload and browser restart. `router.sweep()` (an alarm once a minute and `onStartup`) ends open meetings linked to a tab that no longer exists, or unlinked and without updates for longer than `STALE_MS`. `endedAt` = time of the last update. |

When a meeting ends (`router.endMeeting`), a meeting without turns is deleted. Otherwise, if `autoDownload` is enabled, the `.md` is saved through `chrome.downloads` (data: URL, `conflictAction: 'uniquify'`).

## Message protocol (`background/router.js`)

| Type | Sender | Data | Response |
| --- | --- | --- | --- |
| `tab:hello` | content script on startup | `code` | settings; if the code does not match the tab's meeting, ends it |
| `tab:bye` | `pagehide` | — | schedules an end if the tab had a meeting |
| `session:start` | joining a call | `code`, `title`, `url` | `{meeting, resumed, settings}` |
| `session:update` | debounce / `pagehide` / leaving | `id`, `patch: {entries, speakers, language, title?}` | `true` / `false` |
| `session:end` | leaving a call | `id` | `true` if this very call ended the meeting |
| `settings:get` / `settings:set` | sidebar, archive | `patch` | settings |
| `meeting:get` / `meeting:rename` / `meeting:delete` | archive | `id`, `title` | |
| `meeting:export` | sidebar, archive | `id`, `format: md\|txt\|json` | `{id, filename}` |
| `archive:open` | sidebar | `id` | opens `archive.html#<id>` in a new tab |
| `dev:status` / `dev:ping` | `main.js` | — | only for the unpacked extension with the dev server |

The SW response always has the form `{ok, result}` or `{ok: false, error}`. `MT.send()` returns `result`, or `null` if the context is gone or an error occurred.

## Storage schema (`chrome.storage.local`)

```jsonc
{
  "settings": { "autoCaptions": true, "autoUkrainian": true, "showOverlay": false, "autoDownload": true },
  "meetings": [   // index, sorted by startedAt ↓
    { "id": "rfz-xkor-aeo_1790258140796", "code": "rfz-xkor-aeo", "title": "…", "startedAt": 0, "updatedAt": 0,
      "endedAt": null, "speakers": ["…"], "entryCount": 8, "language": "Ukrainian (Ukraine)" }
  ],
  "meeting:rfz-xkor-aeo_1790258140796": {
    "id": "…", "code": "…", "url": "https://meet.google.com/…", "title": "…", "language": "…",
    "startedAt": 0, "updatedAt": 0, "endedAt": null, "speakers": ["…"],
    "entries": [ { "id": "e-1", "block": 1, "speaker": "Denys Danyliuk", "self": true,
                   "text": "…", "startedAt": 0, "updatedAt": 0 } ]
  },
  "__devLoadedVersion": "…"    // dev only
}
```

`chrome.storage.session`: keys `tab:<tabId>` → `meetingId`.

## UI

- **The sidebar** (`content/sidebar/`) lives in the shadow root `#meet-transcriber-root`, and its styles are attached through `adoptedStyleSheets` (the CSS is loaded as a web-accessible resource).
  - The panel is split into slots (header, meta, search, banner, list, footer, menu, snackbar). Each slot re-renders only when its HTML has changed.
  - The list is reconciled per speaker turn (the key is the id of the turn's first entry), so the live segment updates without losing scroll position or focus.
  - The search field is rendered once.
  - **The panel and button are visible only during a call.** `Sidebar.inCall()` requires an active session and the "Leave call" button; a `tick()` every second checks this again. On the Meet home page, on the "Join now" screen and after leaving there is no panel, and the stage shrinking is removed.
  - **The panel opens only from the button.** On every page load and on every call it is closed: `open` is not persisted and is reset to `false` when the session ends.
  - **Slides in like Meet's native panels.** During a call the panel is always rendered, and the `.is-open` class toggles `transform: translateX(calc(100% + var(--mt-right)))` → `none` over 0.5 s `cubic-bezier(0.4, 0, 0.2, 1)`. These are the same values as in Meet's `ASIDE.R3Gmyc`. `visibility` is turned off only after the panel has slid out, while `inert` removes the closed panel from focus at once.
  - **Geometry** comes from `MT.dom.sidePanelBox()`, i.e. from Meet's *target* layout in inline styles rather than from current rectangles. So it is correct already at the start of Meet's animation:
    - top/bottom — the inline `top`/`bottom` of the native panels' slot plus its padding; they change together with the reactions panel (136 ↔ 88 px);
    - right — the right inline inset of `<main>`: 16 px, or 392 px when a native panel is open, so ours sits to its left.

    A `MutationObserver` on the `style` attribute of the stage and the slot calls `layout()` immediately, and the `top/right/bottom` transitions in CSS have the same duration. This way our panel moves in sync with the native one.
- **The pill button** sits to the left of Meet's right button group (`#1e1f20`, 56 px). It is not inserted into the group, because Meet then hides its chat and drops the foreign node. If there is not enough room, the pill moves above the group.
- **Stage shrinking.** While the sidebar is open, Meet's `<main>` gets `data-mt-stage`, and `<html>` gets the `mt-panel-open` class and the `--mt-stage-scale` / `--mt-stage-ty` variables. `page.css` applies a `transform` with the same 0.5 s transition as the panel. The rule has `!important` because Meet's rule for `<main>` is more specific. The scale is computed from `MT.dom.stageSize()`: the container width minus Meet's inline insets, i.e. the target size, which our transform does not affect. Narrowing `<main>` itself does not work: Meet lays out the tiles from its own model and does not recompute them, even with `right: … !important` and a `resize` event (verified 24.09.2026).
- **The archive** is a regular extension page in Material 3 style, with light and dark themes via `prefers-color-scheme`. The page reads `chrome.storage.local` directly and writes through the SW.
- **Templates** (`templates.js`) are pure functions of a view model. Both the sidebar and `design/mockup.html` use them, so the mockup always matches the code.

## Dev infrastructure

- `dev/server.mjs` — a static server for the repository plus `/__version` (sha1 of the paths, sizes and mtimes of the files in `extension/`).
- `background/dev-reload.js` is enabled only for `installType === 'development'` when the server responds. The content script pings every 2 s (this also keeps the SW alive), the SW compares the version and calls `chrome.runtime.reload()`. The version the reload happened with is saved in `storage.local`: otherwise edits that arrived during the reload would be lost.
- `dev/chrome-shim.js` — `chrome.storage.local` on top of `localStorage` and `runtime.sendMessage` → `window.__harnessBackground`, to which `harness.html` and `dev/archive.html` attach the real `createRouter()`.
- `dev/meet-sim.js` — Meet's DOM 1:1 from the recon and a script of Ukrainian speaker turns. The script contains tail revisions, a pause, a system line, a long monologue and `You`. Dev panel buttons: play/pause/speed/re-render/leave/reset.
