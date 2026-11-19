// Builds the App Store icon (1024×1024, opaque, square corners; iOS applies its own mask)
// from any square-ish source image.
//
//   swift ios/scripts/make-app-icon.swift <source.png> [background-hex]
//
// Writes ios/Madregot/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png.
// To swap in a better logo later: drop the new file in ios/Design/AppIcon/ and rerun.
import AppKit

let args = CommandLine.arguments
guard args.count >= 2, let source = NSImage(contentsOfFile: args[1]) else {
    FileHandle.standardError.write("usage: make-app-icon.swift <source.png> [hex]\n".data(using: .utf8)!)
    exit(1)
}
let hex = args.count >= 3 ? args[2] : "FFFFFF"
let v = UInt32(hex, radix: 16) ?? 0xFFFFFF
let bg = CGColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                 blue: CGFloat(v & 0xFF) / 255, alpha: 1)

let side = 1024
let ctx = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!,
                    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!   // no alpha channel
ctx.setFillColor(bg)
ctx.fill(CGRect(x: 0, y: 0, width: side, height: side))
ctx.interpolationQuality = .high

// Fit the source inside the square, centred, keeping its aspect ratio.
var rect = CGRect(origin: .zero, size: source.size)
guard let cg = source.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { exit(1) }
let scale = min(CGFloat(side) / CGFloat(cg.width), CGFloat(side) / CGFloat(cg.height))
let w = CGFloat(cg.width) * scale, h = CGFloat(cg.height) * scale
ctx.draw(cg, in: CGRect(x: (CGFloat(side) - w) / 2, y: (CGFloat(side) - h) / 2, width: w, height: h))

let out = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    .appending(path: "Madregot/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png")
let png = NSBitmapImageRep(cgImage: ctx.makeImage()!).representation(using: .png, properties: [:])!
try! png.write(to: out)
print("wrote \(out.path) from \(cg.width)×\(cg.height) source (×\(String(format: "%.2f", scale)))")
