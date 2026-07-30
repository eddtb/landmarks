import AppKit

let width = 1320
let height = 2868
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let source = root.appendingPathComponent("app-store/screenshots/en-GB")
let output = root.appendingPathComponent("app-store/screenshots/marketing/en-GB")
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

struct Panel {
  let file: String
  let sourceFile: String
  let headline: String
  let subhead: String
  let topColor: NSColor
  let bottomColor: NSColor
  let textColor: NSColor
  let mutedColor: NSColor
}

let purple = NSColor(calibratedRed: 0.40, green: 0.22, blue: 0.89, alpha: 1)
let ink = NSColor(calibratedRed: 0.07, green: 0.06, blue: 0.10, alpha: 1)
let cream = NSColor(calibratedRed: 0.98, green: 0.97, blue: 0.94, alpha: 1)
let lavender = NSColor(calibratedRed: 0.94, green: 0.91, blue: 1.00, alpha: 1)

let panels = [
  Panel(file: "01-history-all-around-you.png", sourceFile: "01-nearby-greenwich.png",
        headline: "The history\naround you",
        subhead: "Everything within a walk, nearest first.",
        topColor: NSColor(calibratedRed: 0.16, green: 0.08, blue: 0.35, alpha: 1), bottomColor: purple,
        textColor: .white, mutedColor: NSColor.white.withAlphaComponent(0.78)),
  Panel(file: "02-walk-into-the-story.png", sourceFile: "02-walking-route.png",
        headline: "Walk straight\nto it",
        subhead: "Turn-by-turn directions to anything you pick.",
        topColor: cream, bottomColor: lavender,
        textColor: ink, mutedColor: NSColor(calibratedWhite: 0.25, alpha: 1)),
  Panel(file: "03-places-come-alive.png", sourceFile: "03-history-greenwich.png",
        headline: "The whole story,\nnot the summary",
        subhead: "A minute to start with, chapters when you want more.",
        topColor: NSColor(calibratedRed: 0.07, green: 0.07, blue: 0.10, alpha: 1), bottomColor: NSColor(calibratedRed: 0.20, green: 0.14, blue: 0.30, alpha: 1),
        textColor: .white, mutedColor: NSColor.white.withAlphaComponent(0.76)),
  Panel(file: "04-centuries-at-a-glance.png", sourceFile: "04-historical-timeline.png",
        headline: "Centuries,\nat a glance",
        subhead: "Tap any year and jump straight to it.",
        topColor: lavender, bottomColor: NSColor(calibratedRed: 0.83, green: 0.76, blue: 1.00, alpha: 1),
        textColor: ink, mutedColor: NSColor(calibratedWhite: 0.27, alpha: 1)),
  Panel(file: "05-never-walk-past.png", sourceFile: "05-landmark-story.png",
        headline: "Ships, palaces,\nplaques, prisons",
        subhead: "Read it, or listen while you walk.",
        topColor: purple, bottomColor: NSColor(calibratedRed: 0.27, green: 0.12, blue: 0.62, alpha: 1),
        textColor: .white, mutedColor: NSColor.white.withAlphaComponent(0.80)),
]

func topRect(x: CGFloat, y: CGFloat, width: CGFloat, height rectHeight: CGFloat) -> NSRect {
  NSRect(x: x, y: CGFloat(height) - y - rectHeight, width: width, height: rectHeight)
}

func drawText(_ text: String, rect: NSRect, font: NSFont, color: NSColor, lineSpacing: CGFloat = 0) {
  let paragraph = NSMutableParagraphStyle()
  paragraph.alignment = .center
  paragraph.lineSpacing = lineSpacing
  NSString(string: text).draw(in: rect, withAttributes: [
    .font: font,
    .foregroundColor: color,
    .paragraphStyle: paragraph,
  ])
}

for panel in panels {
  guard let screenshot = NSImage(contentsOf: source.appendingPathComponent(panel.sourceFile)) else {
    fatalError("Missing source screenshot: \(panel.sourceFile)")
  }

  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: width * 4, bitsPerPixel: 32
  ) else { fatalError("Could not create canvas") }

  NSGraphicsContext.saveGraphicsState()
  let context = NSGraphicsContext(bitmapImageRep: bitmap)!
  NSGraphicsContext.current = context

  let canvas = NSRect(x: 0, y: 0, width: width, height: height)
  NSGradient(starting: panel.bottomColor, ending: panel.topColor)!.draw(in: canvas, angle: 90)

  let brandRect = topRect(x: 510, y: 88, width: 300, height: 58)
  let brandPath = NSBezierPath(roundedRect: brandRect, xRadius: 29, yRadius: 29)
  panel.textColor.withAlphaComponent(0.12).setFill()
  brandPath.fill()
  drawText("VENTURE", rect: topRect(x: 510, y: 98, width: 300, height: 40),
           font: NSFont.systemFont(ofSize: 27, weight: .bold), color: panel.textColor)

  drawText(panel.headline, rect: topRect(x: 70, y: 177, width: 1180, height: 255),
           font: NSFont.systemFont(ofSize: 102, weight: .heavy), color: panel.textColor, lineSpacing: -2)
  drawText(panel.subhead, rect: topRect(x: 105, y: 470, width: 1110, height: 120),
           font: NSFont.systemFont(ofSize: 41, weight: .medium), color: panel.mutedColor, lineSpacing: 5)

  let shotTop: CGFloat = 645
  let shotBottom: CGFloat = 120
  let shotHeight = CGFloat(height) - shotTop - shotBottom
  let shotWidth = shotHeight * CGFloat(width) / CGFloat(height)
  let shotX = (CGFloat(width) - shotWidth) / 2
  let shotRect = topRect(x: shotX, y: shotTop, width: shotWidth, height: shotHeight)

  precondition(
    shotRect.minX >= 0 && shotRect.minY >= 0 &&
    shotRect.maxX <= CGFloat(width) && shotRect.maxY <= CGFloat(height),
    "Screenshot must fit entirely within the marketing canvas"
  )

  NSGraphicsContext.saveGraphicsState()
  let shadow = NSShadow()
  shadow.shadowColor = NSColor.black.withAlphaComponent(0.26)
  shadow.shadowBlurRadius = 38
  shadow.shadowOffset = NSSize(width: 0, height: -12)
  shadow.set()
  NSColor.white.setFill()
  NSBezierPath(roundedRect: shotRect, xRadius: 62, yRadius: 62).fill()
  NSGraphicsContext.restoreGraphicsState()

  NSGraphicsContext.saveGraphicsState()
  NSBezierPath(roundedRect: shotRect, xRadius: 62, yRadius: 62).addClip()
  screenshot.draw(in: shotRect, from: .zero, operation: .sourceOver, fraction: 1)
  NSGraphicsContext.restoreGraphicsState()

  context.flushGraphics()
  NSGraphicsContext.restoreGraphicsState()

  guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Could not encode \(panel.file)")
  }
  try png.write(to: output.appendingPathComponent(panel.file))
  print("Rendered \(panel.file)")
}
