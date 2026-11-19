import Foundation

/// Where the app's backend lives, read from Info.plist (filled from ios/Config/*.xcconfig).
///
/// Debug builds default to the local Next.js dev server and never to production while the
/// live pilot is running. A local override goes in the git-ignored Config/Secrets.xcconfig.
struct AppConfig: Sendable {
    let apiBaseURL: URL
    /// Supabase project used only to refresh the session. Nil until configured locally.
    let supabaseURL: URL?
    let supabaseAnonKey: String?

    static let current = AppConfig(info: Bundle.main.infoDictionary ?? [:])

    init(apiBaseURL: URL, supabaseURL: URL?, supabaseAnonKey: String?) {
        self.apiBaseURL = apiBaseURL
        self.supabaseURL = supabaseURL
        self.supabaseAnonKey = supabaseAnonKey
    }

    init(info: [String: Any]) {
        func value(_ key: String) -> String? {
            guard let raw = (info[key] as? String)?.trimmingCharacters(in: .whitespaces),
                  !raw.isEmpty, !raw.hasPrefix("$(") else { return nil }
            return raw
        }
        apiBaseURL = value("MadregotAPIBaseURL").flatMap(URL.init(string:))
            ?? URL(string: "http://localhost:3000")!
        supabaseURL = value("SupabaseURL").flatMap(URL.init(string:))
        supabaseAnonKey = value("SupabaseAnonKey")
    }

    var canRefreshSessions: Bool { supabaseURL != nil && supabaseAnonKey != nil }
}
