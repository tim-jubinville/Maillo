/*
 * Mailmax configuration.
 * Edit this file after uploading. No rebuild is needed.
 * See docs/INSTALL.md for every option.
 */
window.MAILMAX_CONFIG = {
  // Name shown in the header and the browser tab.
  appName: "Mailmax",

  // Optional logo (URL or path), shown instead of the monogram and appName.
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

  // Default colour theme: sky, teal, pine, iris, plum, coral, tangerine, cocoa or steel.
  // People can pick another in Settings > Appearance.
  theme: "sky",

  // Optional hex colour that replaces the theme's accent, for example "#2B59E8".
  accentColor: "",

  // Optional Google features. Each one adds a permission to the sign-in screen.
  features: {
    calendar: false,            // today's agenda in the side panel (read-only)
    tasks: false                // Tasks side panel and "Add to Tasks"
  },

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
