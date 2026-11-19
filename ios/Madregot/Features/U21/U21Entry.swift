import SafariServices
import SwiftUI

/// "Madregot Personal Coach · U21" — the section at the bottom of the registration screen.
/// The flow itself is the web /u21 page, opened in SFSafariViewController. In Debug that is
/// the protected u21-personal-coach preview: Vercel's sign-in appears inside the sheet, and
/// no protection-bypass secret exists anywhere in the app.
struct U21EntryCard: View {
    var compact = false
    @State private var showFlow = false

    var body: some View {
        Button { showFlow = true } label: {
            HStack(spacing: 14) {
                Text("U21")
                    .font(Theme.font(compact ? 15 : 17, .black))
                    .foregroundStyle(Theme.brand)
                    .frame(width: compact ? 44 : 52, height: compact ? 44 : 52)
                    .background(.white, in: .rect(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Madregot Personal Coach")
                        .font(Theme.font(compact ? 15 : 17, .black)).foregroundStyle(.white)
                    Text("בלי סטראבה או גוגל · בוחרים מסלול ונכנסים")
                        .font(Theme.font(13, .semibold)).foregroundStyle(.white.opacity(0.85))
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.left")
                    .font(.system(size: 14, weight: .bold)).foregroundStyle(.white.opacity(0.8))
            }
            .padding(compact ? 12 : 16)
            .frame(maxWidth: .infinity)
            .background(Theme.brand, in: .rect(cornerRadius: compact ? 18 : Theme.radius))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("open-u21")
        .sheet(isPresented: $showFlow) {
            InAppBrowser(url: AppConfig.current.u21URL).ignoresSafeArea()
        }
    }
}

/// SFSafariViewController: the system in-app browser (its own cookies, Safari's UI,
/// no web code in the app). Tinted with the club blue.
struct InAppBrowser: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let vc = SFSafariViewController(url: url)
        vc.preferredControlTintColor = UIColor(Theme.brand)
        vc.dismissButtonStyle = .close
        return vc
    }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}
