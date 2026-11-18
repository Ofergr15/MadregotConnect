import Foundation
import Testing
@testable import Madregot

/// A scripted AuthClient: records calls, answers from closures.
final class FakeAuthClient: AuthClient, @unchecked Sendable {
    var sent: [String] = []
    var verified: [(code: String, email: String)] = []
    var refreshedWith: [String] = []
    var sendResult: Result<Void, AuthError> = .success(())
    var verifyResult: Result<IssuedSession, AuthError> = .success(.sample(access: "a1", refresh: "r1"))
    var refreshResult: Result<IssuedSession, AuthError> = .success(.sample(access: "a2", refresh: "r2"))

    func sendCode(to email: String) async throws(AuthError) {
        sent.append(email)
        try sendResult.get()
    }

    func verifyCode(_ code: String, email: String) async throws(AuthError) -> IssuedSession {
        verified.append((code, email))
        return try verifyResult.get()
    }

    func refresh(refreshToken: String) async throws(AuthError) -> IssuedSession {
        refreshedWith.append(refreshToken)
        return try refreshResult.get()
    }
}

extension IssuedSession {
    static func sample(access: String, refresh: String, expiresIn: TimeInterval = 3600) -> IssuedSession {
        IssuedSession(accessToken: access, refreshToken: refresh, expiresIn: expiresIn,
                      athleteId: "ath-1", email: "runner@example.com")
    }
}

private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

@MainActor
struct SessionStoreTests {
    @Test func noStoredSessionMeansSignedOut() async {
        let store = SessionStore(client: FakeAuthClient(), tokens: InMemoryTokenStore(), now: { t0 })
        #expect(store.state == .restoring)
        await store.restore()
        #expect(store.state == .signedOut)
    }

    @Test func freshStoredSessionSignsInWithoutNetwork() async {
        let client = FakeAuthClient()
        let tokens = InMemoryTokenStore(StoredSession(accessToken: "a", refreshToken: "r",
                                                      expiresAt: t0.addingTimeInterval(600)))
        let store = SessionStore(client: client, tokens: tokens, now: { t0 })
        await store.restore()
        #expect(store.state == .signedIn)
        #expect(client.refreshedWith.isEmpty)
    }

    @Test func expiredSessionIsRefreshedAndRotatedTokenStored() async {
        let client = FakeAuthClient()
        let tokens = InMemoryTokenStore(StoredSession(accessToken: "old", refreshToken: "r-old",
                                                      expiresAt: t0.addingTimeInterval(-10)))
        let store = SessionStore(client: client, tokens: tokens, now: { t0 })
        await store.restore()
        #expect(client.refreshedWith == ["r-old"])
        #expect(store.state == .signedIn)
        // Supabase rotates refresh tokens: the new one must replace the old one.
        #expect(tokens.load()?.refreshToken == "r2")
        #expect(tokens.load()?.accessToken == "a2")
    }

    @Test func rejectedRefreshSignsOutAndClearsKeychain() async {
        let client = FakeAuthClient()
        client.refreshResult = .failure(.sessionRejected)
        let tokens = InMemoryTokenStore(StoredSession(accessToken: "old", refreshToken: "r-old",
                                                      expiresAt: t0.addingTimeInterval(-10)))
        let store = SessionStore(client: client, tokens: tokens, now: { t0 })
        await store.restore()
        #expect(store.state == .signedOut)
        #expect(tokens.load() == nil)
    }

    @Test func offlineRefreshKeepsMemberSignedIn() async {
        let client = FakeAuthClient()
        client.refreshResult = .failure(.network)
        let tokens = InMemoryTokenStore(StoredSession(accessToken: "old", refreshToken: "r-old",
                                                      expiresAt: t0.addingTimeInterval(-10)))
        let store = SessionStore(client: client, tokens: tokens, now: { t0 })
        await store.restore()
        #expect(store.state == .signedIn)
        #expect(tokens.load()?.refreshToken == "r-old")
    }

    @Test func emailIsNormalisedAndValidatedBeforeSending() async throws {
        let client = FakeAuthClient()
        let store = SessionStore(client: client, tokens: InMemoryTokenStore(), now: { t0 })
        try await store.sendCode(to: "  Runner@Example.COM ")
        #expect(client.sent == ["runner@example.com"])
        await #expect(throws: AuthError.invalidEmail) { try await store.sendCode(to: "not-an-email") }
        #expect(client.sent.count == 1)
    }

    @Test func verifyStoresSessionAndSignsIn() async throws {
        let client = FakeAuthClient()
        let tokens = InMemoryTokenStore()
        let store = SessionStore(client: client, tokens: tokens, now: { t0 })
        try await store.verify(code: "123 456", email: "runner@example.com")
        #expect(client.verified.first?.code == "123456")
        #expect(store.state == .signedIn)
        #expect(tokens.load()?.expiresAt == t0.addingTimeInterval(3600))
    }

    @Test func shortCodeIsRejectedLocally() async {
        let client = FakeAuthClient()
        let store = SessionStore(client: client, tokens: InMemoryTokenStore(), now: { t0 })
        await #expect(throws: AuthError.badCode) { try await store.verify(code: "123", email: "a@b.co") }
        #expect(client.verified.isEmpty)
    }

    @Test func signOutClearsEverything() async throws {
        let tokens = InMemoryTokenStore()
        let store = SessionStore(client: FakeAuthClient(), tokens: tokens, now: { t0 })
        try await store.verify(code: "123456", email: "runner@example.com")
        store.signOut()
        #expect(store.state == .signedOut)
        #expect(store.session == nil)
        #expect(tokens.load() == nil)
    }
}
