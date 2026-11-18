import SwiftUI

struct ProfileView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        DataSourcesView()
                    } label: {
                        Label("שעון ונתונים", systemImage: "applewatch")
                    }
                    .accessibilityIdentifier("open-data-sources")
                }
                Section("גרסה") {
                    LabeledContent("אפליקציה", value: Bundle.main.appVersion)
                    LabeledContent("שרת", value: AppConfig.current.apiBaseURL.host() ?? "-")
                }
                if let email = session.session?.email {
                    Section("חשבון") {
                        LabeledContent("מייל", value: email)
                    }
                }
                Section {
                    Button("יציאה", role: .destructive) { session.signOut() }
                }
            }
            .navigationTitle("פרופיל")
        }
    }
}

extension Bundle {
    var appVersion: String {
        let version = infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }
}
