import Foundation

/// One authorized GET against the club API (Bearer JWT), mapped to the user-facing
/// reasons every screen shows. Shared by the Profile, Today and Feed clients.
struct AuthorizedGet: Sendable {
    let config: AppConfig
    var session: URLSession = .shared

    func json(_ path: String, query: [String: String] = [:], token: String) async -> Result<[String: Any], FailureText> {
        var components = URLComponents(url: config.apiBaseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 || status == 403 { return .failure(FailureText("צריך להתחבר מחדש.")) }
            guard (200..<300).contains(status),
                  let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                return .failure(FailureText("משהו השתבש. נסו שוב."))
            }
            return .success(json)
        } catch {
            return .failure(FailureText(Connectivity.isOffline(error) ? Connectivity.offlineMessage : Connectivity.serverUnavailableMessage))
        }
    }
}

/// A user-facing reason, carried through `Result` (which needs an `Error`).
struct FailureText: Error, Sendable { let text: String; init(_ text: String) { self.text = text } }

/// NSNumber reads 4, 4.0 and 34.6 alike — JSON does not promise which one arrives.
func jsonNumber(_ any: Any?) -> Double? { (any as? NSNumber)?.doubleValue }
