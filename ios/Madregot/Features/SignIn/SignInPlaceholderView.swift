import SwiftUI

/// M0: the shape of the sign-in screen only. The two buttons are disabled until the
/// auth plan (Strava via ASWebAuthenticationSession, 6-digit email code) is approved.
struct SignInPlaceholderView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "figure.run.circle.fill")
                .font(.system(size: 72))
                .foregroundStyle(.tint)
            Text("מדרגות")
                .font(.largeTitle.bold())
            Text("מועדון הריצה")
                .foregroundStyle(.secondary)
            Spacer()
            VStack(spacing: 12) {
                Button("התחברות עם Strava") {}
                    .buttonStyle(.borderedProminent)
                    .disabled(true)
                Button("התחברות עם קוד במייל") {}
                    .buttonStyle(.bordered)
                    .disabled(true)
                Text("ההתחברות תופעל בשלב הבא")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            #if DEBUG
            Button("כניסה למצב הדגמה") { session.enterDemoMode() }
                .font(.footnote)
                .accessibilityIdentifier("demo-mode")
            #endif
            Spacer().frame(height: 24)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity)
    }
}
