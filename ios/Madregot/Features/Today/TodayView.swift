import SwiftUI

/// One thing per screen: today's workout, large, with one action at the thumb.
struct TodayView: View {
    @Environment(SessionStore.self) private var session
    @Environment(DemoSettings.self) private var demo
    @State private var state: LoadState<TodayWorkout> = .loading

    var body: some View {
        NavigationStack {
            Group {
                if session.isDemo {
                    StateView(state: state, emptyTitle: "יום מנוחה", emptyIcon: "moon.zzz",
                              emptyMessage: "אין אימון מתוכנן להיום. מנוחה היא חלק מהאימון.",
                              retry: load) { TodayContent(workout: $0) }
                } else {
                    ContentUnavailableView("האימון של היום", systemImage: "calendar",
                                           description: Text("כאן יופיע האימון מהתוכנית השבועית."))
                }
            }
            .navigationDestination(for: WorkoutBlock.self) { WorkoutBlockDetail(block: $0) }
        }
        .task(id: demo.scenario) { await load() }
    }

    private func load() async {
        guard session.isDemo else { return }
        state = .loading
        state = await demo.content.today()
    }
}


struct TodayContent: View {
    let workout: TodayWorkout
    @State private var showWatchNote = false

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(workout.dayLabel).font(Theme.font(15, .regular)).foregroundStyle(.secondary)
                        Text(workout.title).font(Theme.font(40, .bold))
                    }

                    HStack(spacing: 32) {
                        metric(String(format: "%g", workout.distanceKm), unit: "ק״מ")
                        metric(workout.pace, unit: "לק״מ")
                    }

                    VStack(spacing: 0) {
                        ForEach(workout.blocks) { block in
                            NavigationLink(value: block) {
                                HStack(alignment: .firstTextBaseline, spacing: 14) {
                                    Circle().fill(Theme.accent).frame(width: 8, height: 8)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(block.title).font(Theme.font(17, .semibold))
                                        Text(block.detail).font(Theme.font(15, .regular)).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.left").font(Theme.font(13, .bold)).foregroundStyle(.tertiary)
                                }
                                .padding(.vertical, 10)
                                .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .card()

                    if let note = workout.coachNote {
                        Label { Text(note) } icon: { Image(systemName: "quote.opening") }
                            .font(Theme.font(15, .regular))
                            .foregroundStyle(.secondary)
                    }

                    weekProgress
                }
                .padding(.horizontal, Theme.gutter)
                .padding(.top, 24)
            }

            Button { showWatchNote = true } label: {
                Text("שליחה לשעון").font(Theme.font(17, .semibold)).frame(maxWidth: .infinity, minHeight: 56)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
            .buttonBorderShape(.capsule)
            .padding(Theme.gutter)
            .alert("במצב הדגמה", isPresented: $showWatchNote) {
                Button("הבנתי", role: .cancel) {}
            } message: {
                Text("שליחה לשעון תעבוד אחרי חיבור לנתונים אמיתיים. כרגע לא נשלח דבר.")
            }
        }
    }

    private func metric(_ value: String, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(Theme.font(52, .semibold)).monospacedDigit()
            Text(unit).font(Theme.font(13, .regular)).foregroundStyle(.secondary)
        }
    }

    private var weekProgress: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("השבוע").font(Theme.font(15, .bold))
                Spacer()
                Text("\(Int(workout.weekDoneKm)) מתוך \(Int(workout.weekTargetKm)) ק״מ")
                    .font(Theme.font(15, .regular)).foregroundStyle(.secondary).monospacedDigit()
            }
            ProgressView(value: workout.weekDoneKm, total: workout.weekTargetKm).tint(Theme.accent)
        }
    }
}

struct WorkoutBlockDetail: View {
    let block: WorkoutBlock

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(block.title).font(Theme.font(34, .bold))
                Text(block.detail).font(Theme.font(20, .regular)).foregroundStyle(.secondary)
                if let note = block.note {
                    Text(note).font(Theme.font(17, .regular)).card()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.gutter)
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    TodayContent(workout: DemoContent.workout).environment(\.layoutDirection, .rightToLeft)
}
