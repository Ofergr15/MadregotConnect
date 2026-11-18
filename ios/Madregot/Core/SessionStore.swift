import Observation

/// Holds whether the member is signed in.
///
/// M0 placeholder: there is no real authentication yet and nothing touches the
/// network or the Keychain. The real implementation (Strava / email code →
/// Supabase session, tokens in the Keychain) waits for the approved auth plan.
@MainActor
@Observable
final class SessionStore {
    enum State: Equatable {
        case signedOut
        case signedIn
    }

    private(set) var state: State

    init(previewState: State = .signedOut) {
        state = previewState
    }

    /// Local-only: lets the skeleton show the signed-in shell. No credentials involved.
    func enterDemoMode() {
        state = .signedIn
    }

    func signOut() {
        state = .signedOut
    }
}
