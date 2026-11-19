import Foundation

/// What can go wrong signing in, as the server reports it (`/api/auth/email-code`).
enum AuthError: Error, Equatable, Sendable {
    case invalidEmail
    case tooManyCodes
    case wrongCode(attemptsLeft: Int?)
    case expired
    case badCode
    case notReady
    case sessionRejected
    case notConfigured
    case network
    /// Online, but the club's server did not answer (down, or a dev build pointed elsewhere).
    case serverUnavailable
    case server(status: Int)

    /// Hebrew, for the sign-in screen.
    var message: String {
        switch self {
        case .invalidEmail: "כתובת המייל לא נראית תקינה."
        case .tooManyCodes: "נשלחו יותר מדי קודים. נסו שוב בעוד רבע שעה."
        case .wrongCode(let left?) where left > 0: "הקוד לא נכון. נשארו \(left) ניסיונות."
        case .wrongCode: "הקוד לא נכון. בקשו קוד חדש."
        case .expired: "הקוד פג תוקף. בקשו קוד חדש."
        case .badCode: "הקוד צריך להיות 6 ספרות."
        case .notReady: "ההתחברות עם קוד עוד לא זמינה. נסו שוב מאוחר יותר."
        case .sessionRejected: "צריך להתחבר מחדש."
        case .notConfigured: "האפליקציה לא מוגדרת לשרת."
        case .network: Connectivity.offlineMessage
        case .serverUnavailable: Connectivity.serverUnavailableMessage
        case .server: "משהו השתבש. נסו שוב."
        }
    }
}

/// The session the server mints on a successful code (`session` in the verify response).
struct IssuedSession: Equatable, Sendable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: TimeInterval
    let athleteId: String?
    let email: String?

    func stored(now: Date = .now) -> StoredSession {
        StoredSession(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: now.addingTimeInterval(expiresIn),
            athleteId: athleteId,
            email: email
        )
    }
}

protocol AuthClient: Sendable {
    func sendCode(to email: String) async throws(AuthError)
    func verifyCode(_ code: String, email: String) async throws(AuthError) -> IssuedSession
    func refresh(refreshToken: String) async throws(AuthError) -> IssuedSession
}

/// Talks to the existing server routes; no server change is needed for these calls.
///
/// - `POST {api}/api/auth/email-code` `{action:"send"|"verify", email, code}`
/// - `POST {supabase}/auth/v1/token?grant_type=refresh_token` with the public anon key.
///   Supabase rotates the refresh token on every refresh; the caller must store the new one.
struct HTTPAuthClient: AuthClient {
    let config: AppConfig
    var session: URLSession = .shared

    func sendCode(to email: String) async throws(AuthError) {
        _ = try await postEmailCode(["action": "send", "email": email])
    }

    func verifyCode(_ code: String, email: String) async throws(AuthError) -> IssuedSession {
        let json = try await postEmailCode(["action": "verify", "email": email, "code": code])
        guard let s = json["session"] as? [String: Any],
              let access = s["access_token"] as? String,
              let refresh = s["refresh_token"] as? String else { throw .server(status: 200) }
        return IssuedSession(
            accessToken: access,
            refreshToken: refresh,
            expiresIn: (s["expires_in"] as? Double) ?? 3600,
            athleteId: json["athleteId"] as? String,
            email: json["email"] as? String
        )
    }

    func refresh(refreshToken: String) async throws(AuthError) -> IssuedSession {
        guard let base = config.supabaseURL, let anonKey = config.supabaseAnonKey else {
            throw .notConfigured
        }
        var components = URLComponents(url: base.appending(path: "auth/v1/token"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token")]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])

        let (status, json) = try await send(request)
        // 400/401 from GoTrue means the refresh token is spent, revoked or unknown.
        if status == 400 || status == 401 { throw .sessionRejected }
        guard (200..<300).contains(status),
              let access = json["access_token"] as? String,
              let newRefresh = json["refresh_token"] as? String else { throw .server(status: status) }
        let user = json["user"] as? [String: Any]
        let metadata = user?["user_metadata"] as? [String: Any]
        return IssuedSession(
            accessToken: access,
            refreshToken: newRefresh,
            expiresIn: (json["expires_in"] as? Double) ?? 3600,
            athleteId: metadata?["athlete_id"] as? String,
            email: user?["email"] as? String
        )
    }

    // MARK: - Plumbing

    private func postEmailCode(_ body: [String: String]) async throws(AuthError) -> [String: Any] {
        var request = URLRequest(url: config.apiBaseURL.appending(path: "api/auth/email-code"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        let (status, json) = try await send(request)
        if (200..<300).contains(status) { return json }
        throw Self.mapEmailCodeError(status: status, json: json)
    }

    static func mapEmailCodeError(status: Int, json: [String: Any]) -> AuthError {
        switch json["error"] as? String {
        case "invalid-email": .invalidEmail
        case "too-many": .tooManyCodes
        case "wrong-code": .wrongCode(attemptsLeft: json["left"] as? Int)
        case "expired": .expired
        case "bad-code": .badCode
        case "not-ready": .notReady
        default: .server(status: status)
        }
    }

    private func send(_ request: URLRequest) async throws(AuthError) -> (Int, [String: Any]) {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw Connectivity.isOffline(error) ? .network : .serverUnavailable
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        return (status, json)
    }
}
