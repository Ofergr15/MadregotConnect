import Foundation
import Testing
@testable import Madregot

struct AppConfigTests {
    /// While the pilot runs on production, a debug build must never point there by default.
    @Test func debugBuildDoesNotTargetProduction() {
        #if DEBUG
        let host = AppConfig.current.apiBaseURL.host()
        #expect(host != "www.madregot.app")
        #expect(host != "madregot.app")
        #endif
    }

    @Test func unresolvedPlaceholdersCountAsMissing() {
        let config = AppConfig(info: [
            "MadregotAPIBaseURL": "$(MADREGOT_API_BASE_URL)",
            "SupabaseURL": "",
            "SupabaseAnonKey": "$(SUPABASE_ANON_KEY)",
        ])
        #expect(config.apiBaseURL.absoluteString == "http://localhost:3000")
        #expect(config.supabaseURL == nil)
        #expect(!config.canRefreshSessions)
    }
}
