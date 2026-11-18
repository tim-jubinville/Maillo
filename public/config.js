/*
 * Mailmax configuration.
 * Edit this file after uploading. No rebuild is needed.
 * See docs/INSTALL.md for every option.
 */
window.MAILMAX_CONFIG = {
  // Name shown in the header and the browser tab.
  appName: "Mailmax",

  // Optional square logo (URL or path). Leave empty to use a monogram of appName.
  logoUrl: "",

  // Required: OAuth 2.0 Client ID of type "Web application" from Google Cloud.
  googleClientId: "",

  // Who may use this install. Leave both empty to allow any Google account
  // that your OAuth client accepts.
  allowedAccounts: [],          // e.g. ["you@example.com"]
  allowedDomains: [],           // e.g. ["example.com"]

  // "auto" follows the browser. Available: "en", "fr".
  language: "auto",

  // Main colour for buttons and highlights.
  accentColor: "#14213D",

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
