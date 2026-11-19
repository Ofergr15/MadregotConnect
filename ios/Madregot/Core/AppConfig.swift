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
    /// The U21 Personal Coach registration flow (the web /u21 page). Configurable so dev
    /// can point at a local or preview server and release at the live site.
    var u21URL: URL

    static let current = AppConfig(info: Bundle.main.infoDictionary ?? [:])

    init(apiBaseURL: URL, supabaseURL: URL?, supabaseAnonKey: String?) {
        self.apiBaseURL = apiBaseURL
        self.supabaseURL = supabaseURL
        self.supabaseAnonKey = supabaseAnonKey
        self.u21URL = apiBaseURL.appending(path: "u21")
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
        u21URL = value("MadregotU21URL").flatMap(URL.init(string:)) ?? apiBaseURL.appending(path: "u21")
    }

    var canRefreshSessions: Bool { supabaseURL != nil && supabaseAnonKey != nil }
}
