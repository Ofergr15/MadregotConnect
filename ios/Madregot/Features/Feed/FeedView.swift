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
                            LazyVStack(spacing: 10) {
                                ForEach(runs) { run in
                                    NavigationLink(value: run) { FeedCard(run: run, onClap: clap) }
                                        .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.top, 4)
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
        // Who → what → the one number (distance) large, pace/time as quiet secondaries,
        // the route beside them when the run has one, the clap at the foot.
        VStack(alignment: .leading, spacing: 10) {
            RunnerHeader(run: run, compact: true)
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(run.title).font(Theme.font(17, .black)).foregroundStyle(Theme.ink900).lineLimit(1)
                    HStack(alignment: .lastTextBaseline, spacing: 4) {
                        Text(String(format: "%.1f", run.distanceKm))
                            .font(Theme.font(28, .black)).foregroundStyle(Theme.brand).monospacedDigit()
                        Text("ק״מ").font(Theme.font(13, .bold)).foregroundStyle(Theme.brand.opacity(0.8))
                    }
                    HStack(spacing: 14) {
                        secondary("speedometer", run.pace, "לק״מ")
                        if run.durationLabel != "–" { secondary("stopwatch", run.durationLabel, nil) }
                        if run.route.isEmpty { Spacer(minLength: 0); clapButton }
                    }
                }
                if !run.route.isEmpty {
                    Spacer(minLength: 0)
                    VStack(spacing: 8) {
                        RouteThumbnail(points: run.route)
                            .frame(width: 88, height: 88)
                            .accessibilityLabel("מסלול הריצה")
                        clapButton
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        // Shadow on the card shape only — applied to the whole view it haloes the text.
        .background(
            RoundedRectangle(cornerRadius: 20).fill(Theme.card)
                .shadow(color: Theme.ink900.opacity(0.06), radius: 8, y: 2)
        )
        .contentShape(.rect)
    }

    private func secondary(_ icon: String, _ value: String, _ unit: String?) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink500)
            Text(value).font(Theme.font(15, .bold)).foregroundStyle(Theme.ink700).monospacedDigit()
            if let unit { Text(unit).font(Theme.font(12, .regular)).foregroundStyle(Theme.ink500) }
        }
    }

    private var clapButton: some View {
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
            HStack(spacing: 6) {
                Image(systemName: liked ? "hands.clap.fill" : "hands.clap")
                Text("\(count)").monospacedDigit()
            }
            .font(Theme.font(14, .bold))
            .foregroundStyle(liked ? Theme.brand : Theme.ink500)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(liked ? Theme.brand.opacity(0.1) : Theme.canvas, in: .capsule)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: liked)
        .accessibilityLabel("מחיאות כפיים, \(count)")
    }
}

/// The real route, drawn from the feed's points — no map tiles, no SDK, nothing paid.
/// An equirectangular projection (longitude scaled by cos(latitude)) is exact enough
/// at a run's scale; the shape is aspect-fit so north stays up.
struct RouteThumbnail: View {
    let points: [RoutePoint]
    var body: some View {
        RouteShape(points: points)
            .stroke(Theme.brand, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
            .padding(12)
            .background(Theme.brand.opacity(0.07), in: .rect(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.brand.opacity(0.12), lineWidth: 1))
    }
}

struct RouteShape: Shape {
    let points: [RoutePoint]
    func path(in rect: CGRect) -> Path {
        guard points.count >= 2 else { return Path() }
        let meanLat = points.map(\.lat).reduce(0, +) / Double(points.count)
        let k = cos(meanLat * .pi / 180)
        let xs = points.map { $0.lng * k }, ys = points.map { -$0.lat }
        let minX = xs.min()!, maxX = xs.max()!, minY = ys.min()!, maxY = ys.max()!
        let w = max(maxX - minX, 1e-9), h = max(maxY - minY, 1e-9)
        let scale = min(rect.width / w, rect.height / h)
        let dx = rect.minX + (rect.width - w * scale) / 2, dy = rect.minY + (rect.height - h * scale) / 2
        var path = Path()
        for (i, (x, y)) in zip(xs, ys).enumerated() {
            let pt = CGPoint(x: dx + (x - minX) * scale, y: dy + (y - minY) * scale)
            i == 0 ? path.move(to: pt) : path.addLine(to: pt)
        }
        return path
    }
}

struct RunnerHeader: View {
    let run: FeedRun
    var compact = false
    var body: some View {
        HStack(spacing: compact ? 10 : 12) {
            Text(run.initials)
                .font(Theme.font(compact ? 13 : 15, .bold))
                .foregroundStyle(.white)
                .frame(width: compact ? 34 : 40, height: compact ? 34 : 40)
                .background(Theme.groupColor(run.group), in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                Text(run.name).font(Theme.font(compact ? 15 : 17, .bold)).foregroundStyle(Theme.ink900)
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
