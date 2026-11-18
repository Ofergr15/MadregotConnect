import Foundation

/// Where the app's backend lives.
///
/// M0 makes no network calls at all. The base URL is recorded here so later
/// milestones have one place to change it — and so that a debug build can never
/// silently default to production while the live pilot is running.
enum AppConfig {
    enum Environment: String {
        case local
        case production
    }

    #if DEBUG
    static let environment: Environment = .local
    #else
    static let environment: Environment = .production
    #endif

    static var apiBaseURL: URL {
        switch environment {
        case .local:
            // The Next.js dev server (`npm run dev`). The Simulator reaches the Mac at localhost.
            URL(string: "http://localhost:3000")!
        case .production:
            URL(string: "https://www.madregot.app")!
        }
    }
}
