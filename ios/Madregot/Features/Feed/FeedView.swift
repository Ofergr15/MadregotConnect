import SwiftUI

/// A calm list of club runs: who, what, and the one number that matters. No clutter.
struct FeedView: View {
    @Environment(SessionStore.self) private var session
    @Environment(DemoSettings.self) private var demo
    @State private var state: LoadState<[FeedRun]> = .loading

    var body: some View {
        NavigationStack {
            Group {
                if session.isDemo {
                    StateView(state: state, emptyTitle: "עוד אין ריצות", emptyIcon: "figure.run",
                              emptyMessage: "כשחברי המועדון ירוצו, הריצות שלהם יופיעו כאן.",
                              retry: load) { runs in
                        ScrollView {
                            LazyVStack(spacing: 14) {
                                ForEach(runs) { run in
                                    NavigationLink(value: run) { FeedCard(run: run) }
                                        .buttonStyle(.plain)
                                }
                            }
                            .padding(Theme.gutter)
                        }
                        .refreshable { await load() }
                    }
                } else {
                    ContentUnavailableView("הפיד", systemImage: "list.bullet.rectangle",
                                           description: Text("כאן יופיעו הריצות של חברי המועדון."))
                }
            }
            .navigationTitle("פיד")
            .navigationDestination(for: FeedRun.self) { RunDetailView(run: $0) }
        }
        .task(id: demo.scenario) { await load() }
    }

    private func load() async {
        guard session.isDemo else { return }
        if case .loaded = state {} else { state = .loading }
        state = await demo.content.feed()
    }
}


struct FeedCard: View {
    let run: FeedRun
    @State private var liked = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            RunnerHeader(run: run)
            Text(run.title).font(Theme.font(20, .semibold))
            HStack(alignment: .lastTextBaseline, spacing: 28) {
                RunStat(value: String(format: "%.1f", run.distanceKm), unit: "ק״מ")
                RunStat(value: run.pace, unit: "לק״מ")
                Spacer()
                Button {
                    liked.toggle()
                } label: {
                    Label("\(run.kudos + (liked ? 1 : 0))", systemImage: liked ? "hands.clap.fill" : "hands.clap")
                        .font(Theme.font(15, .medium))
                        .foregroundStyle(liked ? Theme.accent : .secondary)
                }
                .buttonStyle(.plain)
                .sensoryFeedback(.selection, trigger: liked)
            }
        }
        .card()
        .contentShape(.rect)
    }
}

struct RunnerHeader: View {
    let run: FeedRun
    var body: some View {
        HStack(spacing: 12) {
            Text(run.initials)
                .font(Theme.font(15, .bold))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(Theme.groupColor(run.group), in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                Text(run.name).font(Theme.font(17, .semibold))
                Text(run.when).font(Theme.font(12, .regular)).foregroundStyle(.secondary)
            }
            Spacer()
        }
    }
}

struct RunStat: View {
    let value: String
    let unit: String
    var size: CGFloat = 28
    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 4) {
            Text(value).font(Theme.font(size, .semibold)).monospacedDigit()
            Text(unit).font(Theme.font(12, .regular)).foregroundStyle(.secondary)
        }
    }
}

struct RunDetailView: View {
    let run: FeedRun

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                RunnerHeader(run: run)
                Text(run.title).font(Theme.font(30, .bold))
                HStack(spacing: 24) {
                    RunStat(value: String(format: "%.1f", run.distanceKm), unit: "ק״מ", size: 34)
                    RunStat(value: run.pace, unit: "לק״מ", size: 34)
                    RunStat(value: run.durationLabel, unit: "זמן", size: 34)
                }
                VStack(alignment: .leading, spacing: 10) {
                    Text("קצב לפי קילומטר").font(Theme.font(15, .bold))
                    ForEach(Array(run.splits.enumerated()), id: \.offset) { index, split in
                        HStack {
                            Text("ק״מ \(index + 1)").foregroundStyle(.secondary)
                            Spacer()
                            Text(split).monospacedDigit()
                        }
                        .font(Theme.font(15, .regular))
                    }
                }
                .card()
            }
            .padding(Theme.gutter)
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}
