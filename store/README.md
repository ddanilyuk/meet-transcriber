# Chrome Web Store submission

Everything the Chrome Web Store developer dashboard asks for, ready to paste. The listing is in Ukrainian because the
extension UI is Ukrainian and it only transcribes Ukrainian captions.

Build the package first:

```bash
npm run store
```

It writes `dist/meet-transcriber-<version>.zip`: the `extension/` folder with the dev-only
`http://localhost:8765/*` host permission removed. Bump the version in `extension/manifest.json` and `package.json`
before every new upload; the store rejects a version it has already seen.

Dashboard: <https://chrome.google.com/webstore/devconsole>. Chrome does not let extensions or embedded browsers
script the Chrome Web Store, so the dashboard has to be filled in by hand.

## Files

| Dashboard field | File |
| --- | --- |
| Package | `dist/meet-transcriber-<version>.zip` |
| Store icon (128×128) | `extension/icons/icon-128.png` |
| Screenshot 1 (1280×800) | `store/screenshot-1-panel.png` |
| Screenshot 2 (1280×800) | `store/screenshot-2-archive.png` |
| Small promo tile (440×280) | `store/promo-small-440x280.png` (source: `store/promo-small.html`) |

The screenshots come from the dev harness (`npm run dev`, `/dev/harness.html` and `/dev/archive.html`) at a
1280×800 viewport with the panel opened; the self speaker was renamed to a fictional name.

## Store listing tab

**Description** (the summary under the name comes from the manifest `description`):

```text
Meet Transcriber зберігає субтитри Google Meet українською разом з іменами мовців і показує живий транскрипт у панелі, оформленій як рідні панелі Meet.

Що вміє:
• Під час входу в дзвінок сам вмикає субтитри Meet і ставить мову розпізнавання «Ukrainian (Ukraine)».
• Показує живий транскрипт, згрупований за мовцями, з часом кожної репліки та пошуком.
• Ховає рідний оверлей субтитрів, щоб він не забирав місця у відео. Його можна повернути перемикачем «Субтитри на екрані».
• Працює й тоді, коли вкладка Meet у фоні.
• Після виходу з дзвінка автоматично зберігає транскрипт у файл .md у папці «Завантаження/Meet Transcripts».
• Архів мітингів із групуванням за днями, повнотекстовим пошуком, перейменуванням і експортом у Markdown, TXT чи JSON.

Приватність:
Усе зберігається лише на вашому компʼютері. Розширення не має серверів, аналітики й не надсилає жодних даних. Воно працює тільки на meet.google.com.

Як користуватися:
Зайдіть у дзвінок Google Meet і натисніть кнопку «Транскрипт» праворуч унизу. Запис іде й тоді, коли панель закрита. Архів відкривається іконкою розширення.

Обмеження:
Текст береться з субтитрів Google Meet, тому якість залежить від розпізнавання Google. Українські субтитри Meet позначені як BETA і не мають пунктуації. Попереджайте учасників, що ведете транскрипт.

Код і документація: https://github.com/ddanilyuk/meet-transcriber

—
Saves Google Meet's Ukrainian live captions with speaker names into a local, searchable transcript. Everything stays on your computer. The extension UI is in Ukrainian.
```

| Field | Value |
| --- | --- |
| Category | Communication |
| Language | Ukrainian |
| Official URL | none |
| Homepage URL | `https://github.com/ddanilyuk/meet-transcriber` |
| Support URL | `https://github.com/ddanilyuk/meet-transcriber/issues` |
| Mature content | No |

## Privacy tab

**Single purpose description:**

```text
Saves the live captions of the Google Meet call the user is in, together with speaker names, as a local transcript that the user can read in a sidebar, search and export.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Stores transcripts, the meeting list and the user's settings locally in chrome.storage.local, and which tab belongs to which meeting in chrome.storage.session. Nothing is synced or sent anywhere. |
| `unlimitedStorage` | Transcripts of long meetings accumulate in the local archive and can exceed the default 10 MB storage quota; without it older or longer transcripts could fail to save. |
| `downloads` | Saves the transcript as a Markdown file to the Downloads folder when a meeting ends, and exports a meeting as .md, .txt or .json when the user clicks Download. |
| `alarms` | Ends and saves a meeting shortly after its Meet tab is closed, and runs a check every minute that saves meetings whose tab disappeared (for example after a browser restart), so no transcript is left unsaved. |
| `scripting` | After the extension is updated, re-injects its content scripts into Google Meet tabs that are already open, so a call in progress keeps being transcribed without reloading the page. Only used on meet.google.com. |
| Host permission `https://meet.google.com/*` | The extension reads the caption text and speaker names that Google Meet renders on the page, and shows its transcript panel inside the Meet page. It runs on no other site. |

**Remote code:** No, I am not using remote code.

**Data usage**, what the extension handles (it is stored locally only, but the store requires disclosing it):

| Checkbox | Check? | Why |
| --- | --- | --- |
| Personally identifiable information | yes | Names of meeting participants as shown by Meet. |
| Health information | no | |
| Financial and payment information | no | |
| Authentication information | no | |
| Personal communications | yes | What participants say in the call, taken from the captions. |
| Location | no | |
| Web history | no | |
| User activity | no | |
| Website content | yes | Caption text read from the Meet page. |

The three certifications below the checkboxes (no selling or transferring data to third parties, no use unrelated to
the single purpose, no use for creditworthiness or lending) are all true for this extension.

**Privacy policy URL:** `https://github.com/ddanilyuk/meet-transcriber/blob/main/docs/privacy.md`

## Distribution tab

| Field | Value |
| --- | --- |
| Payments | Free of charge |
| Visibility | Unlisted (anyone with the link can install it; it does not appear in search) |
| Distribution | All regions |

## Test instructions tab (for the reviewer)

```text
No account in the extension and no login. To test: open https://meet.google.com/new with any Google account. The extension turns on Meet captions and switches the caption language to Ukrainian (Ukraine). Click the "Транскрипт" button at the bottom right to open the panel. Speak Ukrainian (or play Ukrainian speech) and lines appear in the panel with the speaker name. Click "Leave call": a Markdown file is saved to Downloads/Meet Transcripts/. Click the extension icon to open the archive. All data is stored locally in chrome.storage.local; nothing is sent over the network.
```

## Account page

Publisher name and a verified contact email are required before the first submission.
