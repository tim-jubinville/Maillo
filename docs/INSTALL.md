# Installing Maillo

Maillo is a static website. You need:

- A web server or static host that serves files over **HTTPS** (Google sign-in requires it)
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
   - **Google Drive API** (only if you turn on private notes)
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
| `https://www.googleapis.com/auth/drive.appdata` | Optional: private notes and settings sync. Only gives access to Maillo's own hidden folder, not your Drive files |
| `https://www.googleapis.com/auth/contacts.readonly` | Optional: contact photos, from your Google Contacts |
| `https://www.googleapis.com/auth/contacts.other.readonly` | Optional: contact photos, from "Other contacts" (people you've emailed) |
| `https://www.googleapis.com/auth/directory.readonly` | Optional: contact photos of colleagues, from your Workspace directory |

## 3. Create the OAuth Client ID

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Under **Authorised JavaScript origins**, add the exact address of your install, with no trailing slash, for example `https://mail.example.com`.
4. No redirect URI is needed.
5. Create it and copy the **Client ID** (it ends in `.apps.googleusercontent.com`). There is no client secret to keep: Maillo does not use one.

## 4. Upload the files

Unzip the release and upload the contents of the `maillo-x.y.z` folder to the folder your address points to. It should look like this:

```
index.html
config.js
.htaccess
manifest.webmanifest
sw.js
assets/
```

`.htaccess` is a hidden file; make sure your upload tool includes it if you use Apache.

**Shared hosting (cPanel and similar).** Create the subdomain in your hosting panel, then upload the files to the subdomain's folder with the File Manager or SFTP. Turn on HTTPS for the subdomain (most hosts offer free certificates under "SSL/TLS").

**Nginx.** Serve the folder as static files. Suggested headers:

```nginx
location / {
  try_files $uri $uri/ /index.html;
  add_header X-Content-Type-Options nosniff;
  add_header Referrer-Policy no-referrer;
  add_header X-Frame-Options DENY;
  add_header Cross-Origin-Opener-Policy same-origin-allow-popups;
}
location ~ ^/(config\.js|sw\.js|manifest\.webmanifest)$ { add_header Cache-Control no-cache; }
```

**Static hosts** (Cloudflare Pages, Netlify, GitHub Pages, and others). Upload the folder as the site root.

Maillo can also live in a sub-folder (for example `https://example.com/mail/`). The authorised origin is still just `https://example.com`.

## 5. Edit config.js

Open `config.js` on the server and set at least `googleClientId`:

```js
window.MAILLO_CONFIG = {
  appName: "Maillo",
  logoUrl: "",
  logoText: "",
  logoInvertDark: true,
  googleClientId: "1234567890-abc123.apps.googleusercontent.com",
  allowedAccounts: ["you@example.com"],
  allowedDomains: [],
  language: "auto",
  theme: "sky",
  accentColor: "",
  features: { calendar: false, tasks: false, notes: false },
  setAsideLabel: "Set aside",
  actionLabel: "Action required",
  links: { /* see below */ },
  demo: false
};
```

| Option | What it does |
|---|---|
| `appName` | Name in the browser tab, and in the header when there is no logo. The default, `"Maillo"`, shows the Maillo icon and wordmark; any other name is shown as text next to the icon. |
| `logoUrl` | Optional logo image (path or URL), shown in the header instead of the Maillo icon and name. A logo uploaded in **Settings → Appearance** takes priority. |
| `logoText` | Optional text shown after the logo, such as `"Mail"`. Empty (the default) shows the logo alone. |
| `logoInvertDark` | SVG logos are recoloured to match the theme automatically. For PNG, JPG or WebP logos, `true` turns a dark single-colour logo white in dark mode. |
| `googleClientId` | Required. The Client ID from step 3. |
| `allowedAccounts` | Email addresses allowed to use this install. Anyone else is signed out right away. |
| `allowedDomains` | Domains allowed to use this install, such as `"example.com"`. |
| `language` | `"auto"`, `"en"` or `"fr"`. People can also change it in Settings. |
| `theme` | Default colour theme: `sky`, `teal`, `pine`, `iris`, `plum`, `coral`, `tangerine`, `sunflower`, `cocoa` or `steel`. Each person can pick their own in Settings → Appearance, along with light, dark or system mode. |
| `accentColor` | Optional hex colour that replaces the default theme's accent. |
| `features.calendar` | Shows today's events in the side panel, in their Google Calendar colours, with a Join button for video calls (Meet, Zoom, Teams, Webex). Adds three read-only Calendar permissions at sign-in. |
| `features.tasks` | Shows Google Tasks in the side panel and an "Add to Tasks" button. Adds the Tasks permission. |
| `features.notes` | Private notes on conversations. Notes are saved in a hidden app folder in Google Drive, so they sync between devices and never appear in Gmail or in your Drive. Adds the Drive app-data permission and needs the Google Drive API. |
| `actionLabel` | Gmail label used for the Action required pile. Works like `setAsideLabel`. |
| `setAsideLabel` | Gmail label used for the Set aside pile. Maillo creates it the first time you set something aside. If you rename the label in Gmail, change this to match. |
| `features.keep` | Google Keep side panel: your notes, a quick note field and delete. Workspace only; needs the Keep API and an admin's approval (see "Optional: Google Keep"). Off: the Keep icon is hidden. |
| `features.staySignedIn` | Each device stays signed in instead of a new Google sign-in every hour. Needs PHP and your OAuth client secret on the server; see "Optional: stay signed in". |
| `features.syncSettings` | Keeps Maillo's settings the same on all your devices through a hidden file in Google Drive. Adds the `drive.appdata` permission (shared with `features.notes`) and needs the Drive API. |
| `features.contactPhotos` | Shows people's photos instead of initials, from your Google Contacts, "Other contacts" and, on Google Workspace, your organisation's directory. Read-only; photos are fetched once per browser session. Also lets search suggest people from your contacts and directory as you type, and turns on the Contacts side panel (your contacts, search, and full contact cards). Adds the three contacts/directory permissions and needs the People API. |
| `features.ai` | Turns on the Gemini relay (`ai.php`) and **Settings → AI**. Needs a PHP host. See "Optional: AI with Gemini". |
| `aiModel` | Gemini model used by the relay. Empty uses `gemini-flash-latest`. |
| `aiDailyLimit` | Maximum AI requests per account per day. `0` uses the default (300). |
| `links` | Addresses opened by Chat, Meet, Calendar, Keep, Contacts and Gmail settings. Change them if you use a different Google account index (`/u/1/`) or other apps. |
| `demo` | `true` shows sample data and never contacts Google. |

Leave `allowedAccounts` and `allowedDomains` empty only if Google's consent screen already limits who can sign in (Internal user type, or Testing with a test-user list).

Changes to `config.js` take effect on the next page load. No rebuild is needed.

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
3. Set `features.ai` to `true` in `config.js`.
4. Open **Settings → AI**, paste the key and click **Save key**. Maillo checks it with Google, then stores it in `.maillo-ai.php` on the server. That file is never served, backed up or replaced by updates. If your host lets you set environment variables, you can set `GEMINI_API_KEY` instead.
5. Click **Test the connection**.

Use a paid Gemini API plan for email. On the free tier, Google may use what you send to improve its products. Each account is limited to `aiDailyLimit` requests per day (300 by default), and Google's own spending cap applies on top.

## Optional: Google Keep (Workspace only)

Google only opens its Keep API to Google Workspace accounts, and only once an administrator allows the app. The API can list, create and delete notes, but not edit them. Without `features.keep`, the Keep icon is hidden.

1. In Google Cloud, enable the **Google Keep API**.
2. In the Google Admin console, open **Security → Access and data control → API controls → Manage domain-wide delegation → Add new**. Client ID: your OAuth client ID. Scope: `https://www.googleapis.com/auth/keep`.
3. Set `features.keep` to `true` in `config.js`, then sign out and in again.

## Optional: stay signed in

Browser-only sign-in lasts one hour, after which Google asks again. With `session.php` (PHP hosts), each device stays signed in until you sign out:

1. Set `features.staySignedIn` to `true` in `config.js`.
2. In Google Cloud, open **APIs & Services → Credentials**, open your Web client and copy its **Client secret**. No redirect URI is needed.
3. Sign in, open **Settings → Accounts & signatures → Stay signed in**, paste the secret and click **Save**. Maillo checks it with Google, then stores it in `.maillo-oauth.php` on the server (never served, backed up or replaced by updates). You can set a `GOOGLE_CLIENT_SECRET` environment variable instead.
4. Sign out and sign in again on each device. Google shows its consent screen once per device.

How it works: signing in hands `session.php` a one-time code. It trades it for a Google refresh token, which stays on the server, encrypted (AES-256-GCM, key in `.maillo-oauth.php`) in `.maillo-sessions/`. The browser gets only an HttpOnly, SameSite=Strict cookie and asks `session.php` for a fresh one-hour access token when it needs one, so notifications also keep working in the background. Sessions end when you sign out, after 180 days without use, when the account is removed from `allowedAccounts`/`allowedDomains`, or when access is revoked at [myaccount.google.com/permissions](https://myaccount.google.com/permissions). Removing the secret in Settings ends every session.

If your consent screen is in **Testing** (External user type), Google expires refresh tokens after 7 days; publish the app or use the Internal user type to avoid that. Needs PHP's OpenSSL extension (standard).

## Optional: the same settings on every device

Set `features.syncSettings` to `true` (it needs the Drive API and the `drive.appdata` scope, like `features.notes`), then sign out and in again. Maillo saves your settings to a hidden file in your Drive's app folder (`maillo-settings.json`, invisible in Drive) and applies the newest copy on each device. Column widths, text size, the open side panel and whether notifications are turned on stay per device.

## Updating

**From the browser (PHP hosts).** Open **Settings → Updates**, choose the new release zip and click **Install update**. Maillo:

- checks that the zip is a Maillo release and refuses unexpected files
- keeps your `config.js` and `.htaccess`
- backs up the current version to `.maillo-backup/` (the last three are kept, and the folder is blocked from the web)
- installs the new files and reloads

**Restore previous version** in the same section puts the last backup back.

This needs PHP 7.4 or later with the zip extension, and write permission on the install folder (standard on cPanel hosting). It only works for accounts listed in `allowedAccounts` or `allowedDomains`: the server checks your Google sign-in against your OAuth Client ID before changing anything. If the upload is refused as too large, raise `upload_max_filesize` and `post_max_size` in your host's PHP settings.

**By hand (any host).** Upload the files from a newer release and keep your existing `config.js`. Browsers pick up the new version on the next load.

If you do not want browser updates at all, delete `update.php` from the server.

**Upgrading from 0.6.1 or earlier to 0.6.2 or later.** 0.6.2 adds a server file (`session.php`) that older updaters refuse ("unexpected file"). Upload the new `update.php` from the release zip by hand once, then install the zip from **Settings → Updates**. From then on, the updater accepts new server files a release declares itself.

**Upgrading to 0.4.0.** The browser updater installs 0.4.0 as usual, but it never replaces `.htaccess`. On Apache, upload the new `.htaccess` by hand once (it fixes `config.js` being cached for too long and makes sure `sw.js` and the app manifest are always fresh), or add the same lines to yours.

**Upgrading from Mailmax (0.2.x and earlier).** The app was renamed Maillo in 0.3.0, and the Mailmax updater does not accept a Maillo release. Upload 0.3.0 by hand once:

1. Upload every file from the `maillo-0.3.0` folder, including `.htaccess`, and keep your `config.js`.
2. Delete the old `mailmax-common.php` from the server.
3. Your `config.js` keeps working as is (`window.MAILMAX_CONFIG` is still read). To match new installs, rename it to `window.MAILLO_CONFIG` and set `appName: "Maillo"`.

Your settings in the browser, your private notes and your stored Gemini key carry over on their own. Later versions install from the browser as usual.

**Upgrading from 0.1.0.** Version 0.2.0 added two server files that the 0.1.0 updater does not accept. Upload 0.2.0 or later by hand once, keeping your `config.js`.

## Security notes

- Maillo runs in the browser. Google access tokens are kept in the tab's session storage and are cleared when you sign out or close the tab. The server-side files are `update.php` (updates and logo), `ai.php` (optional Gemini relay) and `session.php` (optional lasting sign-in). They check your Google sign-in and allowed account before doing anything, using `maillo-common.php`. With `staySignedIn`, refresh tokens never reach the browser: they stay encrypted on the server behind an HttpOnly cookie, and `session.php` only answers requests carrying Maillo's own header (so other sites can't use the cookie).
- Conversation headers (sender, subject, snippet) are cached in the browser's local storage so Maillo opens faster; the cache is tied to your account and cleared when you sign out.
- Email content is shown in a sandboxed frame with scripts disabled, and is sanitised before display.
- Remote images are blocked until you allow them, so senders cannot tell when you open a message.
- The content security policy only allows connections to Google's APIs.

## Troubleshooting

| Problem | Fix |
|---|---|
| "This install is not configured yet" | `googleClientId` is empty in `config.js`. |
| "config.js could not be read" | `config.js` is missing or has a syntax error. Open `https://your-address/config.js` to check it: every text value needs straight quotes (`"you@example.com"`, not `you@example.com` or curly quotes), and every line in the list needs its comma. If the file looks right, purge the Cloudflare cache (if you use it) and reload. |
| `redirect_uri_mismatch` or `origin_mismatch` | The address in the browser does not exactly match an authorised JavaScript origin (check `https`, `www`, and the port). |
| `access_denied` | Your account is not a test user (External, Testing) or not in the organisation (Internal). |
| "… is not allowed on this install" | The account is not listed in `allowedAccounts` or `allowedDomains`. |
| Sign-in window does not appear | Allow pop-ups for the site. |
| Notes say they could not be saved or loaded | Enable the Google Drive API, add the `drive.appdata` scope, set `features.notes` to `true`, then sign out and in again. |
| Settings → AI says ai.php is not reachable | The host does not run PHP, or `ai.php` was not uploaded. |
| "Google rejected this key" | Enable the Generative Language API in the key's project, and check the key's API restrictions. |
| Contact photos don't appear | Enable the People API, add the three contacts/directory scopes, set `features.contactPhotos` to `true`, then sign out and in again. Only people with a photo in Contacts or the directory get one. |
| Calendar or Tasks panel is empty | Enable the API in Google Cloud, add the scope, set the feature to `true`, then sign out and in again. |
| No Install button in Settings | The browser doesn't offer one (Safari, Firefox), the site isn't on HTTPS, or Maillo is already installed. Follow the steps shown on the page. |
| Notifications don't appear | Check that the site is allowed to notify in the browser's site settings and in your system's notification settings (macOS: System Settings → Notifications → your browser; Windows: Settings → System → Notifications), and that Focus or Do Not Disturb is off. |
| No chime in the background | Click once anywhere in Maillo after opening it; browsers block sound until then. |
| "Notifications paused" | Your Google session ended while Maillo was in the background. Open it and sign in again. |
| Asked to sign in again every week | External app in Testing mode. Publish it to Production, or use an Internal app on Workspace. |
