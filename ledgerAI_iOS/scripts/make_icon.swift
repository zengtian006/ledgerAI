import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Generates the 1024x1024 app icon: green gradient with a white receipt.
//   swift scripts/make_icon.swift LedgerAI/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png
let size = 1024
let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!

let gradient = CGGradient(colorsSpace: cs, colors: [
    CGColor(red: 0.30, green: 0.85, blue: 0.39, alpha: 1),
    CGColor(red: 0.12, green: 0.66, blue: 0.29, alpha: 1),
] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: CGFloat(size)), end: CGPoint(x: CGFloat(size), y: 0), options: [])

// Receipt body with a zig-zag bottom edge
let w: CGFloat = 480, h: CGFloat = 620
let x0 = (CGFloat(size) - w) / 2, y0 = (CGFloat(size) - h) / 2 - 10
let teeth = 6
let tooth = w / CGFloat(teeth)
let path = CGMutablePath()
path.move(to: CGPoint(x: x0, y: y0 + h))
path.addLine(to: CGPoint(x: x0 + w, y: y0 + h))
path.addLine(to: CGPoint(x: x0 + w, y: y0 + 40))
for i in 0..<teeth {
    let right = x0 + w - CGFloat(i) * tooth
    path.addLine(to: CGPoint(x: right - tooth / 2, y: y0))
    path.addLine(to: CGPoint(x: right - tooth, y: y0 + 40))
}
path.closeSubpath()
ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 36, color: CGColor(gray: 0, alpha: 0.25))
ctx.setFillColor(CGColor(gray: 1, alpha: 1))
ctx.addPath(path)
ctx.fillPath()
ctx.setShadow(offset: .zero, blur: 0, color: nil)

// Text lines
ctx.setStrokeColor(CGColor(red: 0.12, green: 0.66, blue: 0.29, alpha: 1))
ctx.setLineWidth(34)
ctx.setLineCap(.round)
let left = x0 + 80
let lengths: [CGFloat] = [320, 320, 190]
for (i, len) in lengths.enumerated() {
    let y = y0 + h - 150 - CGFloat(i) * 105
    ctx.move(to: CGPoint(x: left, y: y))
    ctx.addLine(to: CGPoint(x: left + len, y: y))
    ctx.strokePath()
}

let image = ctx.makeImage()!
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, image, nil)
CGImageDestinationFinalize(dest)
print("wrote \(url.path)")
