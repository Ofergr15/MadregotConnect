import SwiftUI

@main
struct MadregotApp: App {
    @State private var session = SessionStore.forLaunch()
    @State private var demo = DemoSettings()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(demo)
                // Hebrew-first: the app is right-to-left regardless of the device language.
                // An English mode (the web app's `en` locale) comes later and will lift this.
                .environment(\.layoutDirection, .rightToLeft)
                .environment(\.locale, Locale(identifier: "he_IL"))
                .tint(Theme.accent)
                .task { await session.restore() }
        }
    }
}

extension SessionStore {
    /// Debug only: `-simulateAuthError offline|server|config` makes every sign-in call fail that
    /// way, so the real sign-in screen's error states can be reviewed without cutting the Mac's
    /// network. Release builds always get the real client.
    static func forLaunch() -> SessionStore {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-simulateAuthError"), i + 1 < args.count {
            let error: AuthError = switch args[i + 1] {
            case "offline": .network
            case "config": .notConfigured
            default: .serverUnavailable
            }
            return SessionStore(client: FailingAuthClient(error: error), tokens: InMemoryTokenStore())
        }
        #endif
        return SessionStore()
    }
}

#if DEBUG
private struct FailingAuthClient: AuthClient {
    let error: AuthError
    func sendCode(to email: String) async throws(AuthError) { throw error }
    func verifyCode(_ code: String, email: String) async throws(AuthError) -> IssuedSession { throw error }
    func refresh(refreshToken: String) async throws(AuthError) -> IssuedSession { throw error }
}
#endif
