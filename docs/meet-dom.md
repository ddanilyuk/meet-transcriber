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

## Side panel look (Meet 2026, dark)
- Native panel (`.R3Gmyc`, "In-call messages"): x = viewport − 16 − 360, top 64, width 360, height to 8px above
  the control bar; bg `#202124`, radius 20px, no shadow. Close button 40×40.
- Heading: "Google Sans" 18px/24px, weight 400, `#e3e3e3`. Secondary text: 12px/16px `#c4c7c5`.
- Stage background `#131314`. Control bar: round 48×48 buttons, bg `#333537`, icon `#e3e3e3`, 24px icons;
  Leave call 72×48 `#db372d`.
- Right button group (`.tMdQNe.Dg8mNb`): bg `#1e1f20`, radius 32px, padding 0 4px, height 56; children are
  wrappers `.cKYX7b > div > div.r6xAKc > [span > button, div.IxCbn]`. Buttons are transparent 48×48, icon `#c4c7c5`.
  Active panel indicator = `div.IxCbn` (bg `#8ab4f8`) under the button.
