import SwiftUI

struct ProfileView: View {
    @Environment(SessionStore.self) private var session
    @Environment(DemoSettings.self) private var demo
    @State private var summary: LoadState<ProfileSummary> = .loading
    var profileClient: ProfileClient = HTTPProfileClient(config: .current)

    private var displayName: String {
        // The name is who is signed in, not loaded data: keep it in every demo state.
        if session.isDemo { return DemoContent.summary.name }
        if case .loaded(let s) = summary { return s.name }
        return session.session?.email ?? ""
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    VStack(spacing: 10) {
                        // The PWA's avatar: initials on a brand-blue circle.
                        Text(initials(displayName))
                            .font(Theme.font(30, .black))
                            .foregroundStyle(.white)
                            .frame(width: 88, height: 88)
                            .background(Theme.brand, in: .circle)
                            .overlay(Circle().stroke(.white, lineWidth: 4))
                        Text(displayName).font(Theme.font(24, .black)).foregroundStyle(Theme.ink900)
                        if session.isDemo, case .loaded(let s) = summary {
                            Text("\(s.groupLabel) · מצב הדגמה").font(Theme.font(15, .regular)).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.top, 12)

                    Group {
                        switch summary {
                        case .loaded(let s):
                            // The PWA's stat strip: one white card, columns split by hairlines.
                            HStack(spacing: 0) {
                                tile("\(s.weekKm)", "ק״מ השבוע")
                                Divider().frame(height: 36)
                                tile("\(s.weekRuns)", "ריצות השבוע")
                                Divider().frame(height: 36)
                                tile("\(s.streakDays)", "שבועות ברצף")
                            }
                            .background(Theme.card, in: .rect(cornerRadius: Theme.radius))
                        case .loading:
                            ProgressView().frame(height: 96).accessibilityIdentifier("state-loading")
                        case .empty:
                            Text("עוד אין ריצות השבוע.").foregroundStyle(.secondary).frame(height: 96)
                                .accessibilityIdentifier("state-empty")
                        case .failed(let message):
                            Text(message).foregroundStyle(.secondary).frame(height: 96)
                                .accessibilityIdentifier("state-failed")
                        }
                    }

                    if session.isDemo {
                        @Bindable var demo = demo
                        VStack(alignment: .leading, spacing: 10) {
                            Text("מצב תצוגה (הדגמה)").font(Theme.font(15, .bold))
                            Picker("מצב תצוגה", selection: $demo.scenario) {
                                ForEach(DemoScenario.allCases) { Text($0.label).tag($0) }
                            }
                            .pickerStyle(.segmented)
                            .accessibilityIdentifier("demo-scenario")
                        }
                        .card()
                    }

                    VStack(spacing: 0) {
                        NavigationLink { DataSourcesView() } label: {
                            row("שעון ונתונים", "applewatch")
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("open-data-sources")
                    }
                    .background(Theme.surface, in: .rect(cornerRadius: Theme.radius))

                    // The PWA's outline pill: `rounded-pill border border-ink-300`, red label.
                    Button(role: .destructive) { session.signOut() } label: {
                        Text("יציאה")
                            .font(Theme.font(16, .bold))
                            .foregroundStyle(Theme.danger)
                            .frame(maxWidth: .infinity, minHeight: Theme.controlHeight)
                            .overlay(Capsule().stroke(Theme.ink300, lineWidth: 1))
                    }
                    .buttonStyle(.plain)

                    Text("גרסה \(Bundle.main.appVersion) · \(AppConfig.current.apiBaseURL.host() ?? "-")")
                        .font(Theme.font(11, .regular)).foregroundStyle(.tertiary)
                }
                .padding(Theme.gutter)
            }
            .background(Theme.page)
            .navigationTitle("פרופיל")
            .task(id: demo.scenario) { await load() }
            .refreshable { await load() }
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    /// Demo: made-up content. Signed in: the member's own numbers from the backend.
    private func load() async {
        summary = .loading
        if session.isDemo { summary = await demo.content.profile(); return }
        guard let athleteId = session.session?.athleteId else {
            summary = .failed("לא נמצא מזהה חבר בחשבון. צריך להתחבר מחדש."); return
        }
        do {
            let token = try await session.validAccessToken()
            summary = await profileClient.summary(athleteId: athleteId, accessToken: token)
        } catch {
            summary = .failed((error as? AuthError ?? .sessionRejected).message)
        }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "?" : letters
    }

    private func tile(_ value: String, _ label: String) -> some View {
        VStack(spacing: 4) {
            Text(value).font(Theme.font(28, .black)).monospacedDigit().foregroundStyle(Theme.ink900)
            Text(label).font(Theme.font(12, .semibold)).foregroundStyle(Theme.ink500)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
    }

    private func row(_ title: String, _ icon: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon).foregroundStyle(Theme.accent).frame(width: 28)
            Text(title).foregroundStyle(.primary)
            Spacer()
            Image(systemName: "chevron.left").font(Theme.font(13, .bold)).foregroundStyle(.tertiary)
        }
        .padding(18)
    }
}

extension Bundle {
    var appVersion: String {
        let version = infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }
}
