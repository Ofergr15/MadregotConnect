import Observation

/// Demo-only: which scenario the screens load. Changed from the Profile screen.
@MainActor
@Observable
final class DemoSettings {
    var scenario: DemoScenario = .normal
    var content: DemoContent { DemoContent(scenario: scenario) }
}
