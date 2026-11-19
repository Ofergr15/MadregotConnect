import Testing
import Foundation
@testable import Madregot

struct ProfileClientTests {
    @Test func parsesNameAndThisWeekFromTheTwoRoutes() {
        let me: [String: Any] = ["athlete": ["id": "a1", "name": "נועה בדיקה"]]
        let summary: [String: Any] = ["thisWeek": ["km": 34.6, "runs": 4], "weekStreak": 12]
        let parsed = HTTPProfileClient.parse(me: me, summary: summary)
        #expect(parsed?.name == "נועה בדיקה")
        #expect(parsed?.weekKm == 35)
        #expect(parsed?.weekRuns == 4)
        #expect(parsed?.streakDays == 12)
    }

    @Test func aWeekWithNoRunsIsZeroNotAFailure() {
        let parsed = HTTPProfileClient.parse(me: ["athlete": ["name": "דני"]], summary: [:])
        #expect(parsed?.weekKm == 0 && parsed?.weekRuns == 0)
    }

    @Test func aMissingAthleteIsUnreadable() {
        #expect(HTTPProfileClient.parse(me: [:], summary: [:]) == nil)
    }
}

struct ConnectivityTests {
    @Test func onlyADeviceWithoutNetworkIsOffline() {
        #expect(Connectivity.isOffline(URLError(.notConnectedToInternet)))
        #expect(!Connectivity.isOffline(URLError(.cannotConnectToHost)))   // online, server not there
        #expect(!Connectivity.isOffline(URLError(.timedOut)))
    }

    @Test func authSaysServerUnavailableWhenOnlineButTheServerIsNotThere() {
        #expect(AuthError.serverUnavailable.message == Connectivity.serverUnavailableMessage)
        #expect(AuthError.network.message == Connectivity.offlineMessage)
    }
}
