import SwiftUI

/// Signed-out → sign-in screen; signed-in → the tab shell.
struct RootView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        switch session.state {
        case .signedOut:
            SignInPlaceholderView()
        case .signedIn:
            MainTabView()
        }
    }
}

struct MainTabView: View {
    var body: some View {
        TabView {
            TodayView()
                .tabItem { Label("היום", systemImage: "figure.run") }
            FeedView()
                .tabItem { Label("פיד", systemImage: "list.bullet.rectangle") }
            ProfileView()
                .tabItem { Label("פרופיל", systemImage: "person.crop.circle") }
        }
    }
}

#Preview("מחובר") {
    RootView()
        .environment(SessionStore(previewState: .signedIn))
        .environment(\.layoutDirection, .rightToLeft)
}

#Preview("לא מחובר") {
    RootView()
        .environment(SessionStore())
        .environment(\.layoutDirection, .rightToLeft)
}
