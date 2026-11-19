import SwiftUI

struct ProfileView: View {
    @Environment(SessionStore.self) private var session
    @Environment(DemoSettings.self) private var demo
    @State private var summary: LoadState<ProfileSummary> = .loading

    private var displayName: String {
        // The name is who is signed in, not loaded data: keep it in every demo state.
        if session.isDemo { return DemoContent.summary.name }
        return session.session?.email ?? ""
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    VStack(spacing: 10) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.system(size: 76))
                            .foregroundStyle(Theme.accent)
                        Text(displayName).font(.title2.bold())
                        if session.isDemo, case .loaded(let s) = summary {
                            Text("\(s.groupLabel) · מצב הדגמה").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.top, 12)

                    if session.isDemo {
                        switch summary {
                        case .loaded(let s):
                            HStack(spacing: 12) {
                                tile("\(s.weekKm)", "ק״מ השבוע")
                                tile("\(s.weekRuns)", "ריצות")
                                tile("\(s.streakDays)", "ימים ברצף")
                            }
                        case .loading:
                            ProgressView().frame(height: 96).accessibilityIdentifier("state-loading")
                        case .empty:
                            Text("עוד אין ריצות השבוע.").foregroundStyle(.secondary).frame(height: 96)
                                .accessibilityIdentifier("state-empty")
                        case .failed(let message):
                            Text(message).foregroundStyle(.secondary).frame(height: 96)
                                .accessibilityIdentifier("state-failed")
                        }

                        @Bindable var demo = demo
                        VStack(alignment: .leading, spacing: 10) {
                            Text("מצב תצוגה (הדגמה)").font(.subheadline.bold())
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

                    Button(role: .destructive) { session.signOut() } label: {
                        Text("יציאה").frame(maxWidth: .infinity, minHeight: 50)
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .tint(.red)

                    Text("גרסה \(Bundle.main.appVersion) · \(AppConfig.current.apiBaseURL.host() ?? "-")")
                        .font(.caption2).foregroundStyle(.tertiary)
                }
                .padding(Theme.gutter)
            }
            .navigationTitle("פרופיל")
            .task(id: demo.scenario) {
                guard session.isDemo else { return }
                summary = .loading
                summary = await demo.content.profile()
            }
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func tile(_ value: String, _ label: String) -> some View {
        VStack(spacing: 4) {
            Text(value).font(.system(size: 30, weight: .semibold, design: .rounded)).monospacedDigit()
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
        .background(Theme.surface, in: .rect(cornerRadius: 20))
    }

    private func row(_ title: String, _ icon: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon).foregroundStyle(Theme.accent).frame(width: 28)
            Text(title).foregroundStyle(.primary)
            Spacer()
            Image(systemName: "chevron.left").font(.footnote.bold()).foregroundStyle(.tertiary)
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
