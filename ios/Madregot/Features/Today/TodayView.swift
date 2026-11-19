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
                        Text(workout.dayLabel).font(.subheadline).foregroundStyle(.secondary)
                        Text(workout.title).font(.system(size: 40, weight: .bold, design: .rounded))
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
                                        Text(block.title).font(.headline)
                                        Text(block.detail).font(.subheadline).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.left").font(.footnote.bold()).foregroundStyle(.tertiary)
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
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    weekProgress
                }
                .padding(.horizontal, Theme.gutter)
                .padding(.top, 24)
            }

            Button { showWatchNote = true } label: {
                Text("שליחה לשעון").font(.headline).frame(maxWidth: .infinity, minHeight: 56)
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

struct WorkoutBlockDetail: View {
    let block: WorkoutBlock

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(block.title).font(.system(size: 34, weight: .bold, design: .rounded))
                Text(block.detail).font(.title3).foregroundStyle(.secondary)
                if let note = block.note {
                    Text(note).font(.body).card()
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
