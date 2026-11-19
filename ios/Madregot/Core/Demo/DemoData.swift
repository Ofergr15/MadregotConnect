import Foundation

// Made-up club content for demo mode. Names, numbers and runs are fictional.

struct WorkoutBlock: Identifiable, Hashable, Sendable {
    let id: Int
    let title: String
    let detail: String
    let note: String?
}

struct TodayWorkout: Equatable, Sendable {
    let dayLabel: String
    let title: String
    let distanceKm: Double
    let pace: String
    let blocks: [WorkoutBlock]
    let coachNote: String?
    let weekDoneKm: Double
    let weekTargetKm: Double
}

struct FeedRun: Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    let initials: String
    let group: Int            // 1 fast · 2 medium · 3 slow
    let when: String
    let title: String
    let distanceKm: Double
    let pace: String
    let durationLabel: String
    let kudos: Int
    let splits: [String]
    /// The server's feed item id (nil for demo runs) — what a clap is sent against.
    var itemId: String? = nil
    var likedByMe = false
    /// The run's route as the feed sends it (`routePreview`, up to 300 points). Empty =
    /// no route for this run: the card shows none rather than inventing a shape.
    var route: [RoutePoint] = []
}

struct RoutePoint: Hashable, Sendable {
    let lat: Double
    let lng: Double
}

/// What the plan says about today. "No plan" is not "rest": an athlete with no weekly
/// plan must not be told to rest.
enum TodayPlanDay: Sendable {
    case workout(TodayWorkout)
    case restDay
    case noPlan
}

struct ProfileSummary: Equatable, Sendable {
    let name: String
    let groupLabel: String
    let weekKm: Int
    let weekRuns: Int
    let streakDays: Int
    let recentWeeksKm: [Int]  // oldest → newest
}

/// The one place demo content comes from. `scenario` decides which LoadState each
/// screen gets, so empty/error/loading can be shown on purpose.
struct DemoContent: Sendable {
    var scenario: DemoScenario = .normal

    func today() async -> LoadState<TodayWorkout> { await resolve(Self.workout) }
    func feed() async -> LoadState<[FeedRun]> { await resolve(Self.runs) }
    func profile() async -> LoadState<ProfileSummary> { await resolve(Self.summary) }

    private func resolve<T: Sendable>(_ value: T) async -> LoadState<T> {
        switch scenario {
        case .normal: return .loaded(value)
        case .empty: return .empty
        case .failing: return .failed("לא הצלחנו לטעון. נסו שוב.")
        case .slow:
            try? await Task.sleep(for: .seconds(2))
            return .loaded(value)
        }
    }

    static let workout = TodayWorkout(
        dayLabel: "יום שלישי · 18 בנובמבר",
        title: "אינטרוולים",
        distanceKm: 12,
        pace: "3:45",
        blocks: [
            .init(id: 0, title: "חימום", detail: "2 ק״מ קל", note: "קצב שיחה, בלי לחץ."),
            .init(id: 1, title: "6 × 1 ק״מ", detail: "קצב 3:45 · מנוחה 90 שנ׳", note: "מנוחה בעמידה או בהליכה."),
            .init(id: 2, title: "שחרור", detail: "2 ק״מ קל", note: nil),
        ],
        coachNote: "שומרים על קצב אחיד בכל החזרות. עדיף לסיים חזק מאשר לפתוח מהר.",
        weekDoneKm: 34, weekTargetKm: 60
    )

    static let runs: [FeedRun] = [
        .init(id: 1, name: "נועה לוי", initials: "נל", group: 1, when: "לפני שעה", title: "אינטרוולים \u{2066}6×1\u{2069} ק״מ",
              distanceKm: 12.1, pace: "4:02", durationLabel: "48:50", kudos: 8,
              splits: ["5:10", "5:05", "3:44", "3:46", "3:43", "3:45", "3:47", "3:44", "5:20", "5:25", "5:30", "5:15"]),
        .init(id: 2, name: "איתי כהן", initials: "אכ", group: 2, when: "לפני 3 שעות", title: "ריצה קלה",
              distanceKm: 8.4, pace: "5:31", durationLabel: "46:22", kudos: 3,
              splits: ["5:35", "5:30", "5:28", "5:33", "5:30", "5:29", "5:34", "5:31"]),
        .init(id: 3, name: "מיכל ברק", initials: "מב", group: 3, when: "הבוקר", title: "ריצה ארוכה",
              distanceKm: 18.0, pace: "6:05", durationLabel: "1:49:30", kudos: 12,
              splits: Array(repeating: "6:05", count: 18)),
        .init(id: 4, name: "דני שמש", initials: "דש", group: 1, when: "אתמול", title: "טמפו 10 ק״מ",
              distanceKm: 14.2, pace: "3:58", durationLabel: "56:24", kudos: 6,
              splits: ["5:00", "5:00", "3:40", "3:41", "3:39", "3:40", "3:42", "3:40", "3:41", "3:39", "3:40", "3:41", "5:10", "5:05"]),
    ]

    static let summary = ProfileSummary(
        name: "אופיר (הדגמה)", groupLabel: "קבוצה 1",
        weekKm: 34, weekRuns: 4, streakDays: 12,
        recentWeeksKm: [52, 61, 58, 64, 49, 34]
    )
}
