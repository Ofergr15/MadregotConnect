import Foundation

/// Whether a stored provider credential still works — the server's `connectionState`
/// (src/lib/providers/health.ts): 'ok' | 'stale' | 'failed' | 'unknown' | 'none'.
enum ConnectionState: String, Sendable, Equatable {
    case ok, stale, failed, unknown, none

    /// Hebrew status line for a provider row.
    var label: String {
        switch self {
        case .ok: "מחובר"
        case .stale: "מחובר, אבל לא סונכרן מזמן"
        case .failed: "צריך להתחבר מחדש"
        case .unknown: "מחובר, ממתין לסנכרון ראשון"
        case .none: "לא מחובר"
        }
    }

    var isConnected: Bool { self != .none }
    var needsAttention: Bool { self == .failed || self == .stale }
}

struct DataSourcesStatus: Equatable, Sendable {
    var garmin: ConnectionState
    var strava: ConnectionState
    var garminLastSync: Date?
    var stravaLastSync: Date?
    /// The member's declared main source ('garmin' / 'strava'), if any.
    var primarySource: String?

    static let empty = DataSourcesStatus(garmin: .none, strava: .none)

    var hasAnySource: Bool { garmin.isConnected || strava.isConnected }
}

enum DataSourcesError: Error, Equatable, Sendable {
    case signedOut
    case network
    case server

    var message: String {
        switch self {
        case .signedOut: "צריך להתחבר מחדש."
        case .network: "אין חיבור לשרת. בדקו את האינטרנט ונסו שוב."
        case .server: "לא הצלחנו לטעון את מצב החיבורים."
        }
    }
}

protocol DataSourcesClient: Sendable {
    func status(athleteId: String, accessToken: String) async throws(DataSourcesError) -> DataSourcesStatus
}

/// `GET /api/athletes/me?id=` — self-or-staff, verified from the Bearer JWT on the
/// server (`requireCallerForAthlete`). Read-only; connecting a provider is a later step.
struct HTTPDataSourcesClient: DataSourcesClient {
    let config: AppConfig
    var session: URLSession = .shared

    func status(athleteId: String, accessToken: String) async throws(DataSourcesError) -> DataSourcesStatus {
        var components = URLComponents(url: config.apiBaseURL.appending(path: "api/athletes/me"),
                                       resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "id", value: athleteId)]
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw .network
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 || status == 403 { throw .signedOut }
        guard status == 200,
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let athlete = json["athlete"] as? [String: Any] else { throw .server }
        return Self.parse(athlete)
    }

    static func parse(_ athlete: [String: Any]) -> DataSourcesStatus {
        func state(_ key: String, fallbackFlag: String) -> ConnectionState {
            if let raw = athlete[key] as? String, let s = ConnectionState(rawValue: raw) { return s }
            // Older servers only had the booleans.
            return (athlete[fallbackFlag] as? Bool) == true ? .unknown : .none
        }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let isoPlain = ISO8601DateFormatter()
        func date(_ key: String) -> Date? {
            guard let raw = athlete[key] as? String else { return nil }
            return iso.date(from: raw) ?? isoPlain.date(from: raw)
        }
        return DataSourcesStatus(
            garmin: state("garminState", fallbackFlag: "hasGarmin"),
            strava: state("stravaState", fallbackFlag: "hasStrava"),
            garminLastSync: date("garminLastSyncAt"),
            stravaLastSync: date("stravaLastSyncAt"),
            primarySource: athlete["data_source"] as? String
        )
    }
}
