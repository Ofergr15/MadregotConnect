import Testing
@testable import Madregot

@MainActor
struct SessionStoreTests {
    @Test func startsSignedOut() {
        #expect(SessionStore().state == .signedOut)
    }

    @Test func demoModeThenSignOut() {
        let store = SessionStore()
        store.enterDemoMode()
        #expect(store.state == .signedIn)
        store.signOut()
        #expect(store.state == .signedOut)
    }
}

struct AppConfigTests {
    /// While the pilot runs on production, a debug build must never point there by default.
    @Test func debugBuildDoesNotTargetProduction() {
        #if DEBUG
        #expect(AppConfig.environment == .local)
        #expect(AppConfig.apiBaseURL.host() == "localhost")
        #endif
    }
}
