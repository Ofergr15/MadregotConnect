import Foundation
import Testing
@testable import Madregot

struct ClubClientsTests {
    @Test func feedActivityItemBecomesARun() throws {
        let item: [String: Any] = [
            "id": "f5a1", "type": "activity", "likeCount": 2, "occurredAt": "2026-11-17T06:10:00+00:00",
            "author": ["name": "נועה בדיקה", "groupName": "קבוצה 1"],
            "activity": ["activityName": "אינטרוולים", "distance": 12100, "duration": 2930,
                         "averagePace": 242, "startTime": "2026-11-17T06:10:00+00:00"],
        ]
        let run = try #require(HTTPFeedClient.run(item))
        #expect(run.name == "נועה בדיקה")
        #expect(run.initials == "נב")
        #expect(run.group == 1)
        #expect(run.distanceKm == 12.1)
        #expect(run.pace == "4:02")
        #expect(run.durationLabel == "48:50")
        #expect(run.kudos == 2)
        #expect(run.when.hasSuffix("06:10"))   // wall clock, not shifted to the device zone
    }

    @Test func nonActivityAndEmptyItemsAreSkipped() {
        #expect(HTTPFeedClient.run(["id": "p", "type": "post", "author": [:]]) == nil)
        #expect(HTTPFeedClient.run(["id": "a", "type": "activity", "author": [:], "activity": ["distance": 0]]) == nil)
    }

    @Test func clockFormats() {
        #expect(HTTPFeedClient.clock(242) == "4:02")
        #expect(HTTPFeedClient.clock(6570) == "1:49:30")
    }

    @Test func noPlanIsNotARestDay() {
        let state = HTTPTodayClient.parse(["hasPlan": false, "sessions": []], now: .now)
        guard case .loaded(.noPlan) = state else { Issue.record("expected noPlan, got \(state)"); return }
    }

    @Test func aPlanWithNothingTodayIsARestDay() throws {
        let now = try #require(ISO8601DateFormatter().date(from: "2026-11-19T10:00:00Z"))
        let json: [String: Any] = ["hasPlan": true, "currentWeekStart": "2026-11-15",
                                   "sessions": [["dayOfWeek": 3, "name": "קל", "kmMin": 8, "kmMax": 8]]]
        guard case .loaded(.restDay) = HTTPTodayClient.parse(json, now: now) else { Issue.record("expected restDay"); return }
    }

    @Test func feedRunCarriesItemIdAndLikedState() throws {
        let run = try #require(HTTPFeedClient.run([
            "id": "item-1", "type": "activity", "likeCount": 3, "likedByMe": true,
            "author": ["name": "א ב"], "activity": ["distance": 5000, "duration": 1500],
        ]))
        #expect(run.itemId == "item-1")
        #expect(run.likedByMe)
        #expect(run.kudos == 3)
    }

    @Test func likeAnswerParses() {
        let answer = HTTPLikeClient.parse(["liked": true, "likeCount": 4])
        #expect(answer?.liked == true)
        #expect(answer?.count == 4)
        #expect(HTTPLikeClient.parse(["error": "x"]) == nil)
    }

    @Test func todayPicksTheSessionsDatedToday() throws {
        // Week starts Sunday 2026-11-15; "now" is Thursday 2026-11-19 in Israel → dayOfWeek 4.
        let now = try #require(ISO8601DateFormatter().date(from: "2026-11-19T10:00:00Z"))
        let json: [String: Any] = [
            "hasPlan": true, "currentWeekStart": "2026-11-15", "weekTotalMax": 60,
            "sessions": [
                ["dayOfWeek": 3, "name": "קל", "kmMin": 8, "kmMax": 8],
                ["dayOfWeek": 4, "name": "טמפו", "kmMin": 10, "kmMax": 12],
                ["dayOfWeek": 4, "name": "ערב", "kmMin": 5, "kmMax": 5, "optional": true],
            ],
        ]
        guard case .loaded(.workout(let w)) = HTTPTodayClient.parse(json, now: now) else { Issue.record("not a workout"); return }
        #expect(w.title == "טמפו")
        #expect(w.distanceKm == 12)
        #expect(w.blocks.count == 1)
        #expect(w.weekTargetKm == 60)
    }
}

struct PaceGroupTitleTests {
    @Test func knownBandIsNumbered() {
        #expect(PaceGroup(id: "a", name: "Group 2", index: 1, marathonGoal: nil).title == "קבוצה 2")
    }

    @Test func unrecognisedNameKeepsItsOwnName() {
        // The server's -1 used to render as "קבוצה 0".
        #expect(PaceGroup(id: "a", name: "קבוצה 3", index: -1, marathonGoal: nil).title == "קבוצה 3")
        #expect(PaceGroup(id: "b", name: "Trail", index: nil, marathonGoal: nil).title == "Trail")
    }
}

struct FeedRouteTests {
    @Test func routePreviewParsesToPoints() {
        let r = HTTPFeedClient.route([["lat": 32.08, "lng": 34.78], ["lat": 32.09, "lng": 34.79]])
        #expect(r.count == 2)
        #expect(r.first == RoutePoint(lat: 32.08, lng: 34.78))
    }

    @Test func missingOrBrokenRouteIsNoRoute() {
        #expect(HTTPFeedClient.route(nil).isEmpty)                       // the feed's null
        #expect(HTTPFeedClient.route([["lat": 32.0, "lng": 34.0]]).isEmpty) // one point isn't a line
        #expect(HTTPFeedClient.route([["lat": 99, "lng": 34], ["lat": 32, "lng": 34]]).isEmpty)
    }

    @Test func shapeFitsInsideItsRect() {
        let pts = [RoutePoint(lat: 32.0, lng: 34.0), RoutePoint(lat: 32.01, lng: 34.02), RoutePoint(lat: 32.02, lng: 34.0)]
        let b = RouteShape(points: pts).path(in: CGRect(x: 0, y: 0, width: 100, height: 100)).boundingRect
        #expect(b.minX >= -0.001 && b.maxX <= 100.001 && b.minY >= -0.001 && b.maxY <= 100.001)
    }
}
