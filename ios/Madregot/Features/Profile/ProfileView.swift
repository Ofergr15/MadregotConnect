import SwiftUI

struct ProfileView: View {
    @Environment(SessionStore.self) private var session

    private var displayName: String { session.isDemo ? "אופיר (הדגמה)" : (session.session?.email ?? "") }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    VStack(spacing: 10) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.system(size: 76))
                            .foregroundStyle(Theme.accent)
                        Text(displayName).font(.title2.bold())
                        if session.isDemo {
                            Text("קבוצה 1 · מצב הדגמה").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.top, 12)

                    if session.isDemo {
                        HStack(spacing: 12) {
                            tile("34", "ק״מ השבוע")
                            tile("4", "ריצות")
                            tile("12", "ימים ברצף")
                        }
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
