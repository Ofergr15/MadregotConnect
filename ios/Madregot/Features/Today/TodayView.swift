import SwiftUI

/// One thing per screen: today's workout, large, with one action at the thumb.
struct TodayView: View {
    @Environment(SessionStore.self) private var session
    @Environment(DemoSettings.self) private var demo
    @State private var state: LoadState<TodayWorkout> = .loading

    var body: some View {
        NavigationStack {
            Group {
                StateView(state: state, emptyTitle: "אין אימון היום", emptyIcon: "moon.zzz",
                          emptyMessage: "אין אימון מתוכנן להיום בתוכנית השבועית. מנוחה היא חלק מהאימון.",
                          retry: load) { TodayContent(workout: $0, isDemo: session.isDemo) }
            }
            .brandScreen("היום")
            .navigationDestination(for: WorkoutBlock.self) { WorkoutBlockDetail(block: $0) }
        }
        .task(id: demo.scenario) { await load() }
    }

    /// Demo: made-up content. Signed in: today's sessions from the club's weekly plan.
    private func load() async {
        state = .loading
        if session.isDemo { state = await demo.content.today(); return }
        do {
            let token = try await session.validAccessToken()
            state = await HTTPTodayClient(config: .current).today(accessToken: token)
        } catch {
            state = .failed((error as? AuthError ?? .sessionRejected).message)
        }
    }
}


struct TodayContent: View {
    let workout: TodayWorkout
    var isDemo = true
    @State private var showWatchNote = false

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(workout.dayLabel).font(Theme.font(15, .bold)).foregroundStyle(Theme.ink500)
                        Text(workout.title).font(Theme.font(40, .black)).foregroundStyle(Theme.brand)
                    }

                    HStack(spacing: 0) {
                        metric(String(format: "%g", workout.distanceKm), unit: "ק״מ")
                        if workout.pace != "–" {
                            Divider().frame(height: 56)
                            metric(workout.pace, unit: "לק״מ")
                        }
                    }
                    .padding(.vertical, 18)
                    .background(Theme.card, in: .rect(cornerRadius: Theme.radius))

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

                    if workout.weekTargetKm > 0 { weekProgress.card() }
                }
                .padding(.horizontal, Theme.gutter)
                .padding(.top, 24)
            }

            if isDemo {
                Button("שליחה לשעון") { showWatchNote = true }
                .buttonStyle(BrandButtonStyle())
                .padding(Theme.gutter)
            .alert("במצב הדגמה", isPresented: $showWatchNote) {
                Button("הבנתי", role: .cancel) {}
            } message: {
                Text("שליחה לשעון תעבוד אחרי חיבור לנתונים אמיתיים. כרגע לא נשלח דבר.")
            }
            }
        }
    }

    private func metric(_ value: String, unit: String) -> some View {
        VStack(spacing: 0) {
            Text(value).font(Theme.font(44, .black)).foregroundStyle(Theme.ink900).monospacedDigit()
            Text(unit).font(Theme.font(13, .regular)).foregroundStyle(Theme.ink500)
        }
        .frame(maxWidth: .infinity)
    }

    private var weekProgress: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("השבוע").font(Theme.font(15, .black)).foregroundStyle(Theme.ink900)
                Spacer()
                Text(workout.weekDoneKm > 0 ? "\(Int(workout.weekDoneKm)) מתוך \(Int(workout.weekTargetKm)) ק״מ" : "יעד: \(Int(workout.weekTargetKm)) ק״מ")
                    .font(Theme.font(15, .regular)).foregroundStyle(.secondary).monospacedDigit()
            }
            ProgressView(value: workout.weekDoneKm, total: workout.weekTargetKm).tint(Theme.brand)
        }
    }
}

struct WorkoutBlockDetail: View {
    let block: WorkoutBlock

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(block.title).font(Theme.font(34, .black)).foregroundStyle(Theme.brand)
                Text(block.detail).font(Theme.font(20, .regular)).foregroundStyle(.secondary)
                if let note = block.note {
                    Text(note).font(Theme.font(17, .regular)).card()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.gutter)
        }
        .background(Theme.page)
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    TodayContent(workout: DemoContent.workout).environment(\.layoutDirection, .rightToLeft)
}
