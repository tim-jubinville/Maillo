# Installing Maillo

Maillo is a web app with a few small PHP files on the server side. You need:

- A web host that runs **PHP 7.4 or later** (8.1 or later recommended: older versions no longer get security fixes) and serves files over **HTTPS** (Google sign-in requires it). Shared hosting (cPanel and similar) is the easiest; Nginx with PHP-FPM works too. Static hosts that can't run PHP (Cloudflare Pages, Netlify, GitHub Pages) aren't supported.
- An address for it, such as `https://mail.example.com`
- A Google account with Gmail, and access to [Google Cloud Console](https://console.cloud.google.com/)

The setup takes about 20 minutes.

---

## 1. Create a Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/) and sign in with the account that will own the project.
2. Create a new project (any name, such as "Maillo").
3. Go to **APIs & Services → Library** and enable:
   - **Gmail API** (required)
   - **Google Calendar API** (only if you turn on the calendar panel)
   - **Google Tasks API** (only if you turn on the tasks panel)
   - **Google Drive API** (only if you turn on private notes, settings sync or Stickies)
   - **People API** (only if you turn on contact photos)
   - **Generative Language API** (only if you turn on AI; see "Optional: AI with Gemini" below)

## 2. Configure the consent screen

Go to **APIs & Services → OAuth consent screen** (called **Google Auth Platform** in newer consoles).

**User type**

- **Internal** (Google Workspace accounts only). Only accounts in your organisation can sign in. There is no app verification and no 7-day sign-out. Choose this if your mailbox is on Google Workspace.
- **External** (personal @gmail.com accounts). Add your own address under **Test users**. While the app is in **Testing**, Google signs you out of Maillo after 7 days. Maillo works fully in the browser, so this only means signing in again when asked. You can also publish the app to **Production** without completing verification; Google then shows a "Google hasn't verified this app" warning at sign-in that you can click through.

**App information**: any app name and your support email.

**Scopes** (also called Data Access). Add:

| Scope | Why |
|---|---|
| `https://www.googleapis.com/auth/gmail.modify` | Read, label, archive, delete, send mail and manage drafts |
| `https://www.googleapis.com/auth/gmail.settings.basic` | Filters, signatures, vacation responder, forwarding status |
| `https://www.googleapis.com/auth/userinfo.profile` | Your name and profile photo for the account button. Without it, Maillo shows your initial |
| `https://www.googleapis.com/auth/calendar.events.readonly` | Optional: today's agenda |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | Optional: your calendar's colour, for events without their own colour |
| `https://www.googleapis.com/auth/calendar.calendars.readonly` | Optional: your calendar's colour labels, so events show the colours you picked in Google Calendar |
| `https://www.googleapis.com/auth/tasks` | Optional: Tasks panel and "Add to Tasks" |
| `https://www.googleapis.com/auth/drive.appdata` | Optional: private notes, settings sync and Stickies. Only gives access to Maillo's own hidden folder, not your Drive files |
| `https://www.googleapis.com/auth/contacts.readonly` | Optional: contact photos, from your Google Contacts |
| `https://www.googleapis.com/auth/contacts.other.readonly` | Optional: contact photos, from "Other contacts" (people you've emailed) |
| `https://www.googleapis.com/auth/directory.readonly` | Optional: contact photos of colleagues, from your Workspace directory |

## 3. Create the OAuth Client ID

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Under **Authorised JavaScript origins**, add the exact address of your install, with no trailing slash, for example `https://mail.example.com`.
4. No redirect URI is needed.
5. Create it and copy the **Client ID** (it ends in `.apps.googleusercontent.com`). Copy the **Client secret** too if you want to stay signed in (optional, see below).

## 4. Fill in maillo-config.php

Unzip the release. Open `maillo-config.php` (in the `maillo-x.y.z` folder) in a text editor and fill in at least these two settings:

```php
'googleClientId' => '1234567890-abc123.apps.googleusercontent.com',

'allowedAccounts' => ['you@example.com'],    // or 'allowedDomains' => ['example.com'],
```

Every setting is explained in the file itself, in plain language. Text goes between straight single quotes, lists between square brackets, and every line ends with a comma.

`maillo-config.php` never leaves your server. Browsers get only the safe settings (name, logo, client ID, language, theme, accent, features, links) through `config.php`; the allowed accounts, the client secret and the Gemini key stay on the server. Updates never replace this file.

| Setting | What it does |
|---|---|
| `appName` | Name in the browser tab, and in the header when there is no logo. The default, `'Maillo'`, shows the Maillo icon and wordmark; any other name is shown as text next to the icon. |
| `logoUrl` | Optional logo image (path or URL), shown in the header instead of the Maillo icon and name. A logo uploaded in **Settings → Appearance** takes priority. |
| `logoText` | Optional text shown after the logo, such as `'Mail'`. Empty (the default) shows the logo alone. |
| `logoInvertDark` | SVG logos are recoloured to match the theme automatically. For PNG, JPG or WebP logos, `true` turns a dark single-colour logo white in dark mode. |
| `googleClientId` | Required. The Client ID from step 3. |
| `googleClientSecret` | Optional. The client secret from step 3, needed only to stay signed in. It takes priority over a secret saved in Settings or set as an environment variable. |
| `allowedAccounts` | Email addresses allowed to use this install. Anyone else is signed out right away. Required, unless you use `allowedDomains`. |
| `allowedDomains` | Domains allowed to use this install, such as `'example.com'`. |
| `language` | `'auto'`, `'en'` or `'fr'`. People can also change it in Settings. |
| `theme` | Default colour theme: `sky`, `teal`, `pine`, `iris`, `plum`, `coral`, `tangerine`, `sunflower`, `cocoa` or `steel`. Each person can pick their own in Settings → Appearance, along with light, dark or system mode. |
| `accentColor` | Optional hex colour that replaces the default theme's accent. |
| `features.calendar` | Shows today's events in the side panel, in their Google Calendar colours, with a Join button for video calls (Meet, Zoom, Teams, Webex). A toggle switches between a list of events and a day view on an hour grid. Adds three read-only Calendar permissions at sign-in. |
| `features.tasks` | Shows Google Tasks in the side panel and an "Add to Tasks" button. Adds the Tasks permission. |
| `features.notes` | Private notes on conversations. Notes are saved in a hidden app folder in Google Drive, so they sync between devices and never appear in Gmail or in your Drive. Adds the Drive app-data permission and needs the Google Drive API. |
| `features.stickies` | Stickies side panel: colourful notes written in Markdown (bold, italic, headings, lists, to-dos you can tick, links). Saved in `maillo-stickies.json` in the same hidden Drive app folder as notes and settings, so they follow you on every device. Adds the `drive.appdata` permission (shared with `features.notes` and `features.syncSettings`) and needs the Drive API. Off: the Stickies icon is hidden. |
| `features.staySignedIn` | Each device stays signed in instead of a new Google sign-in every hour. Needs the client secret; see "Optional: stay signed in". |
| `features.syncSettings` | Keeps Maillo's settings the same on all your devices through a hidden file in Google Drive. Adds the `drive.appdata` permission (shared with `features.notes`) and needs the Drive API. |
| `features.contactPhotos` | Shows people's photos instead of initials, from your Google Contacts, "Other contacts" and, on Google Workspace, your organisation's directory. Read-only; photos are fetched once per browser session. Also lets search suggest people from your contacts and directory as you type, and turns on the Contacts side panel (your contacts, search, and full contact cards). Adds the three contacts/directory permissions and needs the People API. |
| `features.push` | New mail within seconds, and notifications while Maillo is closed. Needs staying signed in and a Pub/Sub topic; see "Optional: new mail within seconds". |
| `pushTopic` | The Pub/Sub topic for `features.push`, such as `'projects/my-project/topics/maillo'`. |
| `features.ai` | Turns on the Gemini relay (`ai.php`) and **Settings → AI**. See "Optional: AI with Gemini". |
| `geminiApiKey` | Optional Gemini API key for the AI features. It takes priority over a key saved in Settings or set as an environment variable. |
| `aiModel` | Gemini model used by the relay. Empty uses `gemini-flash-latest`. |
| `aiDailyLimit` | Maximum AI requests per account per day. `0` uses the default (300). |
| `setAsideLabel` | Gmail label used for the Set aside pile. Maillo creates it the first time you set something aside. If you rename the label in Gmail, change this to match. |
| `actionLabel` | Gmail label used for the Action required pile. Works like `setAsideLabel`. |
| `links` | Addresses opened by Chat, Meet, Calendar, Contacts and Gmail settings. Change them if you use a different Google account index (`/u/1/`) or other apps. |
| `demo` | `true` shows sample data and never contacts Google. |

Changes take effect on the next page load. No rebuild is needed.

## 5. Upload the files

Upload the contents of the `maillo-x.y.z` folder, with your filled-in `maillo-config.php`, to the folder your address points to. It should look like this:

```
index.html
maillo-config.php
config.php
.htaccess
update.php  session.php  ai.php  maillo-common.php
manifest.webmanifest
sw.js
assets/
```

`.htaccess` is a hidden file; make sure your upload tool includes it. It keeps `maillo-config.php` and Maillo's private `.maillo-*` files from ever being served, even as plain text if PHP stops working.

**Shared hosting (cPanel and similar).** Create the subdomain in your hosting panel, then upload the files to the subdomain's folder with the File Manager or SFTP. Turn on HTTPS for the subdomain (most hosts offer free certificates under "SSL/TLS").

**Nginx with PHP-FPM.** `.htaccess` doesn't apply, so add the same protections yourself:

```nginx
# In the server block. "always" keeps the headers on error pages too.
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy no-referrer always;
add_header X-Frame-Options DENY always;
add_header Cross-Origin-Opener-Policy same-origin-allow-popups always;

location / {
  try_files $uri $uri/ /index.html;
}
# Settings, secrets, sessions and backups are never served. Put these two above your
# PHP location (location ~ \.php$): Nginx uses the first matching one.
location ~ (^|/)(maillo-config|maillo-common)\.php$ { return 404; }
location ~ (^|/)\.(maillo|mailmax)- { return 404; }
# Always checked for a newer version (config.php sets its own headers: it only needs your PHP
# location). An add_header here replaces the server's, so repeat them.
location ~ ^/(sw\.js|manifest\.webmanifest|version\.json)$ {
  add_header Cache-Control no-cache;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;
  add_header X-Frame-Options DENY always;
}
```

Maillo's setup checklist looks for these rules in `.htaccess`, so on Nginx keep the release's `.htaccess` file in the folder as well (Nginx ignores it). It also asks your server for a throwaway `.maillo-` file once a day, and marks private files as unprotected if the server hands it out.

Maillo can also live in a sub-folder (for example `https://example.com/mail/`). The authorised origin is still just `https://example.com`.

**The setup checklist.** If a required setting is missing or the server isn't ready, Maillo shows a checklist instead of the sign-in button: client ID set, allowed accounts set, PHP version, private files protected, folder writable, OpenSSL and cURL available. Each item says yes or no and how to fix it; none of your settings are shown. Fix what's marked, then click **Check again**.

## 6. Sign in

Open your address and click **Continue with Google**. Allow pop-ups for the site if the browser blocks the sign-in window.

---

## Optional: put a login wall in front

Maillo only shows mail after a Google sign-in, but you can also hide the site itself from the public. A common option is **Cloudflare Access** (free for small teams):

1. Move your domain's DNS to Cloudflare (or add the subdomain to a Cloudflare zone) with the proxy turned on. Copy every existing DNS record first, especially mail (MX, SPF, DKIM) records, so email keeps working.
2. In **Zero Trust → Access → Applications**, add a self-hosted application for your Maillo address.
3. Add a policy that allows only your email address. Choose Google as the login method if you want one Google sign-in for both.

Other options: HTTP basic authentication on your web server, or a VPN.

## Optional: install as an app and get notifications

Maillo is an installable web app. It needs HTTPS (or `localhost`).

- **Install:** open **Settings → Install app**. In Chrome and Edge there is an **Install** button; Safari on a Mac uses **File → Add to Dock**, and iPhone and iPad use **Share → Add to Home Screen**.
- **Notifications:** open **Settings → Notifications**, turn them on and allow them when the browser asks. Choose which mail notifies, people and labels that always notify, a chime, quiet hours, and what happens while Maillo is in front. **Send a test notification** checks that everything works.

Maillo checks for new mail about once a minute while it is open, in a tab or an installed app window, even in the background. Nothing arrives once it is closed. Browsers only let a page play sound after a click, so click once anywhere in Maillo after opening it for chimes to play in the background. If you sign in through Cloudflare Access, nothing else is needed: the app manifest is requested with your Access cookie.

The installed app is named "Maillo". To use another name, edit `name` and `short_name` in `manifest.webmanifest`; note that updates replace that file.

## Optional: AI with Gemini

Maillo can call the Gemini API through `ai.php`, a small relay on your server, so the API key is never sent to the browser. It uses the same sign-in check as the updater: only accounts in `allowedAccounts` or `allowedDomains` can use it.

1. In the same Google Cloud project, enable the **Generative Language API**.
2. Create an API key in [Google AI Studio](https://aistudio.google.com/apikey) for that project. In Google Cloud, under **APIs & Services → Credentials**, restrict the key to the Generative Language API.
3. Set `features.ai` to `true` in `maillo-config.php`.
4. Put the key in `geminiApiKey` in `maillo-config.php`. Or open **Settings → AI**, paste the key and click **Save key**: Maillo checks it with Google, then stores it in `.maillo-ai.php` on the server (never served, backed up or replaced by updates). A `GEMINI_API_KEY` environment variable also works. If more than one is set, `maillo-config.php` wins, then the environment variable.
5. Click **Test the connection**.

Use a paid Gemini API plan for email. On the free tier, Google may use what you send to improve its products. Each account is limited to `aiDailyLimit` requests per day (300 by default), and Google's own spending cap applies on top.

## Optional: Stickies

Set `features.stickies` to `true`, make sure the **Google Drive API** is on, then sign out and in again (once, unless you already use notes or settings sync, which ask for the same permission). Open Stickies from the right bar:

- **New sticky** adds one at the top. Write in Markdown: `**bold**`, `_italic_`, `~~strikethrough~~`, `` `code` ``, `# headings`, lists, `- [ ] to-dos` (tick them right on the sticky), `> quotes` and links. Press Esc or click outside to finish.
- Hover a sticky to change its colour (yellow, orange, pink, purple, blue, green or grey), edit it or delete it (with Undo).
- Stickies save to `maillo-stickies.json` in Drive's hidden app folder: invisible in Drive, private to Maillo. Each save merges with the copy in Drive, so editing on two devices never loses a sticky.

Google Keep was removed in 0.9.0: its API only works on Workspace with an admin's approval and kept asking for sign-in. Your Keep notes stay in Keep; remove `features.keep` and `links.keep` from `maillo-config.php` if you had them (they're ignored now).

## Optional: stay signed in

Browser-only sign-in lasts one hour, after which Google asks again. With `session.php`, each device stays signed in until you sign out:

1. Set `features.staySignedIn` to `true` in `maillo-config.php`.
2. In Google Cloud, open **APIs & Services → Credentials**, open your Web client and copy its **Client secret**. No redirect URI is needed.
3. Put it in `googleClientSecret` in `maillo-config.php`. Or sign in, open **Settings → Accounts & signatures → Stay signed in**, paste the secret and click **Save**: Maillo checks it with Google, then stores it in `.maillo-oauth.php` on the server (never served, backed up or replaced by updates). A `GOOGLE_CLIENT_SECRET` environment variable also works. If more than one is set, `maillo-config.php` wins, then the environment variable.
4. Sign out and sign in again on each device. Google shows its consent screen once per device.

How it works: signing in hands `session.php` a one-time code. It trades it for a Google refresh token, which stays on the server, encrypted (AES-256-GCM, key in `.maillo-oauth.php`) in `.maillo-sessions/`. The browser gets only an HttpOnly, SameSite=Strict cookie and asks `session.php` for a fresh one-hour access token when it needs one, so notifications also keep working in the background. Signing out ends that device's session only. **Settings → Accounts & signatures → Sign out everywhere** ends every device's session and revokes Maillo's access to the account (Google treats any revocation as ending the whole grant, on every device). Sessions also end after 180 days without use, when the account is removed from `allowedAccounts`/`allowedDomains`, or when access is revoked at [myaccount.google.com/permissions](https://myaccount.google.com/permissions). Removing the secret in Settings ends every session.

If your consent screen is in **Testing** (External user type), Google expires refresh tokens after 7 days; publish the app or use the Internal user type to avoid that. Needs PHP's OpenSSL extension (standard).

**Keeping the key apart (optional).** Refresh tokens are encrypted with a key that `session.php` keeps in `.maillo-oauth.php`, next to them. To keep it elsewhere, set a `MAILLO_SESSION_KEY` environment variable in your hosting panel (best, since it lives outside the web folder) or `sessionKey` in `maillo-config.php`, to 32 random bytes in base64 (`php -r "echo base64_encode(random_bytes(32));"`). Changing the key signs every device out once.

## Optional: new mail within seconds, and notifications while Maillo is closed

Without this, Maillo checks for new mail about once a minute, and only notifies while it's open (in a tab or as an installed app). With `features.push`, Gmail tells your server the moment mail arrives, and your server sends a notification to each device that turned it on, even when Maillo is closed. Mail also shows up in an open Maillo within seconds.

How it works: Gmail can only announce new mail through **Google Cloud Pub/Sub**, so there's a little setup in Google Cloud. Pub/Sub posts each announcement to `push.php` on your server. `push.php` asks Gmail what's new (using the sign-in that `session.php` keeps, so staying signed in is needed), applies each device's notification rules from **Settings → Notifications** (scope, people, labels, preview, sound, quiet hours), and sends an encrypted web push to that device. Push messages are encrypted for the device and signed with your install's own key, so the browser's push service (Google, Mozilla, Apple or Microsoft, depending on the browser) only carries them.

**You need:** PHP's OpenSSL extension, staying signed in set up (see above), and the same Google Cloud project (Google may ask you to add billing details to use Pub/Sub; its free monthly allowance covers a personal mailbox many times over).

1. **Enable Pub/Sub.** In Google Cloud (the same project as your OAuth client), open **APIs & Services → Library** and enable the **Cloud Pub/Sub API**.
2. **Create a topic.** Open **Pub/Sub → Topics → Create topic**. Name it `maillo`, untick "Add a default subscription", and create it. Copy its full name, `projects/your-project-id/topics/maillo`.
3. **Let Gmail publish to it.** On the topic, open **Permissions** (or the info panel) → **Add principal**: `gmail-api-push@system.gserviceaccount.com`, role **Pub/Sub Publisher**. On Workspace, if your organisation restricts sharing to its own domain ("Domain restricted sharing"), an admin has to allow this one service account first.
4. **Turn it on.** Set `features.push` to `true` and `pushTopic` to the topic's full name, in your settings file. Reload Maillo.
5. **Copy your push address.** Open **Settings → Notifications → When Maillo is closed**. It shows a **Pub/Sub push endpoint** like `https://mail.example.com/push.php?key=…`. Copy it. The key in it is your install's own; keep it private.
6. **Create the subscription.** Back on the topic, **Create subscription**: any name, **Delivery type: Push**, endpoint URL: the address you copied. Leave the rest as is (no authentication needed: the key in the address is the check) and create it.
7. **Turn it on for each device.** In **Settings → Notifications → When Maillo is closed**, click **Turn on** and allow notifications. **Send a test** checks the whole path to this device. Notifications follow the rules above it, and changes to the rules reach the server on their own.

**Good to know:**

- **Renewal.** Gmail stops announcing a mailbox after 7 days unless it's renewed. Maillo renews it whenever mail arrives and whenever you open Maillo, which is usually enough. For quiet weeks, add a daily cron job in your hosting panel that opens the **Daily renewal** address shown in Settings, for example `curl -fsS "https://mail.example.com/push.php?renew=…"` (or run `php push.php renew` in Maillo's folder).
- **What's watched.** The Inbox, plus labels a device chose under "Always notify for these labels". Mail from "always notify" people that skips the Inbox (because of a filter, say) only notifies if it also gets one of those labels.
- **Testing consent screens.** If your OAuth consent screen is in **Testing**, Google ends the server's sign-in after 7 days, and pushes stop until you sign in again. Publish the app or use the Internal user type.
- **iPhone and iPad** receive web push only from Maillo added to the Home Screen (iOS 16.4 or later).
- **Behind a login wall.** Pub/Sub must be able to reach `push.php`. With Cloudflare Access, add a bypass for the path `/push.php` (the key in the address still guards it).
- **Quota.** Each new message costs about 7 Gmail quota units on the server (history and one message header), far below Google's limits.
- **What's stored.** `.maillo-push/` holds the endpoint key, the push signing key and, per account, each device's push address and notification rules. It's never served, backed up or replaced by updates. Turning push off on a device removes it; devices whose browser drops the subscription are removed automatically.

## Optional: the same settings on every device

Set `features.syncSettings` to `true` (it needs the Drive API and the `drive.appdata` scope, like `features.notes`), then sign out and in again. Maillo saves your settings to a hidden file in your Drive's app folder (`maillo-settings.json`, invisible in Drive) and applies the newest copy on each device. Column widths, text size, the open side panel and whether notifications are turned on stay per device.

## Updating

**Update notices.** Twice a day at most, `update.php` asks GitHub for the latest Maillo release and keeps the answer in `.maillo-update.json` (never served or replaced by updates). When a newer version is out, a dot appears on your avatar and its menu offers it. **Settings → Updates** shows it with its release notes and an **Install** button: the server downloads the release zip from GitHub, checks it against GitHub's SHA-256 checksum, then installs it exactly like an uploaded zip (below). **Check now** asks again straight away.

The check tells GitHub that an install exists at your server's address, nothing more. To turn it off, set `'updateCheck' => false` in `maillo-config.php`: GitHub then never hears from your install, and you update by uploading zips. Your host must allow outgoing HTTPS requests (the curl extension, or `allow_url_fopen`).

**Beta channel.** New releases first go out as GitHub pre-releases, which the check doesn't offer. To try them before everyone else, set `'updateChannel' => 'beta'` in `maillo-config.php`: the check then offers the newest release, pre-releases included, and **Settings → Updates** says the install is on the beta channel. Set it back to `'stable'` (the default) to get official releases only. Going back to stable doesn't downgrade you: you stay on the pre-release until the next official version is newer.

**From the browser.** Open **Settings → Updates**, choose the new release zip and click **Install update**. Maillo:

- checks that the zip is a Maillo release and refuses unexpected files
- keeps your `maillo-config.php` and `.htaccess`
- backs up the current version to `.maillo-backup/` (the last three are kept, and the folder is blocked from the web)
- installs the new files and reloads

**Restore previous version** in the same section puts the last backup back.

This needs PHP's zip extension and write permission on the install folder (standard on cPanel hosting). It only works for accounts in `allowedAccounts` or `allowedDomains`: the server checks your Google sign-in against your OAuth Client ID before changing anything. If the upload is refused as too large, raise `upload_max_filesize` and `post_max_size` in your host's PHP settings.

**By hand.** Upload the files from a newer release, but keep your own `maillo-config.php`: don't overwrite it with the blank one from the zip. Browsers pick up the new version on the next load.

**Moving from config.js (installs made before 0.6.9).** Maillo 0.7.0 no longer reads `config.js`. Before updating:

1. Open `maillo-config.php` on the server (download it from the zip if it isn't there) and copy each value across from `config.js`. The names are the same; only the punctuation differs: `googleClientId: "…"` becomes `'googleClientId' => '…',` and `allowedAccounts: ["you@example.com"]` becomes `'allowedAccounts' => ['you@example.com'],`.
2. Replace `.htaccess` with the one from the release (the updater never replaces it), so `maillo-config.php` can never be served.
3. Update, reload Maillo and sign in. If anything is missing, the setup checklist says what.
4. Delete `config.js` and `config.example.js` from the server: `config.js` is public and lists your allowed accounts.

If you do not want browser updates at all, delete `update.php` from the server.

**Upgrading from 0.6.1 or earlier to 0.6.2 or later.** 0.6.2 adds a server file (`session.php`) that older updaters refuse ("unexpected file"). Upload the new `update.php` from the release zip by hand once, then install the zip from **Settings → Updates**. From then on, the updater accepts new server files a release declares itself.

## Security notes

- Maillo runs in the browser. Google access tokens are kept in the tab's session storage and are cleared when you sign out or close the tab. The server-side files are `update.php` (updates and logo), `ai.php` (optional Gemini relay) and `session.php` (optional lasting sign-in). They check your Google sign-in and allowed account before doing anything, using `maillo-common.php`. `config.php` gives the browser only the safe part of `maillo-config.php`; allowed accounts and secrets never leave the server, and `.htaccess` blocks `maillo-config.php` from the web. With `staySignedIn`, refresh tokens never reach the browser: they stay encrypted on the server behind an HttpOnly cookie, and `session.php` only answers requests carrying Maillo's own header (so other sites can't use the cookie). With `push`, `push.php` uses those same server-side sign-ins to read new mail's sender, subject and snippet, and sends them to your devices encrypted end to end (RFC 8291), signed with your install's own key (RFC 8292).
- To open instantly and work offline, Maillo keeps conversation headers (sender, subject, snippet), what each list showed, labels and counts, and the last 150 conversations you opened (or that were fetched ahead of you) in the browser's IndexedDB on this device. It's tied to your account (another account starts from empty) and deleted when you sign out. Nothing is kept in demo mode. On a shared computer, turn off **Settings → General → Keep mail on this device** (it deletes what's kept right away), or sign out when you're done.
- Email content is shown in a sandboxed frame with scripts disabled, and is sanitised before display.
- Remote images are blocked until you allow them, so senders cannot tell when you open a message.
- The content security policy only allows connections to Google's APIs.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Almost ready" checklist | A required setting is missing or the server isn't ready. Each item says how to fix it. |
| "Maillo couldn't load its settings" | The host didn't run `config.php`. Check that the host runs PHP and that `config.php` and `maillo-config.php` were uploaded next to `index.html`. Open `https://your-address/config.php`: it should show a line starting with `window.MAILLO_CONFIG` or `window.MAILLO_SETUP`, not PHP code or an error page. |
| `redirect_uri_mismatch` or `origin_mismatch` | The address in the browser does not exactly match an authorised JavaScript origin (check `https`, `www`, and the port). |
| `access_denied` | Your account is not a test user (External, Testing) or not in the organisation (Internal). |
| "… is not allowed on this install" | The account is not listed in `allowedAccounts` or `allowedDomains`. |
| Sign-in window does not appear | Allow pop-ups for the site. |
| Notes say they could not be saved or loaded | Enable the Google Drive API, add the `drive.appdata` scope, set `features.notes` to `true`, then sign out and in again. |
| Settings → AI says ai.php is not reachable | `ai.php` was not uploaded, or a login wall or firewall blocks it. |
| "Google rejected this key" | Enable the Generative Language API in the key's project, and check the key's API restrictions. |
| Contact photos don't appear | Enable the People API, add the three contacts/directory scopes, set `features.contactPhotos` to `true`, then sign out and in again. Only people with a photo in Contacts or the directory get one. |
| Calendar or Tasks panel is empty | Enable the API in Google Cloud, add the scope, set the feature to `true`, then sign out and in again. |
| No Install button in Settings | The browser doesn't offer one (Safari, Firefox), the site isn't on HTTPS, or Maillo is already installed. Follow the steps shown on the page. |
| Notifications don't appear | Check that the site is allowed to notify in the browser's site settings and in your system's notification settings (macOS: System Settings → Notifications → your browser; Windows: Settings → System → Notifications), and that Focus or Do Not Disturb is off. |
| No chime in the background | Click once anywhere in Maillo after opening it; browsers block sound until then. |
| Push: "Gmail couldn't watch your mailbox" | `pushTopic` is wrong, or `gmail-api-push@system.gserviceaccount.com` isn't a Publisher on the topic. |
| Push: the test arrives but new mail doesn't | Check that the Pub/Sub subscription's endpoint is the address from Settings (Pub/Sub → Subscriptions → your subscription shows failed deliveries), and that a login wall lets Pub/Sub reach `/push.php`. |
| "Notifications paused" | Your Google session ended while Maillo was in the background. Open it and sign in again. |
| Asked to sign in again every week | External app in Testing mode. Publish it to Production, or use an Internal app on Workspace. |
