import Foundation

/// The signed-in member's own summary, from the real backend.
///
/// - `GET /api/athletes/me?id=`           → name (self-or-staff, Bearer JWT)
/// - `GET /api/athletes/summary?athleteId=` → this week's km/runs, week streak (self-or-staff)
protocol ProfileClient: Sendable {
    func summary(athleteId: String, accessToken: String) async -> LoadState<ProfileSummary>
}

struct HTTPProfileClient: ProfileClient {
    let config: AppConfig
    var session: URLSession = .shared

    func summary(athleteId: String, accessToken: String) async -> LoadState<ProfileSummary> {
        async let me = get("api/athletes/me", query: ["id": athleteId], token: accessToken)
        async let sum = get("api/athletes/summary", query: ["athleteId": athleteId], token: accessToken)
        let (meResult, sumResult) = await (me, sum)
        switch (meResult, sumResult) {
        case (.success(let m), .success(let s)):
            guard let parsed = Self.parse(me: m, summary: s) else { return .failed("התשובה מהשרת לא תקינה.") }
            return .loaded(parsed)
        case (.failure(let reason), _), (_, .failure(let reason)):
            return .failed(reason.text)
        }
    }

    /// Pure, so the shape is pinned by tests without a server.
    static func parse(me: [String: Any], summary: [String: Any]) -> ProfileSummary? {
        guard let athlete = me["athlete"] as? [String: Any],
              let name = athlete["name"] as? String else { return nil }
        let week = summary["thisWeek"] as? [String: Any]
        // NSNumber reads 4, 4.0 and 34.6 alike — JSON does not promise which one arrives.
        func number(_ any: Any?) -> Double { (any as? NSNumber)?.doubleValue ?? 0 }
        return ProfileSummary(
            name: name,
            groupLabel: "",
            weekKm: Int(number(week?["km"]).rounded()),
            weekRuns: Int(number(week?["runs"])),
            streakDays: Int(number(summary["weekStreak"])),
            recentWeeksKm: []
        )
    }

    private func get(_ path: String, query: [String: String], token: String) async -> Result<[String: Any], FailureText> {
        var components = URLComponents(url: config.apiBaseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 || status == 403 { return .failure(FailureText("צריך להתחבר מחדש.")) }
            guard (200..<300).contains(status),
                  let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                return .failure(FailureText("משהו השתבש. נסו שוב."))
            }
            return .success(json)
        } catch {
            return .failure(FailureText(Connectivity.isOffline(error) ? Connectivity.offlineMessage : Connectivity.serverUnavailableMessage))
        }
    }
}

/// A user-facing reason, carried through `Result` (which needs an `Error`).
struct FailureText: Error, Sendable { let text: String; init(_ text: String) { self.text = text } }
