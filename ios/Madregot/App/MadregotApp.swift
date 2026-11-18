import SwiftUI

@main
struct MadregotApp: App {
    @State private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                // Hebrew-first: the app is right-to-left regardless of the device language.
                // An English mode (the web app's `en` locale) comes later and will lift this.
                .environment(\.layoutDirection, .rightToLeft)
                .environment(\.locale, Locale(identifier: "he_IL"))
                .task { await session.restore() }
        }
    }
}
