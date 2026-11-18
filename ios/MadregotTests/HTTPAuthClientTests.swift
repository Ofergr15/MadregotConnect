import Foundation
import Testing
@testable import Madregot

/// Answers every request from a handler; records what was sent. No real network.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, Data))?
    nonisolated(unsafe) static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var recorded = request
        if recorded.httpBody == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(buffer, maxLength: 4096)
                if n <= 0 { break }
                data.append(buffer, count: n)
            }
            buffer.deallocate()
            stream.close()
            recorded.httpBody = data
        }
        Self.requests.append(recorded)
        let (status, body) = Self.handler?(recorded) ?? (500, Data())
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private func json(_ object: Any) -> Data { try! JSONSerialization.data(withJSONObject: object) }

private func body(_ request: URLRequest) -> [String: Any] {
    (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any] ?? [:]
}

/// Every suite that uses StubURLProtocol nests here: its handler is shared static
/// state, and `.serialized` on the parent runs all of them one test at a time.
@Suite(.serialized) struct NetworkStubTests {}

extension NetworkStubTests {
@Suite struct HTTPAuthClientTests {
    let client: HTTPAuthClient

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        client = HTTPAuthClient(
            config: AppConfig(apiBaseURL: URL(string: "http://localhost:3000")!,
                              supabaseURL: URL(string: "https://dev.example.supabase.co")!,
                              supabaseAnonKey: "anon"),
            session: URLSession(configuration: configuration)
        )
        StubURLProtocol.requests = []
    }

    @Test func sendPostsToEmailCodeRoute() async throws {
        StubURLProtocol.handler = { _ in (200, json(["ok": true])) }
        try await client.sendCode(to: "runner@example.com")
        let request = try #require(StubURLProtocol.requests.last)
        #expect(request.url?.absoluteString == "http://localhost:3000/api/auth/email-code")
        #expect(request.httpMethod == "POST")
        #expect(body(request)["action"] as? String == "send")
    }

    @Test func verifyParsesTheServerSession() async throws {
        StubURLProtocol.handler = { _ in
            (200, json(["ok": true, "email": "runner@example.com", "athleteId": "ath-9",
                        "session": ["access_token": "A", "refresh_token": "R", "expires_in": 3600]]))
        }
        let issued = try await client.verifyCode("123456", email: "runner@example.com")
        #expect(issued == IssuedSession(accessToken: "A", refreshToken: "R", expiresIn: 3600,
                                        athleteId: "ath-9", email: "runner@example.com"))
    }

    @Test func serverErrorsMapToHebrewReasons() async {
        StubURLProtocol.handler = { _ in (401, json(["error": "wrong-code", "left": 3])) }
        await #expect(throws: AuthError.wrongCode(attemptsLeft: 3)) {
            _ = try await client.verifyCode("000000", email: "runner@example.com")
        }
        StubURLProtocol.handler = { _ in (429, json(["error": "too-many"])) }
        await #expect(throws: AuthError.tooManyCodes) { try await client.sendCode(to: "a@b.co") }
    }

    @Test func refreshUsesSupabaseTokenEndpointWithAnonKey() async throws {
        StubURLProtocol.handler = { _ in
            (200, json(["access_token": "A2", "refresh_token": "R2", "expires_in": 3600,
                        "user": ["email": "runner@example.com", "user_metadata": ["athlete_id": "ath-9"]]]))
        }
        let issued = try await client.refresh(refreshToken: "R1")
        let request = try #require(StubURLProtocol.requests.last)
        #expect(request.url?.absoluteString == "https://dev.example.supabase.co/auth/v1/token?grant_type=refresh_token")
        #expect(request.value(forHTTPHeaderField: "apikey") == "anon")
        #expect(body(request)["refresh_token"] as? String == "R1")
        #expect(issued.refreshToken == "R2")
        #expect(issued.athleteId == "ath-9")
    }

    @Test func spentRefreshTokenIsSessionRejected() async {
        StubURLProtocol.handler = { _ in (400, json(["error": "invalid_grant"])) }
        await #expect(throws: AuthError.sessionRejected) { _ = try await client.refresh(refreshToken: "R1") }
    }

    @Test func refreshWithoutSupabaseConfigIsNotConfigured() async {
        let bare = HTTPAuthClient(config: AppConfig(info: [:]))
        await #expect(throws: AuthError.notConfigured) { _ = try await bare.refresh(refreshToken: "R1") }
    }
}
}
