// Generates the Venture splash asset (approved mock 4): brand-purple
// ground, the wander line (solid run + faint echo, same phase, never
// crossing), and the Venture wordmark. 1024x1024 PNG.
import AppKit
import CoreGraphics
import Foundation

let size = 1024
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
guard
  let ctx = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
else {
  fatalError("no context")
}

// Work top-down, like the mock's coordinates
ctx.translateBy(x: 0, y: CGFloat(size))
ctx.scaleBy(x: 1, y: -1)

// Ground: BrandPurple #6A4BDB
ctx.setFillColor(
  CGColor(srgbRed: 0x6A / 255.0, green: 0x4B / 255.0, blue: 0xDB / 255.0, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))

// One wander run: the mock's cubic chain — each half-period spans H
// horizontally with horizontal tangents at both ends, so the joins are
// smooth. Alternates crest and trough, entering off-left, exiting
// off-right.
func wanderRun(crestY: CGFloat, troughY: CGFloat, halfPeriod H: CGFloat, startX: CGFloat,
               stroke: CGFloat, alpha: CGFloat) {
  let path = CGMutablePath()
  var x = startX
  var y = crestY
  path.move(to: CGPoint(x: x, y: y))
  while x < CGFloat(size) + H {
    let nextY = (y == crestY) ? troughY : crestY
    path.addCurve(
      to: CGPoint(x: x + H, y: nextY),
      control1: CGPoint(x: x + H / 2, y: y),
      control2: CGPoint(x: x + H / 2, y: nextY))
    x += H
    y = nextY
  }
  ctx.addPath(path)
  ctx.setStrokeColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: alpha))
  ctx.setLineWidth(stroke)
  ctx.setLineCap(.round)
  ctx.setLineJoin(.round)
  ctx.strokePath()
}

// The solid run across the upper third, and the echo below it in the
// same phase (a constant vertical offset — parallel, never crossing)
let stroke: CGFloat = 52
wanderRun(crestY: 200, troughY: 460, halfPeriod: 210, startX: -80, stroke: stroke, alpha: 0.92)
wanderRun(crestY: 380, troughY: 640, halfPeriod: 210, startX: -80, stroke: stroke, alpha: 0.30)

// The wordmark, centered in the lower third
NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)
let wordmark = "Venture" as NSString
let font = NSFont.systemFont(ofSize: 84, weight: .heavy)
let attributes: [NSAttributedString.Key: Any] = [
  .font: font,
  .foregroundColor: NSColor.white,
  .kern: 1.5,
]
let textSize = wordmark.size(withAttributes: attributes)
wordmark.draw(
  at: NSPoint(x: (CGFloat(size) - textSize.width) / 2, y: 790 - textSize.height / 2),
  withAttributes: attributes)
NSGraphicsContext.current = nil

guard let image = ctx.makeImage() else { fatalError("no image") }
let rep = NSBitmapImageRep(cgImage: image)
guard let png = rep.representation(using: .png, properties: [:]) else { fatalError("no png") }
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "splash-wander.png"
try png.write(to: URL(fileURLWithPath: out))
print("wrote \(out) (\(png.count) bytes)")

// Usage: swift scripts/make-splash.swift assets/images/splash-wander.png
