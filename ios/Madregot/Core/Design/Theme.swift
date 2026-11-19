import SwiftUI

/// Small, deliberate palette: one accent for the primary action, calm surfaces, big numbers.
enum Theme {
    static let accent = Color(red: 0.12, green: 0.55, blue: 0.42)        // club green
    static let surface = Color(.secondarySystemBackground)
    static let radius: CGFloat = 24
    static let gutter: CGFloat = 20

    /// Group identity mirrors the web's resolveGroup(): 1 green/fast, 2 yellow, 3 orange.
    static func groupColor(_ group: Int) -> Color {
        switch group {
        case 1: Color(red: 0.13, green: 0.62, blue: 0.40)
        case 2: Color(red: 0.86, green: 0.66, blue: 0.10)
        default: Color(red: 0.93, green: 0.48, blue: 0.16)
        }
    }
}

extension View {
    func card() -> some View {
        padding(Theme.gutter)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: .rect(cornerRadius: Theme.radius))
    }
}
