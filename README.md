# Maillo

A self-hosted web interface for Gmail. Your mail stays in your Google account; Maillo is a set of static files you upload to your own web server. It talks to Gmail directly from your browser through Google's official API.

- No database and no third-party service in between; the only server-side files are an optional updater (`update.php`) and an optional Gemini relay (`ai.php`), both for PHP hosts
- Sign in with Google; access tokens stay in the browser tab and are never stored on a server
- Works on any static host: shared hosting (Apache, cPanel), Nginx, Cloudflare Pages, Netlify, and others
- English and French interface

## Features

**Mail**
- Inbox with categories (Primary, Promotions, Social, Updates, Forums)
- Starred, Snoozed, Important, Sent, Scheduled, Drafts, All mail, Spam, Trash
- Labels, including nested labels and label colours
- Full Gmail search syntax (`from:`, `has:attachment`, `newer_than:7d`, and so on) with quick filter chips
- Threaded conversations with collapsed earlier messages and hidden quoted text
- Bulk actions from a ribbon at the bottom of the list: archive, delete, spam, read/unread, star, important, move, label (extra actions fold into "…")
- Move to and Label as open with a search field ready to type in; Enter picks the first match
- Resizable columns (folder list, message list, side panel); widths, the open side panel and a hidden folder list are remembered in this browser. Double-click a divider to reset it
- Hover actions on each row: archive, delete, mark read/unread, set aside, Action required
- Drag and drop: drag conversations (or the whole selection) onto a label, Inbox, Starred, Important, All mail, Spam, Trash or a pile; drag a label from the sidebar onto a conversation to apply it
- Undo for archive, delete, spam, move and label changes
- Reminders for important messages you have not answered ("Received 3 days ago. Reply?")
- **Set aside**: pin conversations out of the inbox into a small stack of cards at the bottom of the screen. Click the stack to fan the cards out and pick one. Stored as a regular Gmail label, so it syncs everywhere.
- **Action required**: a second pile that works exactly like Set aside, for mail you need to act on. It sits next to the Set aside stack. A conversation lives in one pile at a time. Take one out with the ✕ on its card, or with "Remove from…" on the row, the ribbon or the bulk ribbon; it goes back to the Inbox.
- **Private notes**: stick a note on any conversation (for example "Paid on Nov 14"). Only you see it, it is never sent, and it syncs between devices through a hidden app folder in your Google Drive (optional, see `features.notes`).
- **Contact photos**: people's photos instead of initials, from your Google Contacts, "Other contacts" and, on Google Workspace, your organisation's directory (optional, see `features.contactPhotos`).

**Reading**
- Email content rendered in a sandboxed frame with scripts disabled
- Remote images blocked until you allow them, per message or per sender
- Attachments: preview images and PDFs, download anything
- Calendar invitations shown as a card
- One-click unsubscribe when the sender provides a link
- Show original, print

**Writing**
- Quick reply box at the bottom of every conversation, with a button to open the full reply
- Compose, reply, reply all, forward (with the original attachments)
- Rich text formatting, links, signatures, attachments (drag and drop works)
- Send from any of your Gmail "Send mail as" addresses
- Recipient suggestions from your recent conversations
- Drafts save automatically and sync with Gmail
- Undo send (0 to 30 seconds)

**Settings**
- Labels: create, rename, delete
- Filters: list, create, delete
- Signatures for each sending address, edited as rich text or HTML, with or without the `--` line
- Vacation responder
- Read-only status for forwarding, IMAP and POP
- Display options: density, reading pane, inbox categories, images, page size, language, keyboard shortcuts
- Appearance: light, dark or system mode, nine colour themes, and a custom logo upload
- Updates: upload a newer release zip from Settings, with an automatic backup and one-click restore (PHP hosts)

**App and notifications**
- Install Maillo as an app (Chrome, Edge, Safari on Mac, and Add to Home Screen on iPhone and Android) for its own window, a dock or taskbar icon, a "Compose" shortcut and an unread count on the icon
- Desktop notifications for new mail, with rules: all inbox mail, Primary only, Important only, or none, plus people, domains and labels that always notify
- A choice of four calm chimes (Mellow, Droplet, Breeze, Glass) made in the browser, with volume, quiet hours, a preview on/off switch and what to do while Maillo is in front
- Click a notification to open the conversation

**Extras**
- Optional Gemini relay (`ai.php`): the API key stays on your server, with a daily limit per account. Set it up in Settings → AI
- Keyboard shortcuts (press `?`), including `p` to set aside, `t` for Action required and `n` to add a note
- Optional side panels: today's Calendar agenda and Google Tasks
- Responsive layout for phones and tablets
- Demo mode with sample data

## Limits

Some Gmail features are not available to third-party apps through the Gmail API:

- **Snooze and schedule send** cannot be created. Maillo shows the Snoozed and Scheduled folders that Gmail keeps, but new snoozes and scheduled sends have to be set in Gmail itself.
- **Confidential mode**, **Smart Compose**, **Gemini summaries** and **mute** are not available.
- **Delete forever** and **empty trash** need a broader permission than Maillo asks for. Gmail empties Trash automatically after 30 days.
- **Forwarding, IMAP and POP** settings are shown but must be changed in Gmail.
- **Google Chat and Meet** open in their own apps.
- **Notifications only arrive while Maillo is open** (in a tab or as an installed app, even in the background). Getting them when it is closed needs Gmail push through a server, planned for later. Google's browser sign-in also lasts about an hour and can't be renewed without a click, so after a long time in the background Maillo shows one "Notifications paused" notice and waits for you to sign in again.
- **iPhone and iPad** only allow notifications from apps added to the Home Screen, and only through web push, so Maillo can't notify there yet.

## Install

See [docs/INSTALL.md](docs/INSTALL.md). In short:

1. Create an OAuth Client ID in Google Cloud.
2. Upload the files from the release zip to your web server.
3. Put your Client ID in `config.js`.

## Try it without Google

Open the app with `?demo` at the end of the address (for example `https://mail.example.com/?demo`), or set `demo: true` in `config.js`. Demo mode uses sample data and never contacts Google.

## Develop

Requires Node.js 20 or later.

```sh
npm install
npm run dev        # local server at http://localhost:5173
npm run build      # production files in dist/
npm run package    # dist/ plus docs zipped into release/
```

### Releasing

1. Bump `version` in `package.json` and merge to `main`.
2. Push a matching tag (`git tag v0.5.0 && git push origin v0.5.0`), or create a release on GitHub with that tag.

Either way, the Release workflow builds the install zip and attaches it to the release as `maillo-<version>.zip` and `maillo.zip`. The latest one is always at `https://github.com/<owner>/<repo>/releases/latest/download/maillo.zip`. Use that zip to install, not GitHub's "Source code" zip, which is the unbuilt repo.

Local development needs `http://localhost:5173` listed as an authorised JavaScript origin on your OAuth client, or use `?demo`.

### Project layout

```
public/config.js      runtime configuration, copied as-is into the build
public/.htaccess      headers for Apache hosts
public/manifest.webmanifest  web app manifest (installable app)
sw/sw.js              service worker template; the build fills in the version and file list
public/update.php     optional in-browser updater for PHP hosts
public/ai.php         optional Gemini relay for PHP hosts (key stays server-side)
public/maillo-common.php  sign-in check shared by the PHP files
src/ai.ts             client for ai.php
src/auth.ts           Google sign-in (token flow, no server)
src/gmail/api.ts      Gmail, Calendar and Tasks API calls
src/gmail/demo.ts     sample data for demo mode
src/gmail/mime.ts     message parsing and MIME building
src/store.ts          app state and actions
src/ui/               interface components
src/i18n.ts           English and French strings
```

To add a language, copy the `fr` dictionary in `src/i18n.ts`, translate it and add it to `dictionaries`.
