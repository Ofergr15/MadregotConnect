import SwiftUI

/// One thing per screen: today's workout, large, with one action at the thumb.
struct TodayWorkout {
    struct Block: Identifiable { let id = UUID(); let title: String; let detail: String }
    let dayLabel: String
    let title: String
    let distanceKm: Double
    let pace: String
    let blocks: [Block]
    let weekDoneKm: Double
    let weekTargetKm: Double

    static let sample = TodayWorkout(
        dayLabel: "יום שלישי · 18 בנובמבר",
        title: "אינטרוולים",
        distanceKm: 12,
        pace: "3:45",
        blocks: [
            .init(title: "חימום", detail: "2 ק״מ קל"),
            .init(title: "6 × 1 ק״מ", detail: "קצב 3:45 · מנוחה 90 שנ׳"),
            .init(title: "שחרור", detail: "2 ק״מ קל"),
        ],
        weekDoneKm: 34, weekTargetKm: 60
    )
}

struct TodayView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        NavigationStack {
            if session.isDemo {
                TodayContent(workout: .sample)
            } else {
                ContentUnavailableView("האימון של היום", systemImage: "calendar",
                                       description: Text("כאן יופיע האימון מהתוכנית השבועית."))
            }
        }
    }
}

struct TodayContent: View {
    let workout: TodayWorkout

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(workout.dayLabel).font(.subheadline).foregroundStyle(.secondary)
                        Text(workout.title).font(.system(size: 40, weight: .bold, design: .rounded))
                    }

                    HStack(spacing: 32) {
                        metric(String(format: "%g", workout.distanceKm), unit: "ק״מ")
                        metric(workout.pace, unit: "לק״מ")
                    }

                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(workout.blocks) { block in
                            HStack(alignment: .firstTextBaseline, spacing: 14) {
                                Circle().fill(Theme.accent).frame(width: 8, height: 8)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(block.title).font(.headline)
                                    Text(block.detail).font(.subheadline).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    .card()

                    weekProgress
                }
                .padding(.horizontal, Theme.gutter)
                .padding(.top, 24)
            }

            Button {} label: {
                Text("שליחה לשעון").font(.headline).frame(maxWidth: .infinity, minHeight: 56)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
            .buttonBorderShape(.capsule)
            .padding(Theme.gutter)
        }
    }

    private func metric(_ value: String, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.system(size: 52, weight: .semibold, design: .rounded)).monospacedDigit()
            Text(unit).font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var weekProgress: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("השבוע").font(.subheadline.bold())
                Spacer()
                Text("\(Int(workout.weekDoneKm)) מתוך \(Int(workout.weekTargetKm)) ק״מ")
                    .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
            }
            ProgressView(value: workout.weekDoneKm, total: workout.weekTargetKm).tint(Theme.accent)
        }
    }
}

#Preview {
    TodayContent(workout: .sample).environment(\.layoutDirection, .rightToLeft)
}
