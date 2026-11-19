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
            Text(run.title).font(.title3.weight(.semibold))
            HStack(alignment: .lastTextBaseline, spacing: 28) {
                RunStat(value: String(format: "%.1f", run.distanceKm), unit: "ק״מ")
                RunStat(value: run.pace, unit: "לק״מ")
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
        .contentShape(.rect)
    }
}

struct RunnerHeader: View {
    let run: FeedRun
    var body: some View {
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
    }
}

struct RunStat: View {
    let value: String
    let unit: String
    var size: CGFloat = 28
    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 4) {
            Text(value).font(.system(size: size, weight: .semibold, design: .rounded)).monospacedDigit()
            Text(unit).font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct RunDetailView: View {
    let run: FeedRun

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                RunnerHeader(run: run)
                Text(run.title).font(.system(size: 30, weight: .bold, design: .rounded))
                HStack(spacing: 24) {
                    RunStat(value: String(format: "%.1f", run.distanceKm), unit: "ק״מ", size: 34)
                    RunStat(value: run.pace, unit: "לק״מ", size: 34)
                    RunStat(value: run.durationLabel, unit: "זמן", size: 34)
                }
                VStack(alignment: .leading, spacing: 10) {
                    Text("קצב לפי קילומטר").font(.subheadline.bold())
                    ForEach(Array(run.splits.enumerated()), id: \.offset) { index, split in
                        HStack {
                            Text("ק״מ \(index + 1)").foregroundStyle(.secondary)
                            Spacer()
                            Text(split).monospacedDigit()
                        }
                        .font(.subheadline)
                    }
                }
                .card()
            }
            .padding(Theme.gutter)
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}
