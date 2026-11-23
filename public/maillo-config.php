<?php
/*
 * Maillo settings: the only file you need to fill in.
 *
 * 1. Fill in at least googleClientId and allowedAccounts (or allowedDomains) below.
 * 2. Upload Maillo's files, this one included, to your web server.
 * 3. Open Maillo in your browser. If something is still missing, it shows a checklist.
 *
 * Text goes between the quotes: 'like this'. Lists go between square brackets, one item
 * per quote pair, separated by commas: ['you@example.com', 'someone@example.com'].
 * true / false switch an option on or off. Every line ends with a comma.
 *
 * This file stays on your server. Browsers never see it: they only get the safe settings
 * (name, logo, client ID, language, theme, features, links) through config.php. Secrets in
 * this file (client secret, Gemini key) take priority over any saved from Maillo's Settings.
 * Updates never replace this file. See INSTALL.md for every option.
 */

// Leave this line as it is: it stops the file being opened from a browser.
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) { http_response_code(404); exit; }

return [

    // Name shown in the header and the browser tab. With the default name the header
    // shows the Maillo icon and wordmark; any other name is shown as text.
    'appName' => 'Maillo',

    // Optional logo (web address or path), shown instead of the Maillo icon and name.
    // You can also upload one in Settings > Appearance.
    'logoUrl' => '',
    // Optional text shown after the logo, for example 'Mail'.
    'logoText' => '',
    // SVG logos take the theme colour on their own. For PNG, JPG or WebP logos, this turns
    // a dark single-colour logo white in dark mode.
    'logoInvertDark' => true,

    // Required. The OAuth 2.0 Client ID of type "Web application" from Google Cloud,
    // ending in .apps.googleusercontent.com.
    'googleClientId' => '',

    // Optional. The same client's secret. Only needed to stay signed in (features.staySignedIn).
    // You can also add it later in Settings > Account.
    'googleClientSecret' => '',

    // Required. Who may use this install: full addresses, whole domains, or both.
    'allowedAccounts' => [],    // e.g. ['you@example.com']
    'allowedDomains' => [],     // e.g. ['example.com']

    // 'auto' follows the browser. Available: 'en', 'fr'.
    'language' => 'auto',

    // Default colour theme: sky, teal, pine, iris, plum, coral, tangerine, sunflower, cocoa or steel.
    // People can pick another in Settings > Appearance.
    'theme' => 'sky',

    // Optional colour that replaces the theme's accent, for example '#2B59E8'.
    'accentColor' => '',

    // Optional features. Each Google one adds a permission to the sign-in screen, so
    // everyone signs out and in again once after turning it on.
    'features' => [
        'calendar' => false,        // today's agenda in the side panel (read-only)
        'tasks' => false,           // Tasks side panel and "Add to Tasks"
        'notes' => false,           // private notes on conversations, kept in a hidden
                                    // app folder in Google Drive (needs the Drive API)
        'ai' => false,              // Gemini relay (ai.php). Put the key in geminiApiKey below,
                                    // or add it in Settings > AI
        'contactPhotos' => false,   // photos and contact cards from Google Contacts and, on
                                    // Workspace, your organisation's directory (People API)
        'staySignedIn' => false,    // stay signed in on each device instead of signing in to
                                    // Google every hour (needs googleClientSecret)
        'syncSettings' => false,    // the same Maillo settings on all your devices, through a
                                    // hidden app folder in Google Drive (needs the Drive API)
        'keep' => false,            // Google Keep side panel (Workspace only, needs an admin's
                                    // approval, see INSTALL.md)
    ],

    // Optional. Gemini API key for the AI features, the model to use, and how many AI
    // requests each account may make per day. Leave empty or 0 for the defaults
    // ('gemini-flash-latest', 300 a day).
    'geminiApiKey' => '',
    'aiModel' => '',
    'aiDailyLimit' => 0,

    // Gmail labels used for the two piles at the bottom of the screen. Each is created the
    // first time you use it. Rename them here if you rename them in Gmail.
    'setAsideLabel' => 'Set aside',
    'actionLabel' => 'Action required',

    // Links used by the app switcher and side panels.
    'links' => [
        'chat' => 'https://mail.google.com/chat/',
        'meet' => 'https://meet.google.com/',
        'calendar' => 'https://calendar.google.com/',
        'keep' => 'https://keep.google.com/',
        'contacts' => 'https://contacts.google.com/',
        'gmailSettings' => 'https://mail.google.com/mail/u/0/#settings/general',
    ],

    // Set to true to try the interface with sample data and no Google sign-in.
    'demo' => false,

];
