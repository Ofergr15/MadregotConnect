import SwiftUI

/// A calm list of club runs: who, what, and the one number that matters. No clutter.
struct FeedView: View {
    @Environment(SessionStore.self) private var session
    @Environment(DemoSettings.self) private var demo
    @State private var state: LoadState<[FeedRun]> = .loading

    var body: some View {
        NavigationStack {
            Group {
                StateView(state: state, emptyTitle: "עוד אין ריצות", emptyIcon: "figure.run",
                              emptyMessage: "כשחברי המועדון ירוצו, הריצות שלהם יופיעו כאן.",
                              retry: load) { runs in
                        ScrollView {
                            LazyVStack(spacing: 14) {
                                ForEach(runs) { run in
                                    NavigationLink(value: run) { FeedCard(run: run, onClap: clap) }
                                        .buttonStyle(.plain)
                                }
                            }
                            .padding(Theme.gutter)
                        }
                        // The floating tab bar sits over the content: keep the last card's
                        // stats and clap fully above it when scrolled to the end.
                        .contentMargins(.bottom, 96, for: .scrollContent)
                        .refreshable { await load() }
                    }
            }
            .brandScreen("פיד")
            .navigationDestination(for: FeedRun.self) { RunDetailView(run: $0) }
        }
        .task(id: demo.scenario) { await load() }
    }

    /// Sends a clap and returns the server's answer; nil = keep what was shown.
    private func clap(_ run: FeedRun) async -> (liked: Bool, count: Int)? {
        guard !session.isDemo, let itemId = run.itemId else { return nil }
        guard let token = try? await session.validAccessToken() else { return nil }
        return await HTTPLikeClient(config: .current).toggle(itemId: itemId, accessToken: token)
    }

    /// Demo: made-up runs. Signed in: the club feed's runs from the backend.
    private func load() async {
        if case .loaded = state {} else { state = .loading }
        if session.isDemo { state = await demo.content.feed(); return }
        do {
            let token = try await session.validAccessToken()
            state = await HTTPFeedClient(config: .current).runs(accessToken: token)
        } catch {
            state = .failed((error as? AuthError ?? .sessionRejected).message)
        }
    }
}


struct FeedCard: View {
    let run: FeedRun
    var onClap: (FeedRun) async -> (liked: Bool, count: Int)? = { _ in nil }
    @State private var liked: Bool
    @State private var count: Int
    @State private var sending = false

    init(run: FeedRun, onClap: @escaping (FeedRun) async -> (liked: Bool, count: Int)? = { _ in nil }) {
        self.run = run
        self.onClap = onClap
        _liked = State(initialValue: run.likedByMe)
        _count = State(initialValue: run.kudos)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            RunnerHeader(run: run)
            Text(run.title).font(Theme.font(20, .black)).foregroundStyle(Theme.ink900)
            HStack(alignment: .lastTextBaseline, spacing: 28) {
                RunStat(value: String(format: "%.1f", run.distanceKm), unit: "ק״מ")
                RunStat(value: run.pace, unit: "לק״מ")
                Spacer()
                Button {
                    guard !sending else { return }
                    // Optimistic, then the server's answer wins; a failure puts it back.
                    let before = (liked, count)
                    liked.toggle(); count += liked ? 1 : -1
                    sending = true
                    Task {
                        if let answer = await onClap(run) { liked = answer.liked; count = answer.count }
                        else if run.itemId != nil { (liked, count) = before }
                        sending = false
                    }
                } label: {
                    Label("\(count)", systemImage: liked ? "hands.clap.fill" : "hands.clap")
                        .font(Theme.font(15, .medium))
                        .foregroundStyle(liked ? Theme.brand : Theme.ink500)
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
                Text(run.name).font(Theme.font(17, .bold)).foregroundStyle(Theme.ink900)
                Text(run.when).font(Theme.font(12, .regular)).foregroundStyle(Theme.ink500)
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
            Text(value).font(Theme.font(size, .black)).foregroundStyle(Theme.ink900).monospacedDigit()
            Text(unit).font(Theme.font(12, .regular)).foregroundStyle(Theme.ink500)
        }
    }
}

struct RunDetailView: View {
    let run: FeedRun

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                RunnerHeader(run: run)
                Text(run.title).font(Theme.font(30, .black)).foregroundStyle(Theme.brand)
                // One white stat card, like Profile's; a 1:49:30 duration must not wrap.
                HStack(spacing: 0) {
                    detailStat(String(format: "%.1f", run.distanceKm), "ק״מ")
                    Divider().frame(height: 48)
                    detailStat(run.pace, "לק״מ")
                    Divider().frame(height: 48)
                    detailStat(run.durationLabel, "זמן")
                }
                .padding(.vertical, 16)
                .background(Theme.card, in: .rect(cornerRadius: Theme.radius))
                if !run.splits.isEmpty {
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
            }
            .padding(Theme.gutter)
        }
        .background(Theme.page)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func detailStat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 4) {
            Text(value).font(Theme.font(28, .black)).foregroundStyle(Theme.ink900).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(Theme.font(12, .semibold)).foregroundStyle(Theme.ink500)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 6)
    }
}
