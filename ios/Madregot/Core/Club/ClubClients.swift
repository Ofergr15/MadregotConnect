import Foundation

/// The club feed, from the real backend: `GET /api/feed?limit=` (requireMember, Bearer JWT).
/// Only activity items become cards here; posts, badges and announcements come later.
struct HTTPFeedClient: Sendable {
    let config: AppConfig
    var session: URLSession = .shared

    func runs(accessToken: String) async -> LoadState<[FeedRun]> {
        switch await AuthorizedGet(config: config, session: session).json("api/feed", query: ["limit": "30"], token: accessToken) {
        case .failure(let reason): return .failed(reason.text)
        case .success(let json):
            guard let items = json["items"] as? [[String: Any]] else { return .failed("התשובה מהשרת לא תקינה.") }
            let runs = items.compactMap(Self.run)
            return runs.isEmpty ? .empty : .loaded(runs)
        }
    }

    /// Pure, so the shape is pinned by tests without a server.
    static func run(_ item: [String: Any]) -> FeedRun? {
        guard item["type"] as? String == "activity",
              let id = item["id"] as? String,
              let author = item["author"] as? [String: Any],
              let activity = item["activity"] as? [String: Any],
              let meters = jsonNumber(activity["distance"]), meters > 0 else { return nil }
        let name = author["name"] as? String ?? ""
        let seconds = jsonNumber(activity["movingDuration"]) ?? jsonNumber(activity["duration"]) ?? 0
        let pace = jsonNumber(activity["averagePace"]) ?? (seconds > 0 ? seconds / (meters / 1000) : 0)
        return FeedRun(
            id: stableID(id),
            name: name,
            initials: initials(name),
            group: groupNumber(author["groupName"] as? String),
            when: when(activity["startTime"] as? String ?? item["occurredAt"] as? String),
            title: (activity["activityName"] as? String) ?? "ריצה",
            distanceKm: meters / 1000,
            pace: pace > 0 ? clock(pace) : "–",
            durationLabel: seconds > 0 ? clock(seconds) : "–",
            kudos: Int(jsonNumber(item["likeCount"]) ?? 0),
            splits: [],
            itemId: id,
            likedByMe: item["likedByMe"] as? Bool ?? false,
            route: route(activity["routePreview"])
        )
    }

    /// `routePreview` → points; anything malformed or shorter than a line is "no route".
    static func route(_ raw: Any?) -> [RoutePoint] {
        guard let list = raw as? [[String: Any]] else { return [] }
        let points = list.compactMap { p -> RoutePoint? in
            guard let lat = jsonNumber(p["lat"]), let lng = jsonNumber(p["lng"]),
                  (-90...90).contains(lat), (-180...180).contains(lng) else { return nil }
            return RoutePoint(lat: lat, lng: lng)
        }
        return points.count >= 2 ? points : []
    }

    /// "קבוצה 2" → 2. The web's resolveGroup() is the authority; this reads only its label.
    static func groupNumber(_ label: String?) -> Int {
        guard let digit = label?.first(where: \.isNumber), let n = Int(String(digit)), (1...3).contains(n) else { return 3 }
        return n
    }

    static func initials(_ name: String) -> String {
        name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
    }

    /// 242 → "4:02"; 2930 → "48:50"; 6570 → "1:49:30".
    static func clock(_ seconds: Double) -> String {
        let s = Int(seconds.rounded())
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }

    /// start_time is the athlete's wall clock stored UTC-shaped (CLAUDE.md), so it is
    /// formatted in UTC, never shifted into the device's zone.
    static func when(_ iso: String?) -> String {
        guard let iso, let date = isoDate(iso) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "he_IL")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "EEEE, d בMMMM · HH:mm"
        return f.string(from: date)
    }

    private static func isoDate(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    /// FeedRun keeps an Int id for navigation; a stable hash of the server's UUID.
    static func stableID(_ s: String) -> Int {
        var h: UInt64 = 5381
        for b in s.utf8 { h = (h &* 33) &+ UInt64(b) }
        return Int(truncatingIfNeeded: h & 0x7FFF_FFFF_FFFF)
    }
}

/// A clap: `POST /api/feed/like {itemId}` toggles the viewer's like (requireAthlete)
/// and answers the server's truth, `{liked, likeCount}`.
struct HTTPLikeClient: Sendable {
    let config: AppConfig
    var session: URLSession = .shared

    func toggle(itemId: String, accessToken: String) async -> (liked: Bool, count: Int)? {
        var request = URLRequest(url: config.apiBaseURL.appending(path: "api/feed/like"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["itemId": itemId])
        guard let (data, response) = try? await session.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        return Self.parse(json)
    }

    static func parse(_ json: [String: Any]) -> (liked: Bool, count: Int)? {
        guard let liked = json["liked"] as? Bool, let count = jsonNumber(json["likeCount"]) else { return nil }
        return (liked, Int(count))
    }
}

/// Today's workout, from the real backend: `GET /api/dashboard/weekly` (requireMember).
/// A plan day carries only dayOfWeek, and the week served is not always the one the
/// device stands in (it rolls forward Saturday evening), so the day is turned into a
/// date from `currentWeekStart` and compared as a date — never `dayOfWeek == today`.
struct HTTPTodayClient: Sendable {
    let config: AppConfig
    var session: URLSession = .shared

    func today(accessToken: String, now: Date = .now) async -> LoadState<TodayPlanDay> {
        switch await AuthorizedGet(config: config, session: session).json("api/dashboard/weekly", token: accessToken) {
        case .failure(let reason): return .failed(reason.text)
        case .success(let json): return Self.parse(json, now: now)
        }
    }

    /// `hasPlan` is the server's own answer: false = no plan for the week (never "rest"),
    /// true with nothing dated today = a real rest day inside the plan.
    static func parse(_ json: [String: Any], now: Date) -> LoadState<TodayPlanDay> {
        guard json["hasPlan"] as? Bool == true else { return .loaded(.noPlan) }
        guard let weekStart = json["currentWeekStart"] as? String,
              let sessions = json["sessions"] as? [[String: Any]] else { return .failed("התשובה מהשרת לא תקינה.") }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Jerusalem")!
        let f = DateFormatter()
        f.calendar = cal; f.timeZone = cal.timeZone; f.dateFormat = "yyyy-MM-dd"
        guard let start = f.date(from: weekStart) else { return .failed("התשובה מהשרת לא תקינה.") }
        let todayKey = f.string(from: now)
        let todays = sessions.filter { s in
            guard let dow = jsonNumber(s["dayOfWeek"]),
                  let day = cal.date(byAdding: .day, value: Int(dow), to: start) else { return false }
            return f.string(from: day) == todayKey && (s["optional"] as? Bool) != true
        }
        guard let first = todays.first else { return .loaded(.restDay) }
        let km = todays.reduce(0.0) { $0 + (jsonNumber($1["kmMax"]) ?? 0) }
        let blocks = todays.enumerated().map { i, s in
            let lo = jsonNumber(s["kmMin"]) ?? 0, hi = jsonNumber(s["kmMax"]) ?? 0
            let range = lo == hi ? String(format: "%g ק״מ", hi) : String(format: "%g–%g ק״מ", lo, hi)
            return WorkoutBlock(id: i, title: s["name"] as? String ?? "אימון", detail: range, note: nil)
        }
        let dayLabel = { () -> String in
            let d = DateFormatter(); d.locale = Locale(identifier: "he_IL"); d.timeZone = cal.timeZone
            d.dateFormat = "EEEE, d בMMMM"; return d.string(from: now)
        }()
        return .loaded(.workout(TodayWorkout(
            dayLabel: dayLabel,
            title: first["name"] as? String ?? "האימון של היום",
            distanceKm: km,
            pace: "–",
            blocks: blocks,
            coachNote: nil,
            weekDoneKm: 0,
            weekTargetKm: jsonNumber(json["weekTotalMax"]) ?? 0
        )))
    }
}
