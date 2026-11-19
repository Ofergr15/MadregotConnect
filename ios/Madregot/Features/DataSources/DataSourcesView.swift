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
    var client: DataSourcesClient?

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
                BrandSectionHeader("עם מה אתם רצים?")
            } footer: {
                if let status, !status.hasAnySource {
                    Text("עוד לא חיברתם מקור. בלי מקור, הריצות לא יגיעו לפיד ולמאמן.")
                        .font(Theme.font(13, .regular)).foregroundStyle(Theme.ink500)
                }
            }

            if let errorText {
                Section {
                    Text(errorText).font(Theme.font(15, .bold)).foregroundStyle(Theme.danger)
                    Button("נסו שוב") { Task { await load() } }
                        .buttonStyle(BrandButtonStyle())
                        .listRowBackground(Color.clear)
                }
            }
        }
        .brandList("שעון ונתונים")
        .overlay { if loading && status == nil { ProgressView().controlSize(.large).tint(Theme.brand) } }
        .refreshable { await load() }
        .task { await load() }
    }

    private func providerRow(
        name: String, systemImage: String, detail: String,
        state: ConnectionState?, lastSync: Date?, isPrimary: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.brand)
                    .frame(width: 36, height: 36)
                    .background(Theme.brand.opacity(0.1), in: .circle)
                Text(name).font(Theme.font(17, .black)).foregroundStyle(Theme.ink900)
                // "Primary" only for a source that is actually connected: dev data can name a
                // primary source whose connection is gone, and the UI must not claim both.
                if isPrimary && state?.isConnected == true { StatusPill(text: "ראשי", color: Theme.brand) }
                Spacer()
                if let state {
                    StatusPill(text: state.label,
                               color: state.needsAttention ? Color(hex: 0xD97706) : (state.isConnected ? Color(hex: 0x16A34A) : Theme.ink500))
                }
            }
            Text(detail).font(Theme.font(14, .regular)).foregroundStyle(Theme.ink700)
            if let lastSync {
                Text("סנכרון אחרון: \(lastSync.formatted(.relative(presentation: .named)))")
                    .font(Theme.font(12, .regular)).foregroundStyle(Theme.ink500)
            }
            Text(buttonTitle(state))
                .font(Theme.font(14, .bold)).foregroundStyle(Theme.ink500)
                .frame(maxWidth: .infinity, minHeight: 40)
                .overlay(Capsule().stroke(Theme.ink300, lineWidth: 1))
                .accessibilityAddTraits(.isButton)
            Text("החיבור מהאפליקציה יגיע בשלב הבא. בינתיים אפשר לחבר מהאתר.")
                .font(Theme.font(11, .regular)).foregroundStyle(Theme.ink500)
        }
        .padding(.vertical, 8)
    }

    private func buttonTitle(_ state: ConnectionState?) -> String {
        switch state {
        case .failed?: "התחברות מחדש"
        case let s? where s.isConnected: "ניהול החיבור"
        default: "חיבור"
        }
    }

    private var resolvedClient: DataSourcesClient {
        if let client { return client }
        #if DEBUG || DEMO
        if session.isDemo { return DemoDataSourcesClient() }
        #endif
        return HTTPDataSourcesClient(config: .current)
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
            status = try await resolvedClient.status(athleteId: athleteId, accessToken: token)
            errorText = nil
        } catch let error as DataSourcesError {
            errorText = error.message
        } catch {
            errorText = DataSourcesError.signedOut.message
        }
    }
}
