// Settings for the iOS app (npm run ios). Copy this file to config.native.js (gitignored) and fill it in.
// The app has no PHP server behind it, so this replaces config.php. It's bundled inside the app.
window.MAILLO_CONFIG = {
  appName: 'Maillo',
  // An OAuth client of type "iOS" in Google Cloud, with the same bundle ID as capacitor.config.json (see docs/IOS.md).
  googleClientId: 'YOUR-IOS-CLIENT-ID.apps.googleusercontent.com',
  // Who may sign in. Leave both empty to allow any account.
  allowedAccounts: ['you@example.com'],
  allowedDomains: [],
  language: 'auto',
  theme: 'sky',
  // The same optional features as maillo-config.php on the web; turn on the ones your web install uses.
  // The app always stays signed in. These need a server, so they're off in the app: ai, push, staySignedIn.
  features: { calendar: false, tasks: false, notes: false, stickies: false, contactPhotos: false, syncSettings: false }
};
