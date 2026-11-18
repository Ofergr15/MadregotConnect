import SwiftUI

struct TodayView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                "האימון של היום",
                systemImage: "calendar",
                description: Text("כאן יופיע האימון מהתוכנית השבועית.")
            )
            .navigationTitle("היום")
        }
    }
}
