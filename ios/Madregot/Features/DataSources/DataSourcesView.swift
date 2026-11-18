import SwiftUI

/// "With what do you run?" — where the member's runs come from. Signing in is never
/// through these; they are data connections only (see ios/docs/auth-plan.md, step F).
///
/// This step shows the real state from the server. Connecting is not wired yet:
/// Strava needs the OAuth handoff back into the app, Garmin needs a decision on
/// entering the Garmin password in-app, and Apple Health needs migration 138 and the
/// HealthKit entitlement. The buttons say so instead of pretending.
struct DataSourcesView: View {
    @Environment(SessionStore.self) private var session
    var client: DataSourcesClient = HTTPDataSourcesClient(config: .current)

    @State private var status: DataSourcesStatus?
    @State private var errorText: String?
    @State private var loading = false

    var body: some View {
        List {
            Section {
                providerRow(
                    name: "Garmin",
                    systemImage: "applewatch.side.right",
                    detail: "האימונים נשלחים לשעון, והריצות חוזרות לאפליקציה.",
                    state: status?.garmin,
                    lastSync: status?.garminLastSync,
                    isPrimary: status?.primarySource == "garmin"
                )
                providerRow(
                    name: "Strava",
                    systemImage: "figure.run",
                    detail: "הריצות מ-Strava נכנסות לפיד ולסטטיסטיקות.",
                    state: status?.strava,
                    lastSync: status?.stravaLastSync,
                    isPrimary: status?.primarySource == "strava"
                )
                providerRow(
                    name: "Apple Health",
                    systemImage: "heart.fill",
                    detail: "ל-Apple Watch או לריצה עם האייפון בלבד, בלי Garmin ובלי Strava.",
                    state: nil,
                    lastSync: nil,
                    isPrimary: false
                )
            } header: {
                Text("עם מה אתם רצים?")
            } footer: {
                if let status, !status.hasAnySource {
                    Text("עוד לא חיברתם מקור. בלי מקור, הריצות לא יגיעו לפיד ולמאמן.")
                }
            }

            if let errorText {
                Section {
                    Text(errorText).foregroundStyle(.red)
                    Button("נסו שוב") { Task { await load() } }
                }
            }
        }
        .navigationTitle("שעון ונתונים")
        .overlay { if loading && status == nil { ProgressView() } }
        .refreshable { await load() }
        .task { await load() }
    }

    private func providerRow(
        name: String, systemImage: String, detail: String,
        state: ConnectionState?, lastSync: Date?, isPrimary: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(name, systemImage: systemImage).font(.headline)
                if isPrimary {
                    Text("ראשי")
                        .font(.caption2.bold())
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.tint.opacity(0.15), in: .capsule)
                }
                Spacer()
                if let state {
                    Text(state.label)
                        .font(.subheadline)
                        .foregroundStyle(state.needsAttention ? .orange : (state.isConnected ? .green : .secondary))
                }
            }
            Text(detail).font(.footnote).foregroundStyle(.secondary)
            if let lastSync {
                Text("סנכרון אחרון: \(lastSync.formatted(.relative(presentation: .named)))")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Button(buttonTitle(state)) {}
                .font(.subheadline)
                .disabled(true)
            Text("החיבור מהאפליקציה יגיע בשלב הבא. בינתיים אפשר לחבר מהאתר.")
                .font(.caption2).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private func buttonTitle(_ state: ConnectionState?) -> String {
        switch state {
        case .failed?: "התחברות מחדש"
        case let s? where s.isConnected: "ניהול החיבור"
        default: "חיבור"
        }
    }

    private func load() async {
        guard let athleteId = session.session?.athleteId else {
            errorText = "לא נמצא חשבון מחובר."
            return
        }
        loading = true
        defer { loading = false }
        do {
            let token = try await session.validAccessToken()
            status = try await client.status(athleteId: athleteId, accessToken: token)
            errorText = nil
        } catch let error as DataSourcesError {
            errorText = error.message
        } catch {
            errorText = DataSourcesError.signedOut.message
        }
    }
}
