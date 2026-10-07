# Design

The goal is a sidebar that looks like a native part of Google Meet 2026. All sizes and colors were taken from the live page via `getComputedStyle` (see [meet-dom.md](meet-dom.md#side-panel-look-meet-2026-dark)). Mockup of every state: `design/mockup.html`. It uses the same `templates.js` and `sidebar.css` as the extension.

## Decisions

| Decision | Why |
| --- | --- |
| Panel inside the Meet page, not `chrome.sidePanel` | The user's choice: the panel should "live organically" inside Meet. |
| **Dark** panel `#202124` | The wireframe was light at first, but in Meet 2026 the native side panels ("In-call messages") are dark. |
| Geometry 360 px, radius 20 px, `top: 64`, right inset 16 | Measurements of the native panel. |
| The video shrinks while the panel is open | Meet's native panels narrow the stage. So that our panel does not cover the video, the stage is scaled (`transform`). |
| The panel slides in from the right, like Meet's chat | The same motion as "In-call messages": `translateX(width + 16)` → 0 over 0.5 s `cubic-bezier(0.4, 0, 0.2, 1)`, with the stage narrowing in sync. The rectangle matches the native panel, and next to an open chat ours sits to its left. |
| The panel starts closed | It opens only from the button, like the native panels. The state is not persisted across page loads. |
| The button is a separate "pill" `#1e1f20` next to the right group | A button in the style of Meet's group. Inserting it into the group made Meet hide the chat button. |
| A red dot on the button and a "● Запис" (Recording) chip | It must be visible that recording is on, even when the panel is closed. |
| A blue indicator under the button while the panel is open | This is how Meet marks the active panel (`div.IxCbn`, `#8ab4f8`). |
| A one-letter avatar on a color derived from a hash of the name | This is how Meet draws fallback avatars. |
| Icons are inline SVG in the Material Symbols style | We do not depend on Meet's icon font and make no external requests. |
| Fonts `"Google Sans Text", "Google Sans", Roboto` | The Meet page has already loaded them, and the shadow DOM can see them. |
| Archive in Material 3 style, with light and dark themes | It is a separate page, so it follows `prefers-color-scheme`. There are no external fonts. |

## Sidebar tokens (`sidebar.css`, `:host`)

| Token | Value | Source |
| --- | --- | --- |
| `--mt-surface` | `#202124` | native panel background |
| `--mt-surface-high` | `#282a2c` | Meet's chat input field |
| `--mt-surface-highest` | `#333537` | control bar buttons |
| `--mt-on-surface` | `#e3e3e3` | panel title |
| `--mt-on-surface-variant` | `#c4c7c5` | secondary text, icons |
| `--mt-primary` / `--mt-on-primary` | `#a8c7fa` / `#062e6f` | active CC button |
| `--mt-indicator` | `#8ab4f8` | active panel indicator |
| `--mt-rec` | `#ee675c` | recording dot |
| title font | Google Sans 18/24, 400 | "In-call messages" title |
| turn text | 14/20 | |

## Panel states

| State | Chip | List content |
| --- | --- | --- |
| `waiting` | "Очікування субтитрів" (Waiting for captions) | "Поки що тиша" (Silence so far) |
| `recording` | "● Запис" | turns, the live segment highlighted and with a caret |
| `off` | "Субтитри вимкнено" (Captions off) | a screen with the "Увімкнути субтитри" (Turn on captions) button |
| `notfound` | "Субтитри вимкнено" | "Не вдається знайти субтитри" (Can't find captions) (the DOM has probably changed) |
| `ended` | "Завершено" (Ended) | the final transcript |

Banners: "Мова субтитрів не українська" (Caption language is not Ukrainian) with the buttons "Обрати українську" (Choose Ukrainian) and "Не зараз" (Not now); "Розширення оновлено — перезавантажте сторінку" (Extension updated — reload the page).

In the footer: the "Субтитри на екрані" (Captions on screen) toggle, Markdown copy, a download menu (md / txt / json), archive, settings (auto-CC, auto-Ukrainian, auto-save file). Search highlights matches and shows their count. If the user has scrolled up while new turns arrive, a "Нові репліки ↓" (New turns ↓) pill appears.
