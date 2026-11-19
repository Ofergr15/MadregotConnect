import SwiftUI
import UIKit

/// Madregot's design language, mirrored from the PWA (tailwind.config.ts) — not a native
/// reinterpretation. Change a value here only if the web token changes.
enum Theme {
    // Colours — tailwind.config.ts `colors`
    static let brand = Color(hex: 0x1525FF)        // brand-600: headings, fills, active pills
    static let brandPressed = Color(hex: 0x0F1CCC) // brand-700
    static let ink900 = Color(hex: 0x1D1E26)
    static let ink700 = Color(hex: 0x2D2E38)       // body text
    static let ink500 = Color(hex: 0x4F4F4F)       // muted captions
    static let ink300 = Color(hex: 0xBBBBBB)       // hairlines
    static let page = Color(hex: 0xDFDFDF)         // page background and inner stat tiles
    static let canvas = Color(hex: 0xF0F0F0)       // landing / sign-in background (bg-[#f0f0f0])
    static let card = Color.white                  // every raised surface
    static let danger = Color(hex: 0xDC2626)       // accent-red

    /// Kept for existing call sites: the club's primary is brand blue.
    static let accent = brand
    static let surface = card

    // Shape — tailwind `borderRadius`: 25px cards, 50px pills; rounded-xl inputs
    static let radius: CGFloat = 25
    static let inputRadius: CGFloat = 12
    static let controlHeight: CGFloat = 52
    static let gutter: CGFloat = 20

    /// Group identity mirrors the web's resolveGroup(): 1 green/fast, 2 yellow, 3 orange.
    static func groupColor(_ group: Int) -> Color {
        switch group {
        case 1: Color(red: 0.13, green: 0.62, blue: 0.40)
        case 2: Color(red: 0.86, green: 0.66, blue: 0.10)
        default: Color(red: 0.93, green: 0.48, blue: 0.16)
        }
    }

    /// The PWA's font is Heebo (next/font, `font-sans`). Used when the font file is bundled;
    /// until then the system font, at the same sizes and weights.
    static func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        if UIFont(name: "Heebo", size: size) != nil {
            return .custom("Heebo", size: size).weight(weight)
        }
        return .system(size: size, weight: weight)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

extension View {
    func card() -> some View {
        padding(Theme.gutter)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: .rect(cornerRadius: Theme.radius))
    }
}

/// The PWA's primary button: `min-h-[52px] rounded-pill bg-brand-600 font-black text-white`.
struct BrandButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.font(16, .black))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: Theme.controlHeight)
            .background(configuration.isPressed ? Theme.brandPressed : Theme.brand, in: .capsule)
            .opacity(isEnabled ? 1 : 0.5)
    }
}

/// The PWA's field: `h-[52px] rounded-xl border border-page bg-card text-ink-700`.
struct BrandFieldStyle: ViewModifier {
    var height: CGFloat = Theme.controlHeight
    func body(content: Content) -> some View {
        content
            .foregroundStyle(Theme.ink700)
            .padding(.horizontal, 16)
            .frame(minHeight: height)
            .background(Theme.card, in: .rect(cornerRadius: Theme.inputRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.inputRadius).stroke(Theme.page, lineWidth: 1))
    }
}

/// The nav bar's mark: the club's white logo on a brand-blue rounded square.
struct ClubMark: View {
    var size: CGFloat = 72
    var body: some View {
        Image("ClubLogoWhite")
            .resizable()
            .scaledToFit()
            .padding(size * 0.18)
            .frame(width: size, height: size)
            .background(Theme.brand, in: .rect(cornerRadius: size * 0.27))
            .shadow(color: Theme.brand.opacity(0.25), radius: 12, y: 6)
            .accessibilityLabel("Madregot After 2KM")
    }
}
