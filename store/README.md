# Chrome Web Store submission

Published listing: <https://chromewebstore.google.com/detail/meet-transcriber/nbplddgnafihdhidggcphgcleiamhobk> (item ID `nbplddgnafihdhidggcphgcleiamhobk`, first published with 1.1.2 in 10.2026).

Everything the Chrome Web Store developer dashboard asks for, ready to paste. The listing is in Ukrainian because the
extension UI is Ukrainian and it only transcribes Ukrainian captions.

Build the package first:

```bash
npm run store
```

It writes `dist/meet-transcriber-<version>.zip`: the `extension/` folder with the dev-only
`http://localhost:8765/*` host permission removed and `background/drive-config.js` filled with the Google OAuth client
of the Drive copy. The build needs the Drive client secret and fails without it (see [Secrets](#secrets)). Bump the
version in `extension/manifest.json` and `package.json` before every new upload; the store rejects a version it has
already seen.

The **Store package** GitHub Actions workflow (`.github/workflows/store-package.yml`) builds the same zip from the
repository secret on every `v*` tag (or by hand from the Actions tab once the workflow is on `main`) and keeps it as a
workflow artifact.

## Secrets

No secret is committed. GitHub push protection refuses the Google OAuth client secret, and
`extension/background/drive-config.js` is an empty placeholder in git (the Drive copy is hidden in a build without it).

| Secret | Needed for | Where it lives | Original |
| --- | --- | --- | --- |
| Drive OAuth client secret | `npm run store`, `npm run config` / `npm run dev` with the Drive copy | macOS login Keychain, service `meet-transcriber-drive`, account `client-secret`; GitHub Actions secret `DRIVE_CLIENT_SECRET` (write-only, cannot be read back) | Google Cloud project `meet-transcriber-514415` (the developer's personal Google account) → **APIs & Services → Credentials** → client "Meet Transcriber extension" |
| Drive OAuth client ID | the same | not a secret: `DRIVE_CLIENT_ID` in `scripts/drive-config.mjs` | the same client |
| Chrome Web Store API credentials | `npm run store:publish`, `npm run store:status` | macOS login Keychain, service `meet-transcriber-cws`, accounts `client-id`, `client-secret`, `refresh-token`, `publisher-id` (written by `npm run store:auth`) | see [One-time setup](#one-time-setup) |

Environment variables override the Keychain: `DRIVE_CLIENT_SECRET` and `CWS_*`.

Check what this Mac has (prints the Drive secret; `-w` can be dropped to print only the item's attributes):

```bash
security find-generic-password -s meet-transcriber-drive -a client-secret -w
```

The items can also be found in **Keychain Access** (search `meet-transcriber`). The login Keychain is not synced to
iCloud: keep a copy in the **Passwords** app if you want one on other Macs.

### Local build on a new Mac

1. Get the Drive client secret: from the Keychain or Passwords app of another Mac, or from the Google Cloud console
   (the console may show only the last characters of an existing secret; then **Add secret** on the same client,
   use the new one and update the GitHub secret too, see below).
2. Save it to the Keychain (the command asks for the value):

   ```bash
   security add-generic-password -U -s meet-transcriber-drive -a client-secret -w
   ```

3. Build the store package. It fails with "No Drive client secret" if step 2 is missing:

   ```bash
   npm run store
   ```

4. For the unpacked extension with the Drive copy, fill in the local `drive-config.js` (also done by `npm run dev`).
   The script marks the file skip-worktree, so git does not show or commit the filled values:

   ```bash
   npm run config
   ```

5. For `npm run store:publish`, run the [one-time setup](#one-time-setup) on that Mac too.

### Rotating the Drive secret

Add a new secret on the client in the Google Cloud console, then update both copies and rebuild:

```bash
security add-generic-password -U -s meet-transcriber-drive -a client-secret -w
```

```bash
gh secret set DRIVE_CLIENT_SECRET --repo ddanilyuk/meet-transcriber
```

Disable the old secret in the console only after a store version with the new one is live: installed copies use the
secret baked into their package.

Dashboard: <https://chrome.google.com/webstore/devconsole>. Chrome does not let extensions or embedded browsers
script the Chrome Web Store, so listing texts, images and privacy answers have to be filled in by hand. The package
itself is uploaded from the command line (below).

## Publishing an update

After the version bump, tag and GitHub release:

```bash
npm run store:publish
```

`scripts/publish-store.mjs` checks the store first (refuses when the version is not newer than the one in the store
or a submission is still in review, warns about an untagged or dirty checkout), asks for confirmation, builds the
zip with `npm run store`, uploads it through the Chrome Web Store API V2 and submits it for review. The new version
goes live by itself once the review passes. `npm run store:publish -- --upload-only` uploads without submitting;
`npm run store:status` shows the published and submitted versions. The listing texts and privacy answers carry over;
when permissions or features change, update them in the dashboard as well.

Manual fallback: dashboard → the item → **Package** → **Upload new package** → select the zip → **Submit for review**.

### One-time setup

The script signs in with an OAuth client of your own Google Cloud project and keeps the credentials in the macOS
Keychain (service `meet-transcriber-cws`). Environment variables `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`,
`CWS_REFRESH_TOKEN` and `CWS_PUBLISHER_ID` override the Keychain.

1. <https://console.cloud.google.com/projectcreate>: create a project (any name, e.g. `meet-transcriber-publish`).
   Use the Google account that owns the Chrome Web Store item.
2. <https://console.cloud.google.com/apis/library/chromewebstore.googleapis.com>: **Enable** the Chrome Web Store API.
3. <https://console.cloud.google.com/auth/overview>: **Get started**, enter an app name and email, then the audience:
   - **Internal** if the account is a Google Workspace account and the project belongs to that organization;
   - otherwise **External**, and afterwards **Audience → Publish app** (to "In production"). In "Testing" Google
     expires refresh tokens after 7 days. The app stays unverified, which is fine for your own account: the sign-in
     page shows a warning, continue through **Advanced**.
4. **Clients → Create client → Desktop app**. Copy the client ID and the client secret.
5. Developer Dashboard → **Publisher → Settings**: copy the publisher ID.
6. Run:

   ```bash
   npm run store:auth
   ```

   It asks for the client ID, secret and publisher ID, opens the Google sign-in page in the browser (sign in with
   the account that owns the item), checks the credentials with a real status request and saves them to the
   Keychain. Run it again whenever the script reports that the refresh token was rejected.

The Chrome Web Store requires 2-step verification on the publisher account for API publishing.

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
• Ховає рідний оверлей субтитрів, щоб він не забирав місця у відео, і у вкладці дзвінка, і у вікні «картинка в картинці». Його можна повернути перемикачем «Субтитри на екрані».
• Працює й тоді, коли вкладка Meet у фоні.
• Після виходу з дзвінка автоматично зберігає транскрипт у файл .md у папці «Завантаження/Meet Transcripts».
• Архів мітингів із групуванням за днями, повнотекстовим пошуком, перейменуванням і експортом у Markdown, TXT чи JSON.
• За бажанням зберігає копію кожного транскрипту на ваш Google Диск, у папку «Meet Transcripts»: підключіть Диск у налаштуваннях архіву.

Приватність:
Усе зберігається лише на вашому компʼютері. Розширення не має серверів та аналітики й працює тільки на meet.google.com. Дані залишають компʼютер лише тоді, коли ви самі підключили Google Диск: транскрипт надсилається напряму з браузера на ваш власний Диск. Розширення бачить на Диску тільки файли, які створило саме.

Як користуватися:
Зайдіть у дзвінок Google Meet і натисніть кнопку «Транскрипт» праворуч унизу. Запис іде й тоді, коли панель закрита. Архів відкривається іконкою розширення.

Обмеження:
Текст береться з субтитрів Google Meet, тому якість залежить від розпізнавання Google. Українські субтитри Meet позначені як BETA і не мають пунктуації. Попереджайте учасників, що ведете транскрипт.

Код і документація: https://github.com/ddanilyuk/meet-transcriber

—
Saves Google Meet's Ukrainian live captions with speaker names into a local, searchable transcript. Everything stays on your computer, with an optional copy to your own Google Drive. The extension UI is in Ukrainian.
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
Saves the live captions of the Google Meet call the user is in, together with speaker names, as a local transcript that the user can read in a sidebar, search, export and optionally copy to their own Google Drive.
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
| `identity` (optional) | Requested only when the user clicks "Підключити" (Connect) under "Google Диск" in the archive settings. Used for `chrome.identity.launchWebAuthFlow` so the user can sign in to Google and let the extension save transcripts to their own Google Drive (scope `drive.file`: only files the extension creates). |
| Optional host permissions `https://www.googleapis.com/*`, `https://oauth2.googleapis.com/*` | Requested together with `identity`. The service worker uploads the transcript file to the user's Google Drive and refreshes the Google access token. No other requests are made to these hosts. |

**Remote code:** No, I am not using remote code.

**Data usage**, what the extension handles (it is stored locally, and sent only to the user's own Google Drive when
they connect it, but the store requires disclosing it):

| Checkbox | Check? | Why |
| --- | --- | --- |
| Personally identifiable information | yes | Names of meeting participants as shown by Meet. |
| Health information | no | |
| Financial and payment information | no | |
| Authentication information | yes | Only with Google Drive connected: the Google OAuth tokens for that connection, kept in chrome.storage.local. |
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
No account in the extension and no login. To test: open https://meet.google.com/new with any Google account. The extension turns on Meet captions and switches the caption language to Ukrainian (Ukraine). Click the "Транскрипт" button at the bottom right to open the panel. Speak Ukrainian (or play Ukrainian speech) and lines appear in the panel with the speaker name. Click "Leave call": a Markdown file is saved to Downloads/Meet Transcripts/. Click the extension icon to open the archive. All data is stored locally in chrome.storage.local; nothing is sent over the network by default. Optional: in the archive click the gear icon, then "Підключити" under "Google Диск", allow the permission and sign in with any Google account; the next finished meeting is also uploaded as a .md file to a "Meet Transcripts" folder in that account's Google Drive (scope drive.file).
```

## Account page

Publisher name and a verified contact email are required before the first submission.
