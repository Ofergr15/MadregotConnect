import SwiftUI

struct FeedView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                "הפיד",
                systemImage: "list.bullet.rectangle",
                description: Text("כאן יופיעו הריצות של חברי המועדון.")
            )
            .navigationTitle("פיד")
        }
    }
}
