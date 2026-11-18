# Installing Mailmax

Mailmax is a static website. You need:

- A web server or static host that serves files over **HTTPS** (Google sign-in requires it)
- An address for it, such as `https://mail.example.com`
- A Google account with Gmail, and access to [Google Cloud Console](https://console.cloud.google.com/)

The setup takes about 20 minutes.

---

## 1. Create a Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/) and sign in with the account that will own the project.
2. Create a new project (any name, such as "Mailmax").
3. Go to **APIs & Services → Library** and enable:
   - **Gmail API** (required)
   - **Google Calendar API** (only if you turn on the calendar panel)
   - **Google Tasks API** (only if you turn on the tasks panel)

## 2. Configure the consent screen

Go to **APIs & Services → OAuth consent screen** (called **Google Auth Platform** in newer consoles).

**User type**

- **Internal** (Google Workspace accounts only). Only accounts in your organisation can sign in. There is no app verification and no 7-day sign-out. Choose this if your mailbox is on Google Workspace.
- **External** (personal @gmail.com accounts). Add your own address under **Test users**. While the app is in **Testing**, Google signs you out of Mailmax after 7 days. Mailmax works fully in the browser, so this only means signing in again when asked. You can also publish the app to **Production** without completing verification; Google then shows a "Google hasn't verified this app" warning at sign-in that you can click through.

**App information**: any app name and your support email.

**Scopes** (also called Data Access). Add:

| Scope | Why |
|---|---|
| `https://www.googleapis.com/auth/gmail.modify` | Read, label, archive, delete, send mail and manage drafts |
| `https://www.googleapis.com/auth/gmail.settings.basic` | Filters, signatures, vacation responder, forwarding status |
| `https://www.googleapis.com/auth/calendar.events.readonly` | Optional: today's agenda |
| `https://www.googleapis.com/auth/tasks` | Optional: Tasks panel and "Add to Tasks" |

## 3. Create the OAuth Client ID

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Under **Authorised JavaScript origins**, add the exact address of your install, with no trailing slash, for example `https://mail.example.com`.
4. No redirect URI is needed.
5. Create it and copy the **Client ID** (it ends in `.apps.googleusercontent.com`). There is no client secret to keep: Mailmax does not use one.

## 4. Upload the files

Unzip the release and upload the contents of the `mailmax-x.y.z` folder to the folder your address points to. It should look like this:

```
index.html
config.js
.htaccess
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
location = /config.js { add_header Cache-Control no-cache; }
```

**Static hosts** (Cloudflare Pages, Netlify, GitHub Pages, and others). Upload the folder as the site root.

Mailmax can also live in a sub-folder (for example `https://example.com/mail/`). The authorised origin is still just `https://example.com`.

## 5. Edit config.js

Open `config.js` on the server and set at least `googleClientId`:

```js
window.MAILMAX_CONFIG = {
  appName: "Mailmax",
  logoUrl: "",
  logoText: "",
  logoInvertDark: true,
  googleClientId: "1234567890-abc123.apps.googleusercontent.com",
  allowedAccounts: ["you@example.com"],
  allowedDomains: [],
  language: "auto",
  theme: "sky",
  accentColor: "",
  features: { calendar: false, tasks: false },
  links: { /* see below */ },
  demo: false
};
```

| Option | What it does |
|---|---|
| `appName` | Name in the browser tab, and in the header when there is no logo (shown next to a monogram of its first letter). |
| `logoUrl` | Optional logo image (path or URL), shown in the header instead of the monogram and name. A logo uploaded in **Settings → Appearance** takes priority. |
| `logoText` | Optional text shown after the logo, such as `"Mail"`. Empty (the default) shows the logo alone. |
| `logoInvertDark` | SVG logos are recoloured to match the theme automatically. For PNG, JPG or WebP logos, `true` turns a dark single-colour logo white in dark mode. |
| `googleClientId` | Required. The Client ID from step 3. |
| `allowedAccounts` | Email addresses allowed to use this install. Anyone else is signed out right away. |
| `allowedDomains` | Domains allowed to use this install, such as `"example.com"`. |
| `language` | `"auto"`, `"en"` or `"fr"`. People can also change it in Settings. |
| `theme` | Default colour theme: `sky`, `teal`, `pine`, `iris`, `plum`, `coral`, `tangerine`, `cocoa` or `steel`. Each person can pick their own in Settings → Appearance, along with light, dark or system mode. |
| `accentColor` | Optional hex colour that replaces the default theme's accent. |
| `features.calendar` | Shows today's events in the side panel. Adds the Calendar permission at sign-in. |
| `features.tasks` | Shows Google Tasks in the side panel and an "Add to Tasks" button. Adds the Tasks permission. |
| `links` | Addresses opened by Chat, Meet, Calendar, Keep, Contacts and Gmail settings. Change them if you use a different Google account index (`/u/1/`) or other apps. |
| `demo` | `true` shows sample data and never contacts Google. |

Leave `allowedAccounts` and `allowedDomains` empty only if Google's consent screen already limits who can sign in (Internal user type, or Testing with a test-user list).

Changes to `config.js` take effect on the next page load. No rebuild is needed.

## 6. Sign in

Open your address and click **Continue with Google**. Allow pop-ups for the site if the browser blocks the sign-in window.

---

## Optional: put a login wall in front

Mailmax only shows mail after a Google sign-in, but you can also hide the site itself from the public. A common option is **Cloudflare Access** (free for small teams):

1. Move your domain's DNS to Cloudflare (or add the subdomain to a Cloudflare zone) with the proxy turned on. Copy every existing DNS record first, especially mail (MX, SPF, DKIM) records, so email keeps working.
2. In **Zero Trust → Access → Applications**, add a self-hosted application for your Mailmax address.
3. Add a policy that allows only your email address. Choose Google as the login method if you want one Google sign-in for both.

Other options: HTTP basic authentication on your web server, or a VPN.

## Updating

**From the browser (PHP hosts).** Open **Settings → Updates**, choose the new release zip and click **Install update**. Mailmax:

- checks that the zip is a Mailmax release and refuses unexpected files
- keeps your `config.js` and `.htaccess`
- backs up the current version to `.mailmax-backup/` (the last three are kept, and the folder is blocked from the web)
- installs the new files and reloads

**Restore previous version** in the same section puts the last backup back.

This needs PHP 7.4 or later with the zip extension, and write permission on the install folder (standard on cPanel hosting). It only works for accounts listed in `allowedAccounts` or `allowedDomains`: the server checks your Google sign-in against your OAuth Client ID before changing anything. If the upload is refused as too large, raise `upload_max_filesize` and `post_max_size` in your host's PHP settings.

**By hand (any host).** Upload the files from a newer release and keep your existing `config.js`. Browsers pick up the new version on the next load.

If you do not want browser updates at all, delete `update.php` from the server.

## Security notes

- Mailmax runs in the browser. Google access tokens are kept in the tab's session storage and are cleared when you sign out or close the tab. The only server-side file is `update.php`, which verifies your Google sign-in and allowed account before installing an update.
- Email content is shown in a sandboxed frame with scripts disabled, and is sanitised before display.
- Remote images are blocked until you allow them, so senders cannot tell when you open a message.
- The content security policy only allows connections to Google's APIs.

## Troubleshooting

| Problem | Fix |
|---|---|
| "This install is not configured yet" | `googleClientId` is empty in `config.js`. |
| `redirect_uri_mismatch` or `origin_mismatch` | The address in the browser does not exactly match an authorised JavaScript origin (check `https`, `www`, and the port). |
| `access_denied` | Your account is not a test user (External, Testing) or not in the organisation (Internal). |
| "… is not allowed on this install" | The account is not listed in `allowedAccounts` or `allowedDomains`. |
| Sign-in window does not appear | Allow pop-ups for the site. |
| Calendar or Tasks panel is empty | Enable the API in Google Cloud, add the scope, set the feature to `true`, then sign out and in again. |
| Asked to sign in again every week | External app in Testing mode. Publish it to Production, or use an Internal app on Workspace. |
