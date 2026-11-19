import SwiftUI

/// Restoring → spinner; signed out → sign-in; signed in → the tab shell.
struct RootView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        switch session.state {
        case .restoring:
            BrandSplash()
        case .signedOut:
            SignInView()
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
        .environment(DemoSettings())
        .environment(\.layoutDirection, .rightToLeft)
}

#Preview("לא מחובר") {
    RootView()
        .environment(SessionStore(previewState: .signedOut))
        .environment(DemoSettings())
        .environment(\.layoutDirection, .rightToLeft)
}

/// Same look as the launch screen (brand blue, the club's white logo, whole) so the hand-off
/// from the system splash to the app is seamless while the session restores.
struct BrandSplash: View {
    var body: some View {
        ZStack {
            Theme.brand.ignoresSafeArea()
            VStack(spacing: 18) {
                Image("ClubLogoWhite").resizable().scaledToFit().frame(width: 150)
                    .accessibilityLabel("Madregot After 2KM")
                ProgressView().tint(.white)
            }
        }
    }
}
