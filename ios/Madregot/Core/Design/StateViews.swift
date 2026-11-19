import SwiftUI

/// Renders a LoadState: spinner, empty message, error with retry, or the content.
struct StateView<Value: Sendable, Content: View>: View {
    let state: LoadState<Value>
    let emptyTitle: String
    let emptyIcon: String
    let emptyMessage: String
    let retry: () async -> Void
    @ViewBuilder let content: (Value) -> Content

    var body: some View {
        switch state {
        case .loading:
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("state-loading")
        case .empty:
            ContentUnavailableView(emptyTitle, systemImage: emptyIcon, description: Text(emptyMessage))
                .accessibilityIdentifier("state-empty")
        case .failed(let message):
            ContentUnavailableView {
                Label("משהו השתבש", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("נסו שוב") { Task { await retry() } }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
            }
            .accessibilityIdentifier("state-failed")
        case .loaded(let value):
            content(value)
        }
    }
}
