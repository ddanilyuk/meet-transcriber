# Google Meet DOM notes (live recon, 2026-09-24)

Recorded against a real call (`meet.google.com/new`, English UI, Workspace account).
Class names are obfuscated and change between Meet releases; keep every selector in
`extension/content/selectors.js` with fallbacks, and prefer the language-independent hooks.

## In-call detection
- Control icons are `<i class="google-symbols">` ligatures; `textContent` is stable across UI languages:
  `mic`, `videocam`, `closed_caption_off` / `closed_caption`, `back_hand`, `more_vert`, `call_end`, `chat`, `apps`, `lock_person`.
- In call ⇔ a `button` containing the `call_end` icon exists (`jsname="CQylAd"`, aria "Leave call").
- `meet.google.com/new` redirects to `/<code>` and joins immediately (no pre-join screen).
- After leaving, the URL stays `/<code>`; the page shows "You left the meeting" + Rejoin; `call_end` is gone.
- Meeting code: `location.pathname` → `/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})/`. Title: `document.title` is
  `"Meet - <code>"` for ad-hoc calls; `[jsname="NeC6gb"]` / `.u6vdEc` hold the title shown top-left.

## Captions button
- Off: icon `closed_caption_off`, aria "Turn on captions"; on: icon `closed_caption`, bg `#a8c7fa`, icon `#062e6f`,
  radius 12px, 56×48. `jsname="RrG0hf"` (not `r8qRAd` as in older builds). `aria-pressed` is not set.
- Programmatic `button.click()` turns captions on.

## Caption language
- `[role="combobox"][aria-label="Meeting language"]` (`jsname="oYxtQd"`), text `"language\nEnglish"`.
  It lives in the captions settings bar (`.a4cQT > .NmXUuc > .qUPVAc …`), not inside the region.
- `combo.click()` opens a listbox of 91 `[role="option"]` with `data-value` BCP-47 codes.
  **Ukrainian = `data-value="uk-UA"`**, label "Ukrainian (Ukraine) BETA". `option.click()` applies it immediately.

## Captions region
```
div.fJsklc (position:absolute; caption overlay root, 216px high at the bottom of the stage)
  … div.DtJ7e > div.iOzk7[jsname=dsyhDe]
      div.vNKgIf.UDinHf[role=region][aria-label=Captions][tabindex=0][jscontroller=KPn5nb]
        div.nMcdL.bj4p3b                 ← one block per speaker turn
          div.adE6rb
            img.Z6byG.r6DyN              ← avatar
            div.KcIKyf.jxFHg > span.NWpY1d   "You" / participant name
          div.ygicle.VbkSUe              ← text, split into many text nodes (phrase chunks + " ")
        div > div.GvZY2                  ← always present, not a caption
        div.IMKgW                        ← "Jump to bottom" button, not a caption
```
- Own speech is labelled `You` (English UI). The own display name is visible in the self tile (`span.notranslate`).
- While a speaker keeps talking, Meet keeps appending to **one block**, even across long pauses
  (observed: one block grew to 1264 chars / 72 text nodes over ~6 minutes). No head truncation observed,
  but slight shrinking on revision happens (1264 → 1260). A new block starts when the speaker changes.
- Streaming cadence: ~330 ms per update, word by word, `childList` + `characterData` mutations.
- Blocks from before the language switch stay in the DOM (history).

## Background tab behaviour (important)
- When the Meet tab is hidden, Meet keeps recognising speech but **does not update the captions DOM** until the tab
  becomes visible again (0 mutations while hidden, then one batch of 48). Rendering is driven by `requestAnimationFrame`,
  which Chrome pauses in hidden tabs.
- Fix verified live: a MAIN-world patch that routes `requestAnimationFrame` to `setTimeout(16)` while
  `document.webkitHidden` is true. Captions then update ~1×/s in the hidden tab (timer throttling). Spoofing
  `visibilityState` is **not** needed. The patch must be installed at `document_start` (before Meet captures rAF).

## Hiding the overlay (revised after E2E)
- The stage is `<main>` with an inline `inset: 64px 16px <bottom>px`. With captions off `bottom` is 136;
  with captions on it is 352 — Meet adds the overlay height (216) **measured when captions are switched on**.
  Moving, hiding (`visibility`, `opacity`) or even collapsing the overlay later does not change it; neither do
  synthetic `resize` events. Tiles are positioned by Meet's JS (`.dkjMxf` inline left/top/width/height), so
  overriding the stage's inset does not re-layout them either.
- What works: the overlay root must already be collapsed (`height: 0; overflow: hidden`) at the moment captions
  turn on. A stylesheet rule `.fJsklc:has([jsname="dsyhDe"])` matches as soon as Meet inserts the captions
  window, before it measures → `bottom` stays 136 and the video uses the full height. If space is reserved anyway,
  toggling captions off/on makes Meet measure the collapsed overlay again.
- `.fJsklc` is a generic class of several overlay layers (top bar, bottom bar, left/right panel slots);
  only the one containing `[jsname="dsyhDe"]` is the captions overlay.
- Mutations keep flowing while the overlay is collapsed. **`innerText` is empty for hidden content — always read
  `textContent`.**

## Control bar is responsive
- Inserting an extra 48px button into the right-hand group (`.tMdQNe`) makes Meet hide one of its own buttons
  (the chat button got width 0) and later rebuild the group, dropping the foreign node. Our button is therefore a
  separate pill positioned next to the group instead of a child of it.
- The native side panels live in a right-hand `.fJsklc` slot (`ASIDE.R3Gmyc`, parked at `x = viewport` when
  closed). Their open state comes from Meet's layout model, so a foreign panel cannot make Meet shrink the stage;
  the extension scales the stage with a CSS transform while its panel is open.

## Side panel motion and layout targets (2026-09-24)
- Closed `ASIDE.R3Gmyc` has class `qdulke` and `transform: translateX(376px)` (width 360 + 16 gap); open, the class is
  gone and the transform is `none`. Transition: `transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), height 0.5s …`.
- Its parent slot (`.fJsklc`, absolute) carries Meet's target geometry inline: `right: 0; top: 48px; bottom: 128px`
  with padding `16px 16px 8px 0`, i.e. the panel box is top 64, right 16, bottom 136. The slot's `bottom` transitions
  0.5s and becomes `80px` (panel bottom 88) when the reactions bar is hidden.
- `<main>` (the stage) has inline `inset: 64px 16px 136px`; with a native panel open Meet writes
  `64px 392px 136px 16px` immediately and animates it with `top/left/right/bottom 0.5s cubic-bezier(0.4, 0, 0.2, 1)`.
  Inline styles are therefore the *target* layout; rects lag behind during the animation.
- Forcing `main { right: 392px !important }` (and dispatching `resize`) shrinks `<main>` but the tiles keep their size
  and overflow it: Meet lays tiles out from its model, not from the stage's box. Scaling stays the only option.
- In a hidden tab CSS transitions do not advance (computed values stay at the start), so geometry experiments need a
  visible tab or `transition: none` on the elements being measured.

## Side panel look (Meet 2026, dark)
- Native panel (`.R3Gmyc`, "In-call messages"): x = viewport − 16 − 360, top 64, width 360, height to 8px above
  the control bar; bg `#202124`, radius 20px, no shadow. Close button 40×40.
- Heading: "Google Sans" 18px/24px, weight 400, `#e3e3e3`. Secondary text: 12px/16px `#c4c7c5`.
- Stage background `#131314`. Control bar: round 48×48 buttons, bg `#333537`, icon `#e3e3e3`, 24px icons;
  Leave call 72×48 `#db372d`.
- Right button group (`.tMdQNe.Dg8mNb`): bg `#1e1f20`, radius 32px, padding 0 4px, height 56; children are
  wrappers `.cKYX7b > div > div.r6xAKc > [span > button, div.IxCbn]`. Buttons are transparent 48×48, icon `#c4c7c5`.
  Active panel indicator = `div.IxCbn` (bg `#8ab4f8`) under the button.

## Captions popup and `/meet/<code>` URLs (live recon, 2026-11-04)
Seen in a calendar meeting with Gemini note-taking; an ad-hoc `meet.google.com/new` call on the same account still
had the old one-click CC button at the same time, so the rollout is per meeting and both UIs must keep working.
- **URLs:** calls are now served at `/meet/<code>` (`/new` redirects there). The old `/<code>` path regex missed it, so
  calls with a calendar title (`document.title` = `"Meet - <title>"`) had no meeting code at all, and every such
  call resumed the same `code: null` record. `meetingCode()` accepts both paths, and `store.start()` never resumes a
  meeting without a code.
- **Control bar:** the CC button is replaced by `button[aria-label="Captions and translation"]` with icon
  `translate_cc`, `aria-haspopup="dialog"`, no `jsname`. Its `aria-pressed` is `"true"` while captions are on (it
  stays so after the popup closes).
- **Popup:** a click opens `[role="dialog"][aria-label="Captions and translation"]` (`jsname="TUXR0d"`) in the slot
  above the controls — the same slot and `jsname` as the reactions bar, which it temporarily replaces. Clicking the
  menu button again closes it and the reactions bar comes back. The popup's content exists only while it is open:
  ```
  [role=dialog][jsname=TUXR0d]
    [jsname=wOezY] … button[jsname=RrG0hf]   "Live captions": icon closed_caption_off (off) / check (on),
                                              aria "Turn on captions" / "Turn off live captions"
    [jsname=zRRQAf] … button[jsname=RrG0hf]  "Translate speech", icon translate_spark
    button[aria-label="Open speech translation settings"]
  ```
  Two buttons share `jsname="RrG0hf"`, so the toggle is looked up inside `[jsname="wOezY"]` first.
  Tooltip: captions also toggle with the `c` / `shift + c` shortcut.
- **Captions bar:** with captions on, the settings bar above the region (`.a4cQT > .NmXUuc`) now has a
  "Caption type" combobox (`jsname="oYxtQd"`, icon `closed_caption`, text "Live captions") next to the language
  combobox (icon `language`). Locate the language one by its icon, never by `jsname`.
- **Region and blocks are unchanged:** `[jsname=dsyhDe] > div[role=region][aria-label=Captions]` with
  `.nMcdL > .adE6rb > .KcIKyf > span.NWpY1d` + `.ygicle`; the region exists only while captions are on.
- The extension turns captions on in the new UI by opening the popup, clicking "Live captions" when it shows
  `closed_caption_off`, waiting for the region and closing the popup with the menu button (`captions.enableCaptions()`);
  `remeasure()` goes through the popup the same way.
