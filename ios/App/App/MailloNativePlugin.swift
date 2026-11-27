import AuthenticationServices
import Capacitor
import Foundation
import Security
import UIKit
import UserNotifications

/// Maillo's web view, with Maillo's own plugin registered.
class MailloViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MailloNativePlugin())
    }
}

/// Google sign-in for the iOS app (src/native.ts): the system sign-in sheet, PKCE with the iOS OAuth client
/// (no secret), and the refresh token kept in the Keychain. The refresh token never goes to the web view.
@objc(MailloNativePlugin)
public class MailloNativePlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding, NotificationHandlerProtocol {
    public let identifier = "MailloNativePlugin"
    public let jsName = "MailloNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exchange", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "refresh", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "registerPush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise)
    ]

    private var authSession: ASWebAuthenticationSession?
    private let refreshKey = "google.refresh"
    private let tokenURL = URL(string: "https://oauth2.googleapis.com/token")!
    private let revokeURL = URL(string: "https://oauth2.googleapis.com/revoke")!

    // MARK: Sign-in sheet

    @objc func authorize(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https", url.host == "accounts.google.com",
              let scheme = call.getString("callbackScheme"), !scheme.isEmpty else {
            call.reject("auth_failed")
            return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, error in
                self?.authSession = nil
                if let callback = callback {
                    call.resolve(["url": callback.absoluteString])
                } else if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
                    call.reject("cancelled")
                } else {
                    call.reject("auth_failed")
                }
            }
            session.presentationContextProvider = self
            self.authSession = session
            if !session.start() {
                self.authSession = nil
                call.reject("auth_failed")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    // MARK: Notifications (src/push.ts): the device token for push.php, taps, and the icon badge

    private var pushCalls: [CAPPluginCall] = []

    override public func load() {
        bridge?.notificationRouter.pushNotificationHandler = self
        NotificationCenter.default.addObserver(self, selector: #selector(didRegisterForPush(_:)), name: .capacitorDidRegisterForRemoteNotifications, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(didFailToRegisterForPush(_:)), name: .capacitorDidFailToRegisterForRemoteNotifications, object: nil)
    }

    /// Resolves with this device's APNs token. With ask false, never shows the permission prompt (for refreshing at launch).
    @objc func registerPush(_ call: CAPPluginCall) {
        let ask = call.getBool("ask") ?? true
        let center = UNUserNotificationCenter.current()
        let register = {
            DispatchQueue.main.async {
                self.pushCalls.append(call)
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                register()
            case .notDetermined where ask:
                center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                    if granted { register() } else { call.reject("permission") }
                }
            default:
                call.reject("permission")
            }
        }
    }

    @objc private func didRegisterForPush(_ note: Notification) {
        guard let token = note.object as? Data else { return }
        // Debug builds (Xcode) get sandbox tokens; archives for TestFlight get production ones.
        #if DEBUG
        let env = "sandbox"
        #else
        let env = "production"
        #endif
        let hex = token.map { String(format: "%02x", $0) }.joined()
        pushCalls.forEach { $0.resolve(["token": hex, "env": env]) }
        pushCalls.removeAll()
    }

    @objc private func didFailToRegisterForPush(_ note: Notification) {
        pushCalls.forEach { $0.reject("register_failed") }
        pushCalls.removeAll()
    }

    @objc func setBadge(_ call: CAPPluginCall) {
        let count = max(0, call.getInt("count") ?? 0)
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(count)
            } else {
                UIApplication.shared.applicationIconBadgeNumber = count
            }
            call.resolve()
        }
    }

    /// While Maillo is open it shows new mail itself, so pushed banners stay quiet; the badge still updates.
    public func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        return [.badge]
    }

    /// A tapped notification opens its conversation. Kept until the web view listens, for taps that launch the app.
    public func didReceive(response: UNNotificationResponse) {
        let threadId = response.notification.request.content.userInfo["threadId"] as? String ?? ""
        notifyListeners("notificationTap", data: ["threadId": threadId], retainUntilConsumed: true)
    }

    // MARK: Haptics

    /// A tap from the Taptic Engine (src/haptics.ts). iOS skips it by itself when System Haptics is off.
    @objc func haptic(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "light"
        DispatchQueue.main.async {
            switch kind {
            case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case "selection": UISelectionFeedbackGenerator().selectionChanged()
            case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            case "soft": UIImpactFeedbackGenerator(style: .soft).impactOccurred()
            default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
            call.resolve()
        }
    }

    // MARK: Tokens

    @objc func exchange(_ call: CAPPluginCall) {
        guard let clientId = call.getString("clientId"), let code = call.getString("code"),
              let verifier = call.getString("verifier"), let redirectUri = call.getString("redirectUri") else {
            call.reject("auth_failed")
            return
        }
        post(tokenURL, [
            "client_id": clientId,
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": redirectUri
        ]) { [weak self] status, json in
            guard let self = self else { return }
            guard status == 200, let access = json?["access_token"] as? String else {
                call.reject(status == 0 ? "network" : "auth_failed")
                return
            }
            if let refresh = json?["refresh_token"] as? String { self.keychainSet(refresh) }
            call.resolve(["access_token": access, "expires_in": Self.expiresIn(json)])
        }
    }

    @objc func refresh(_ call: CAPPluginCall) {
        guard let clientId = call.getString("clientId") else {
            call.reject("auth_failed")
            return
        }
        guard let refresh = keychainGet() else {
            call.reject("no_session")
            return
        }
        post(tokenURL, ["client_id": clientId, "refresh_token": refresh, "grant_type": "refresh_token"]) { [weak self] status, json in
            if status == 200, let access = json?["access_token"] as? String {
                call.resolve(["access_token": access, "expires_in": Self.expiresIn(json)])
                return
            }
            // Revoked, expired or for another client: this sign-in is over.
            let error = json?["error"] as? String ?? ""
            if status == 400 || status == 401, ["invalid_grant", "invalid_client", "unauthorized_client"].contains(error) {
                self?.keychainRemove()
                call.reject("ended")
            } else {
                call.reject("network")
            }
        }
    }

    @objc func hasSession(_ call: CAPPluginCall) {
        call.resolve(["value": keychainGet() != nil])
    }

    @objc func signOut(_ call: CAPPluginCall) {
        let refresh = keychainGet()
        keychainRemove()
        // Revoking ends Google's whole grant (every device), so only "sign out everywhere" does it.
        guard let token = refresh, call.getBool("revoke") ?? false else {
            call.resolve()
            return
        }
        post(revokeURL, ["token": token]) { _, _ in call.resolve() }
    }

    private static func expiresIn(_ json: [String: Any]?) -> Int {
        if let n = json?["expires_in"] as? Int { return n }
        if let d = json?["expires_in"] as? Double { return Int(d) }
        return 3600
    }

    /// POSTs a form; status 0 means no answer (offline).
    private func post(_ url: URL, _ form: [String: String], done: @escaping (Int, [String: Any]?) -> Void) {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        let body = form.map { key, value in
            "\(key.addingPercentEncoding(withAllowedCharacters: allowed) ?? key)=\(value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")"
        }.joined(separator: "&")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(body.utf8)
        request.timeoutInterval = 30
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            done(status, json)
        }.resume()
    }

    // MARK: Keychain

    private var keychainQuery: [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "maillo") + ".google",
            kSecAttrAccount as String: refreshKey
        ]
    }

    private func keychainGet() -> String? {
        var query = keychainQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func keychainSet(_ value: String) {
        keychainRemove()
        var query = keychainQuery
        query[kSecValueData as String] = Data(value.utf8)
        // Readable once the phone has been unlocked after a restart; never synced or restored to another device.
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    private func keychainRemove() {
        SecItemDelete(keychainQuery as CFDictionary)
    }
}
