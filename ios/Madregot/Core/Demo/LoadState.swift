import Foundation

/// Every data screen is in exactly one of these. Screens render all four, so wiring real
/// data later means replacing the loader, not the view.
enum LoadState<Value: Sendable>: Sendable {
    case loading
    case loaded(Value)
    case empty
    case failed(String)
}

extension LoadState: Equatable where Value: Equatable {}

/// Which state the demo screens show, so each one can be reviewed without a server.
enum DemoScenario: String, CaseIterable, Identifiable, Sendable {
    case normal, empty, failing, slow
    var id: String { rawValue }

    var label: String {
        switch self {
        case .normal: "רגיל"
        case .empty: "ריק"
        case .failing: "שגיאה"
        case .slow: "טעינה איטית"
        }
    }
}
