# Privacy policy

Last updated: 2026-10-09

Meet Transcriber is a Chrome extension that saves the live captions of Google Meet calls as local transcripts.
This policy explains what data it handles. In short: everything stays on your computer.

## What the extension handles

While you are in a Google Meet call, the extension reads from the Meet page:

- **Caption text**: the speech that Google Meet recognized and shows as captions.
- **Speaker names**: the participant names Meet shows next to captions, including your own.
- **Meeting details**: the meeting code (for example `abc-defg-hij`), the meeting title from the page, the caption
  language and the start and end times.

It also keeps your settings (four on/off switches) and, during a call, which browser tab belongs to which meeting.

The extension does not read your camera, microphone, chat messages, email, contacts, browsing history or any page
other than `meet.google.com`.

## Where the data is stored

- Transcripts, the meeting list and settings are stored in `chrome.storage.local`, inside your Chrome profile on your
  computer.
- Tab bookkeeping is stored in `chrome.storage.session` and is cleared when the browser restarts.
- When a meeting ends, and whenever you export one, the extension saves a file to your Downloads folder
  (`Downloads/Meet Transcripts/`).

## What is sent elsewhere

Nothing. The extension has no servers, no analytics, no telemetry and no third-party code. It makes no network
requests with your data. Transcripts leave your computer only if you copy, export or share them yourself.

The developer has no access to your transcripts or settings.

## How the data is used

Only to provide the extension's features: showing the live transcript in the sidebar, the searchable archive, and
export to Markdown, TXT or JSON. The data is never sold, never used for advertising, and never used to determine
creditworthiness or for any purpose unrelated to these features.

## Retention and deletion

Transcripts stay until you delete them. You can delete a meeting in the archive. Removing the extension in
`chrome://extensions` deletes all of its stored data. Files already saved to your Downloads folder are ordinary files
and stay until you delete them.

## Other people in the call

Transcripts contain what other participants said and their names. Let participants know when you keep a
transcript, and follow the rules of your organization and the law that applies to you.

## Changes

Changes to this policy are published in this file in the
[meet-transcriber repository](https://github.com/ddanilyuk/meet-transcriber/blob/main/docs/privacy.md), with the date
above updated.

## Contact

Questions: open an issue at <https://github.com/ddanilyuk/meet-transcriber/issues>.
