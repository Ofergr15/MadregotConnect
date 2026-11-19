import SwiftUI

/// A calm list of club runs: who, what, and the one number that matters. No clutter.
struct FeedRun: Identifiable {
    let id = UUID()
    let name: String
    let initials: String
    let group: Int            // 1 fast · 2 medium · 3 slow
    let when: String
    let title: String
    let distanceKm: Double
    let pace: String
    let kudos: Int

    static let samples: [FeedRun] = [
        .init(name: "נועה לוי", initials: "נל", group: 1, when: "לפני שעה", title: "אינטרוולים \u{2066}6×1\u{2069} ק״מ", distanceKm: 12.1, pace: "4:02", kudos: 8),
        .init(name: "איתי כהן", initials: "אכ", group: 2, when: "לפני 3 שעות", title: "ריצה קלה", distanceKm: 8.4, pace: "5:31", kudos: 3),
        .init(name: "מיכל ברק", initials: "מב", group: 3, when: "הבוקר", title: "ריצה ארוכה", distanceKm: 18.0, pace: "6:05", kudos: 12),
        .init(name: "דני שמש", initials: "דש", group: 1, when: "אתמול", title: "טמפו 10 ק״מ", distanceKm: 14.2, pace: "3:58", kudos: 6),
    ]
}

struct FeedView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        NavigationStack {
            Group {
                if session.isDemo {
                    ScrollView {
                        LazyVStack(spacing: 14) {
                            ForEach(FeedRun.samples) { FeedCard(run: $0) }
                        }
                        .padding(Theme.gutter)
                    }
                } else {
                    ContentUnavailableView("הפיד", systemImage: "list.bullet.rectangle",
                                           description: Text("כאן יופיעו הריצות של חברי המועדון."))
                }
            }
            .navigationTitle("פיד")
        }
    }
}

struct FeedCard: View {
    let run: FeedRun
    @State private var liked = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Text(run.initials)
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Theme.groupColor(run.group), in: .circle)
                VStack(alignment: .leading, spacing: 2) {
                    Text(run.name).font(.headline)
                    Text(run.when).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }

            Text(run.title).font(.title3.weight(.semibold))

            HStack(alignment: .lastTextBaseline, spacing: 28) {
                stat(String(format: "%.1f", run.distanceKm), "ק״מ")
                stat(run.pace, "לק״מ")
                Spacer()
                Button {
                    liked.toggle()
                } label: {
                    Label("\(run.kudos + (liked ? 1 : 0))", systemImage: liked ? "hands.clap.fill" : "hands.clap")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(liked ? Theme.accent : .secondary)
                }
                .buttonStyle(.plain)
                .sensoryFeedback(.selection, trigger: liked)
            }
        }
        .card()
    }

    private func stat(_ value: String, _ unit: String) -> some View {
        HStack(alignment: .lastTextBaseline, spacing: 4) {
            Text(value).font(.system(size: 28, weight: .semibold, design: .rounded)).monospacedDigit()
            Text(unit).font(.caption).foregroundStyle(.secondary)
        }
    }
}
