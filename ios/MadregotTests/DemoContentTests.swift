import Testing
@testable import Madregot

struct DemoContentTests {
    @Test func normalLoadsEveryScreen() async {
        let demo = DemoContent(scenario: .normal)
        #expect(await demo.today() == .loaded(DemoContent.workout))
        #expect(await demo.feed() == .loaded(DemoContent.runs))
        #expect(await demo.profile() == .loaded(DemoContent.summary))
    }

    @Test func emptyAndFailingReachEveryScreen() async {
        #expect(await DemoContent(scenario: .empty).feed() == .empty)
        #expect(await DemoContent(scenario: .empty).today() == .empty)
        guard case .failed = await DemoContent(scenario: .failing).profile() else {
            Issue.record("failing scenario should fail"); return
        }
    }

    @Test func demoRunsHaveOneSplitPerKilometre() {
        for run in DemoContent.runs {
            #expect(run.splits.count == Int(run.distanceKm.rounded()), "\(run.name)")
        }
    }
}
