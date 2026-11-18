import Foundation
import Testing
@testable import Madregot

struct DataSourcesParseTests {
    @Test func readsServerConnectionStates() {
        let status = HTTPDataSourcesClient.parse([
            "hasGarmin": true, "hasStrava": true,
            "garminState": "ok", "stravaState": "failed",
            "garminLastSyncAt": "2026-11-18T05:00:00.000Z",
            "stravaLastSyncAt": NSNull(),
            "data_source": "garmin",
        ])
        #expect(status.garmin == .ok)
        #expect(status.strava == .failed)
        #expect(status.strava.needsAttention)
        #expect(status.garminLastSync == ISO8601DateFormatter().date(from: "2026-11-18T05:00:00Z"))
        #expect(status.stravaLastSync == nil)
        #expect(status.primarySource == "garmin")
        #expect(status.hasAnySource)
    }

    @Test func fallsBackToBooleansOnOlderServers() {
        let status = HTTPDataSourcesClient.parse(["hasGarmin": true, "hasStrava": false])
        #expect(status.garmin == .unknown)
        #expect(status.strava == .none)
    }

    @Test func nothingConnected() {
        let status = HTTPDataSourcesClient.parse(["garminState": "none", "stravaState": "none"])
        #expect(!status.hasAnySource)
        #expect(ConnectionState.none.label == "לא מחובר")
    }
}

private func json(_ object: Any) -> Data { try! JSONSerialization.data(withJSONObject: object) }

extension NetworkStubTests {
@Suite struct HTTPDataSourcesClientTests {
    let client: HTTPDataSourcesClient

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        client = HTTPDataSourcesClient(
            config: AppConfig(apiBaseURL: URL(string: "http://localhost:3000")!, supabaseURL: nil, supabaseAnonKey: nil),
            session: URLSession(configuration: configuration)
        )
    }

    @Test func sendsBearerTokenForOwnAthlete() async throws {
        StubURLProtocol.handler = { _ in (200, json(["athlete": ["garminState": "ok", "stravaState": "none"]])) }
        let status = try await client.status(athleteId: "ath-1", accessToken: "JWT")
        let request = try #require(StubURLProtocol.requests.last)
        #expect(request.url?.absoluteString == "http://localhost:3000/api/athletes/me?id=ath-1")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer JWT")
        #expect(status.garmin == .ok)
    }

    @Test func unauthorizedMeansSignedOut() async {
        StubURLProtocol.handler = { _ in (401, json(["error": "unauthorized"])) }
        await #expect(throws: DataSourcesError.signedOut) {
            _ = try await client.status(athleteId: "ath-1", accessToken: "JWT")
        }
        StubURLProtocol.handler = { _ in (500, Data()) }
        await #expect(throws: DataSourcesError.server) {
            _ = try await client.status(athleteId: "ath-1", accessToken: "JWT")
        }
    }
}
}
