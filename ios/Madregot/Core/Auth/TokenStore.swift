import Foundation
import Security

/// The stored part of a session. Only the refresh token is long-lived; the access token
/// is kept too so a cold start within its lifetime needs no network round trip.
struct StoredSession: Codable, Equatable, Sendable {
    var accessToken: String
    var refreshToken: String
    /// When the access token stops working.
    var expiresAt: Date
    var athleteId: String?
    var email: String?

    func isAccessTokenFresh(now: Date = .now, leeway: TimeInterval = 60) -> Bool {
        expiresAt.timeIntervalSince(now) > leeway
    }
}

protocol TokenStore: Sendable {
    func load() -> StoredSession?
    func save(_ session: StoredSession) throws
    func clear()
}

/// Keychain-backed store. `AfterFirstUnlockThisDeviceOnly`: readable for background refresh
/// after the first unlock, never synced to iCloud and never restored from a backup onto
/// another device — the club shares phones, and a session must not travel with a backup.
struct KeychainTokenStore: TokenStore {
    var service = "app.madregot.ios.session"
    var account = "supabase"

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func load() -> StoredSession? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(StoredSession.self, from: data)
    }

    func save(_ session: StoredSession) throws {
        let data = try JSONEncoder().encode(session)
        SecItemDelete(baseQuery as CFDictionary)
        var attributes = baseQuery
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}

struct KeychainError: Error, Equatable {
    let status: OSStatus
}

/// For tests and previews.
final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var session: StoredSession?

    init(_ session: StoredSession? = nil) { self.session = session }

    func load() -> StoredSession? { lock.withLock { session } }
    func save(_ session: StoredSession) throws { lock.withLock { self.session = session } }
    func clear() { lock.withLock { session = nil } }
}
