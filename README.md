# Maillo

A self-hosted web interface for Gmail. Your mail stays in your Google account; Maillo is a set of static files you upload to your own web server. It talks to Gmail directly from your browser through Google's official API.

- No database and no third-party service in between; one settings file (`maillo-config.php`) and a few small PHP files: settings for the browser (`config.php`), an updater (`update.php`), lasting sign-in (`session.php`) and a Gemini relay (`ai.php`)
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
- The list's top bar is a frosted ribbon (select all, refresh, paging); selecting conversations swaps in the bulk actions in place: archive, delete, spam, piles, read/unread, star, important, move, label (extra actions fold into "…"). Beside an open conversation, it joins the reading pane's ribbon into one
- Move to and Label as open with a search field ready to type in; Enter picks the first match
- Quoted earlier messages (Gmail, Outlook, Apple Mail, plain-text "> " replies…) are folded behind a ··· button in every message; forwards stay visible
- Search suggestions as you type: folders and labels, people (recent correspondents, plus your Google Contacts and Workspace directory with `features.contactPhotos`), matching conversations, and your recent searches
- The message list only renders the rows on screen, so long pages scroll smoothly; keyboard navigation, selection, drag and drop and screen readers (position and count of each row) work as before
- Resizable columns (folder list, message list, side panel); widths, the open side panel and a hidden folder list are remembered in this browser. Double-click a divider to reset it
- Hover actions on each row: archive, delete, mark read/unread, set aside, Action required
- Drag and drop: drag conversations (or the whole selection) onto a label, Inbox, Starred, Important, All mail, Spam, Trash or a pile; drag a label from the sidebar onto a conversation to apply it
- Undo for archive, delete, spam, move and label changes
- Reminders for important messages you have not answered ("Received 3 days ago. Reply?")
- **Set aside**: pin conversations out of the inbox into a small stack of cards at the bottom of the screen. Click the stack to fan the cards out and pick one, or "Go through all" to open the first and step through the rest with the ribbon's arrows. Escape folds the cards back into the stack. Stored as a regular Gmail label, so it syncs everywhere.
- **Action required**: a second pile that works exactly like Set aside, for mail you need to act on. It sits next to the Set aside stack. A conversation lives in one pile at a time. Take one out with the ✕ on its card, or by un-pressing its pile button (shown pressed in on the row, the ribbon and the selection actions); it goes back to the Inbox.
- **Private notes**: stick a note on any conversation (for example "Paid on Nov 14"). Only you see it, it is never sent, and it syncs between devices through a hidden app folder in your Google Drive (optional, see `features.notes`).
- **Contact photos**: people's photos instead of initials, from your Google Contacts, "Other contacts" and, on Google Workspace, your organisation's directory (optional, see `features.contactPhotos`).
- **Contacts panel**: browse and search your Google Contacts beside your mail, see the people in the open conversation, and open a card with their emails, phones, address, birthday and links. You can email someone, find all mail with them, copy details, or open them in Google Contacts to edit (uses the same optional `features.contactPhotos` permissions; read-only).

**Reading**
- Email content rendered in a sandboxed frame with scripts disabled
- Remote images blocked until you allow them, per message or per sender
- Attachments: preview images and PDFs, download anything
- Calendar invitations shown as a card
- One-click unsubscribe when the sender provides a link
- Show original, print

**Writing**
- Quick reply box at the bottom of every conversation, with a button to open the full reply
- Optional: Google Keep side panel (Workspace accounts, with an admin's approval): see your notes, add one, delete; hidden otherwise
- Friendly empty states in the Calendar, Tasks, Keep and Contacts panels
- Optional: stay signed in on each device (refresh token kept encrypted on your server by `session.php`) instead of a new Google sign-in every hour
- Optional: the same settings on all your devices, synced through a hidden file in Google Drive
- Light on Google's API quota: checks for changes with Gmail's history (2 units) before reloading anything, fetches conversation headers in batches, remembers them on the device between visits, and slows down instead of failing when Google rate-limits
- Instant start: the inbox (with labels, counts and piles) appears at once from what this device kept, then refreshes quietly in the background
- Recently opened conversations are kept on the device (IndexedDB), so they reopen at once and can be read offline; the conversations either side of the open one are fetched ahead, so the ribbon arrows and j/k feel instant
- Compose in its own browser window: the pop-out button in the compose header, or Shift + click on Compose; the draft keeps saving and can come back into Maillo
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
- Display options: density, reading pane (none by default, like Gmail: a one-line list that opens conversations in its place; or beside the list), inbox categories, default reply (sender or everyone), images, page size, language, keyboard shortcuts
- Appearance: light, dark or system mode, ten colour themes, interface text size, colour or outline icons, hover tooltips on icon buttons, and a custom logo upload
- Updates: notices when a new release is out and one-click install from GitHub, or upload a release zip; automatic backup and one-click restore (PHP hosts)

**App and notifications**
- Install Maillo as an app (Chrome, Edge, Safari on Mac, and Add to Home Screen on iPhone and Android) for its own window, a dock or taskbar icon, a "Compose" shortcut and an unread count on the icon
- Desktop notifications for new mail, with rules: all inbox mail, Primary only, Important only, or none, plus people, domains and labels that always notify
- A choice of four calm chimes (Mellow, Droplet, Breeze, Glass) made in the browser, with volume, quiet hours, a preview on/off switch and what to do while Maillo is in front
- Click a notification to open the conversation
- Optional Gmail push (`push.php`): new mail within seconds, and notifications even when Maillo is closed, following each device's rules. Needs a Google Cloud Pub/Sub topic; see INSTALL.md

**Extras**
- Optional Gemini relay (`ai.php`): the API key stays on your server, with a daily limit per account. Set it up in Settings → AI
- Keyboard shortcuts (press `?`, or open them from the account menu), including `p` to set aside, `t` for Action required, `n` to add a note, and `v` / `l` to open Move to / Label as
- Optional side panels: today's Calendar agenda (in your Google Calendar colours, with a Join button for Meet, Zoom, Teams and Webex calls) and Google Tasks
- Responsive layout for phones and tablets
- Demo mode with sample data

## Limits

Some Gmail features are not available to third-party apps through the Gmail API:

- **Snooze and schedule send** cannot be created. Maillo shows the Snoozed and Scheduled folders that Gmail keeps, but new snoozes and scheduled sends have to be set in Gmail itself.
- **Confidential mode**, **Smart Compose**, **Gemini summaries** and **mute** are not available.
- **Delete forever** and **empty trash** need a broader permission than Maillo asks for. Gmail empties Trash automatically after 30 days.
- **Forwarding, IMAP and POP** settings are shown but must be changed in Gmail.
- **Google Chat and Meet** open in their own apps.
- **Notifications while Maillo is closed** need the optional Gmail push (`features.push`): a PHP host, staying signed in, and a Google Cloud Pub/Sub topic. Without it, notifications only arrive while Maillo is open (in a tab or as an installed app, even in the background).
- **iPhone and iPad** only allow notifications from apps added to the Home Screen, through web push: they need `features.push`.

## Install

See [docs/INSTALL.md](docs/INSTALL.md). In short:

1. Create an OAuth Client ID in Google Cloud.
2. Fill in `maillo-config.php` from the release zip: your Client ID and who may sign in. It's the only file to edit.
3. Upload the files to your web server and open the address. If anything is missing, Maillo shows a checklist.

Hosts without PHP use `config.js` instead (rename `config.example.js`). Installs made before 0.6.9 keep using `config.js` until you move to `maillo-config.php` (see INSTALL.md).

## Try it without Google

Open the app with `?demo` at the end of the address (for example `https://mail.example.com/?demo`), or set `demo` to true in `maillo-config.php`. Demo mode uses sample data and never contacts Google.

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

### Website

The landing page lives in `site/` (plain HTML, no build). On every push to `main`, the Website workflow publishes it to GitHub Pages, with a demo build of the app at `/demo/` (sample data only). To turn it on: Settings → Pages → Source: **GitHub Actions**. For a custom domain, add it in the same screen.

### Project layout

```
public/maillo-config.php  the one settings file (never served; config.php hands the browser its safe part)
public/config.php     gives the browser its settings as window.MAILLO_CONFIG, or the setup checklist
public/config.example.js  settings for hosts without PHP (renamed to config.js there)
public/.htaccess      headers for Apache hosts
public/manifest.webmanifest  web app manifest (installable app)
sw/sw.js              service worker template; the build fills in the version and file list
public/update.php     optional in-browser updater for PHP hosts
public/ai.php         optional Gemini relay for PHP hosts (key stays server-side)
public/push.php       optional Gmail push and web push (VAPID, encrypted payloads) for PHP hosts
public/maillo-common.php  settings reader and sign-in check shared by the PHP files
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
