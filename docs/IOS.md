# Maillo on iPhone (experimental)

The iOS app is the same Maillo, wrapped with [Capacitor](https://capacitorjs.com) so it runs as a real app on your iPhone or iPad. It's built for one person to install on their own devices through TestFlight. It isn't on the App Store.

How it differs from the web version:

- **No server.** The app files ship inside the app and talk to Google directly. Settings come from `config.native.js` instead of `maillo-config.php`.
- **Stays signed in by itself.** Sign-in opens in the iOS sign-in sheet with an iOS OAuth client (PKCE, no client secret). The refresh token stays in the iOS Keychain, on this device only, and never reaches the web view.
- **Haptics.** Archiving, sending, moving a conversation in or out of a pile, pulling to refresh and swiping a row past its action point tap back through the Taptic Engine. They follow **Settings → Sounds & Haptics → System Haptics** on the iPhone.
- **Not in the app yet:** AI, notifications while closed, and the updater (TestFlight handles updates). Install app and Updates are hidden in Settings.

## What you need

- A Mac with Xcode 26 or later (the app icon is an Icon Composer file, `ios/App/App/AppIcon.icon`).
- An [Apple Developer Program](https://developer.apple.com/programs/) membership, needed for TestFlight.
- Node, and this repo.

## 1. Google Cloud: an iOS OAuth client

In the Google Cloud project you already use for Maillo:

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **iOS**.
2. Bundle ID: `app.maillo.ios` (or your own, see below).
3. Copy the client ID.

The scopes are the same as on the web. With a Google Workspace account and the consent screen's user type set to **Internal**, there's no verification, and sign-in doesn't expire after 7 days.

## 2. Settings

```sh
cp config.native.example.js config.native.js
```

Fill in `config.native.js` (gitignored): the iOS client ID, your account in `allowedAccounts`, and the features you use (`calendar`, `tasks`, `notes`, `stickies`, `contactPhotos`, `syncSettings`), the same as in your web install's `maillo-config.php`. Stickies, notes and synced settings live in Drive, so they're shared with the web. After turning on a feature that adds a Google permission, sign out and in again in the app.

## 3. Signing

```sh
cp ios/local.example.xcconfig ios/local.xcconfig
```

Put your team ID in `ios/local.xcconfig` (gitignored). You'll find it under **Membership details** on the Apple Developer site. This keeps your team ID out of the Xcode project. Don't pick the team in Xcode's Signing tab: that writes it into the project file.

To use another bundle ID, change `appId` in `capacitor.config.json` and `PRODUCT_BUNDLE_IDENTIFIER` in the Xcode project, and use that ID for the OAuth client.

## 4. Build and run

```sh
npm ci
npm run ios        # builds the app files into dist-native and copies them into ios/
npm run ios:open   # opens Xcode
```

To run it on your iPhone over a cable, pick your iPhone as the destination in Xcode and press Run. Run `npm run ios` again after every code change.

## 5. TestFlight

1. In [App Store Connect](https://appstoreconnect.apple.com), **Apps → + → New App**: iOS, any name, bundle ID `app.maillo.ios`.
2. In Xcode, choose **Any iOS Device** as the destination, then **Product → Archive**, then **Distribute App → TestFlight Internal Only**.
3. In App Store Connect → TestFlight, add yourself as an internal tester. Install the **TestFlight** app on your iPhone and accept the invite.

Each upload needs a higher build number: raise **Build** (`CURRENT_PROJECT_VERSION`) in Xcode's General tab. Internal builds skip App Review and expire after 90 days.

## Troubleshooting

- **"Sign-in did not complete"**: check that the OAuth client is the iOS type and that its bundle ID matches the app's exactly.
- **Error 400 `redirect_uri_mismatch` or `invalid_request` from Google**: the client ID in `config.native.js` isn't an iOS client.
- **Blank screen**: run `npm run ios` before building in Xcode. The app files are copied into `ios/App/App/public`, which isn't committed.
