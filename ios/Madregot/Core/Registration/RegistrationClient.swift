import Foundation

/// A pace group a new member can say they prefer (`GET /api/public/groups`).
struct PaceGroup: Identifiable, Equatable, Sendable, Decodable {
    let id: String
    let name: String
    /// 0-based band: 0 = Group 1 (fast) … 2 = Group 3 (slow).
    let index: Int?
    let marathonGoal: String?

    /// Hebrew label, matching the web form ("קבוצה 1").
    var title: String {
        if let index { return "קבוצה \(index + 1)" }
        return name
    }

    var subtitle: String? {
        guard let goal = marathonGoal, !goal.isEmpty else { return nil }
        return "יעד מרתון \(goal)"
    }
}

/// What the server says about the address that applied (`state` in the signup response).
enum RegistrationOutcome: Equatable, Sendable {
    /// A new request is waiting for the coach.
    case received
    /// This address already had a request waiting; it was updated.
    case alreadyPending
    /// This address already belongs to a club member: sign in instead.
    case alreadyMember
}

struct RegistrationForm: Equatable, Sendable {
    var fullName = ""
    var email = ""
    var phone = ""
    /// Nil = "not sure, the coach decides". The server treats the group as a preference.
    var groupId: String?

    enum Problem: Equatable {
        case nameMissing
        case nameNotLatin
        case emailInvalid
        case phoneTooShort
    }

    /// Mirrors the web form: name required and in Latin letters (it is how the name reads
    /// on the watch and on Strava), phone optional but at least 9 digits when given.
    var problems: [Problem] {
        var out: [Problem] = []
        let name = fullName.trimmingCharacters(in: .whitespaces)
        if name.isEmpty { out.append(.nameMissing) }
        else if Self.hasNonLatinLetters(name) { out.append(.nameNotLatin) }
        if !SessionStore.looksLikeEmail(SessionStore.normalise(email)) { out.append(.emailInvalid) }
        let digits = phone.filter(\.isNumber)
        if !digits.isEmpty && digits.count < 9 { out.append(.phoneTooShort) }
        return out
    }

    static func hasNonLatinLetters(_ text: String) -> Bool {
        text.unicodeScalars.contains { scalar in
            CharacterSet.letters.contains(scalar) && !(("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar))
        }
    }

    /// The request body for `POST /api/public/signup`. Only fields the web form already sends.
    var body: [String: String] {
        var out = [
            "email": SessionStore.normalise(email),
            "fullName": fullName.trimmingCharacters(in: .whitespaces),
        ]
        let trimmedPhone = phone.trimmingCharacters(in: .whitespaces)
        if !trimmedPhone.isEmpty { out["phone"] = trimmedPhone }
        if let groupId { out["groupId"] = groupId }
        return out
    }
}

enum RegistrationError: Error, Equatable, Sendable {
    case invalidEmail
    case network
    case serverUnavailable
    case server

    var message: String {
        switch self {
        case .invalidEmail: "כתובת המייל לא נראית תקינה."
        case .network: Connectivity.offlineMessage
        case .serverUnavailable: Connectivity.serverUnavailableMessage
        case .server: "ההרשמה נכשלה. נסו שוב."
        }
    }
}

protocol RegistrationClient: Sendable {
    func groups() async -> [PaceGroup]
    func submit(_ form: RegistrationForm) async throws(RegistrationError) -> RegistrationOutcome
}

/// The existing public routes the web /register page uses; no server change.
struct HTTPRegistrationClient: RegistrationClient {
    let config: AppConfig
    var session: URLSession = .shared

    /// An empty list is a usable form (the group is optional), so failures return [].
    func groups() async -> [PaceGroup] {
        struct Response: Decodable { let groups: [PaceGroup] }
        let url = config.apiBaseURL.appending(path: "api/public/groups")
        guard let (data, response) = try? await session.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let decoded = try? JSONDecoder().decode(Response.self, from: data) else { return [] }
        return decoded.groups.sorted { ($0.index ?? .max) < ($1.index ?? .max) }
    }

    func submit(_ form: RegistrationForm) async throws(RegistrationError) -> RegistrationOutcome {
        var request = URLRequest(url: config.apiBaseURL.appending(path: "api/public/signup"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: form.body)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw Connectivity.isOffline(error) ? .network : .serverUnavailable
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if json["error"] as? String == "invalid-email" { throw .invalidEmail }
        guard (200..<300).contains(status) else { throw .server }
        switch json["state"] as? String {
        case "member": return .alreadyMember
        case "pending": return .alreadyPending
        default: return .received
        }
    }
}
