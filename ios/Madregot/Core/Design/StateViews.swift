import SwiftUI

/// Loading / empty / failed / loaded, in the club's look (PWA empty cards, pill retry).
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
            ProgressView().controlSize(.large).tint(Theme.brand)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("state-loading")
        case .empty:
            BrandEmptyState(icon: emptyIcon, title: emptyTitle, message: emptyMessage)
                .accessibilityIdentifier("state-empty")
        case .failed(let message):
            BrandEmptyState(icon: "wifi.exclamationmark", title: "משהו השתבש", message: message,
                            actionTitle: "נסו שוב") { Task { await retry() } }
                .accessibilityIdentifier("state-failed")
        case .loaded(let value):
            content(value)
        }
    }
}

/// The PWA's empty card: brand-tinted icon disc, Heebo black title, muted copy, optional pill.
struct BrandEmptyState: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(Theme.brand)
                .frame(width: 72, height: 72)
                .background(Theme.brand.opacity(0.1), in: .circle)
            Text(title).font(Theme.font(22, .black)).foregroundStyle(Theme.ink900)
            Text(message).font(Theme.font(15, .regular)).foregroundStyle(Theme.ink500)
                .multilineTextAlignment(.center)
            if let actionTitle, let action {
                Button(actionTitle, action: action).buttonStyle(BrandButtonStyle()).padding(.top, 6)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .background(Theme.card, in: .rect(cornerRadius: Theme.radius))
        .padding(Theme.gutter)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Every tab's shell: page background and the PWA top bar (title on the start side,
/// the club mark on the end side). Drawn in content, not as toolbar items, so iOS 26
/// doesn't wrap them in glass bubbles; the stock bar stays hidden on the tab root.
struct BrandScreen: ViewModifier {
    let title: String
    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.page)
            .safeAreaInset(edge: .top, spacing: 0) {
                HStack {
                    Text(title).font(Theme.font(28, .black)).foregroundStyle(Theme.ink900)
                    Spacer()
                    ClubMark(size: 40)
                }
                .padding(.horizontal, Theme.gutter)
                .padding(.vertical, 10)
                .background(Theme.page)
            }
            .toolbar(.hidden, for: .navigationBar)
    }
}

extension View {
    func brandScreen(_ title: String) -> some View { modifier(BrandScreen(title: title)) }
}
