/*
 * Maillo configuration.
 * Edit this file after uploading. No rebuild is needed.
 * See docs/INSTALL.md for every option.
 */
window.MAILLO_CONFIG = {
  // Name shown in the header and the browser tab. With the default name the
  // header shows the Maillo icon and wordmark; any other name is shown as text.
  appName: "Maillo",

  // Optional logo (URL or path), shown instead of the Maillo icon and appName.
  // You can also upload one in Settings > Appearance.
  logoUrl: "",
  // Optional text shown after the logo, for example "Mail".
  logoText: "",
  // SVG logos take the theme colour automatically. For PNG, JPG or WebP logos,
  // this turns a dark single-colour logo white in dark mode.
  logoInvertDark: true,

  // Required: OAuth 2.0 Client ID of type "Web application" from Google Cloud.
  googleClientId: "",

  // Who may use this install. Leave both empty to allow any Google account
  // that your OAuth client accepts.
  allowedAccounts: [],          // e.g. ["you@example.com"]
  allowedDomains: [],           // e.g. ["example.com"]

  // "auto" follows the browser. Available: "en", "fr".
  language: "auto",

  // Default colour theme: sky, teal, pine, iris, plum, coral, tangerine, sunflower, cocoa or steel.
  // People can pick another in Settings > Appearance.
  theme: "sky",

  // Optional hex colour that replaces the theme's accent, for example "#2B59E8".
  accentColor: "",

  // Optional Google features. Each one adds a permission to the sign-in screen.
  features: {
    calendar: false,            // today's agenda in the side panel (read-only)
    tasks: false,               // Tasks side panel and "Add to Tasks"
    notes: false,               // private sticky notes on conversations, synced through
                                // a hidden app folder in Google Drive (needs the Drive API)
    ai: false,                  // Gemini relay (ai.php, PHP hosts). Add the API key in
                                // Settings > AI; it is stored on the server, never here.
    contactPhotos: false,       // senders' photos from Google Contacts, "other contacts" and,
                                // on Workspace, your organisation's directory (read-only;
                                // needs the People API)
    staySignedIn: false,        // stay signed in on each device instead of a new Google sign-in
                                // every hour (session.php, PHP hosts). Add the OAuth client
                                // secret in Settings > Account; it is stored on the server.
    syncSettings: false,        // keep Maillo's settings the same on all your devices, through
                                // a hidden app folder in Google Drive (needs the Drive API)
    keep: false                 // Google Keep side panel (Workspace only: needs the Keep API and an
                                // admin to allow it, see INSTALL.md). Without it, Keep is hidden.
  },

  // Gemini model used by the AI relay, and how many AI requests each account may
  // make per day. Leave empty or 0 for the defaults.
  aiModel: "",                  // default "gemini-flash-latest"
  aiDailyLimit: 0,              // default 300

  // Gmail labels used for the two piles at the bottom of the screen. Each is
  // created the first time you use it. Rename them here if you rename them in Gmail.
  setAsideLabel: "Set aside",
  actionLabel: "Action required",

  // Links used by the app switcher and side panels.
  links: {
    chat: "https://mail.google.com/chat/",
    meet: "https://meet.google.com/",
    calendar: "https://calendar.google.com/",
    keep: "https://keep.google.com/",
    contacts: "https://contacts.google.com/",
    gmailSettings: "https://mail.google.com/mail/u/0/#settings/general"
  },

  // Set to true to try the interface with sample data and no Google sign-in.
  demo: false
};
