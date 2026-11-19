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

    @Test func todayWithoutAPlanIsEmpty() {
        let state = HTTPTodayClient.parse(["hasPlan": false, "sessions": []], now: .now)
        guard case .empty = state else { Issue.record("expected empty"); return }
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
        guard case .loaded(let w) = HTTPTodayClient.parse(json, now: now) else { Issue.record("not loaded"); return }
        #expect(w.title == "טמפו")
        #expect(w.distanceKm == 12)
        #expect(w.blocks.count == 1)
        #expect(w.weekTargetKm == 60)
    }
}
