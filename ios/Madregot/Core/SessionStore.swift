import Foundation
import Observation

/// Whether the member is signed in, and the session behind it.
///
/// Signing in is email + 6-digit code against the existing server route. The session is
/// kept in the Keychain and refreshed silently, so a member signs in once per device.
@MainActor
@Observable
final class SessionStore {
    enum State: Equatable {
        /// Reading the Keychain / refreshing on launch.
        case restoring
        case signedOut
        case signedIn
    }

    private(set) var state: State
    private(set) var session: StoredSession?

    private let client: AuthClient
    private let tokens: TokenStore
    private let now: @Sendable () -> Date

    init(
        client: AuthClient = HTTPAuthClient(config: .current),
        tokens: TokenStore = KeychainTokenStore(),
        now: @escaping @Sendable () -> Date = { .now }
    ) {
        self.client = client
        self.tokens = tokens
        self.now = now
        self.state = .restoring
    }

    /// For previews: a fixed state, no Keychain, no network.
    init(previewState: State) {
        self.client = HTTPAuthClient(config: .current)
        self.tokens = InMemoryTokenStore()
        self.now = { .now }
        self.state = previewState
    }

    /// On launch: use the stored session, refreshing it if the access token has expired.
    /// A network failure keeps the member signed in with the stored session (they may be
    /// offline); only a rejected refresh token signs them out.
    func restore() async {
        guard let stored = tokens.load() else {
            state = .signedOut
            return
        }
        session = stored
        if stored.isAccessTokenFresh(now: now()) {
            state = .signedIn
            return
        }
        do {
            try await refresh(using: stored)
        } catch .sessionRejected {
            signOut()
        } catch {
            state = .signedIn
        }
    }

    func sendCode(to email: String) async throws(AuthError) {
        let normalised = Self.normalise(email)
        guard Self.looksLikeEmail(normalised) else { throw .invalidEmail }
        try await client.sendCode(to: normalised)
    }

    func verify(code: String, email: String) async throws(AuthError) {
        let digits = code.filter(\.isNumber)
        guard digits.count == 6 else { throw .badCode }
        let issued = try await client.verifyCode(digits, email: Self.normalise(email))
        try persist(issued.stored(now: now()))
    }

    /// A valid access token for an API call, refreshing first if it is about to expire.
    func validAccessToken() async throws(AuthError) -> String {
        guard let current = session else { throw .sessionRejected }
        if current.isAccessTokenFresh(now: now()) { return current.accessToken }
        do {
            try await refresh(using: current)
        } catch .sessionRejected {
            signOut()
            throw .sessionRejected
        }
        guard let token = session?.accessToken else { throw .sessionRejected }
        return token
    }

    func signOut() {
        tokens.clear()
        session = nil
        state = .signedOut
    }

    // MARK: - Private

    private func refresh(using stored: StoredSession) async throws(AuthError) {
        let issued = try await client.refresh(refreshToken: stored.refreshToken)
        var next = issued.stored(now: now())
        // The refresh response may omit what the verify response had; keep what we knew.
        next.athleteId = next.athleteId ?? stored.athleteId
        next.email = next.email ?? stored.email
        try persist(next)
    }

    private func persist(_ next: StoredSession) throws(AuthError) {
        do {
            try tokens.save(next)
        } catch {
            // Without the Keychain the member would be signed out on the next launch
            // with no explanation; better to say so now.
            throw .server(status: -1)
        }
        session = next
        state = .signedIn
    }

    nonisolated static func normalise(_ email: String) -> String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    nonisolated static func looksLikeEmail(_ email: String) -> Bool {
        let parts = email.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, parts[1].contains("."),
              !parts[1].hasPrefix("."), !parts[1].hasSuffix(".") else { return false }
        return !email.contains(" ")
    }
}
