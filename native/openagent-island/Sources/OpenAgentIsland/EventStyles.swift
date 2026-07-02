import AppKit

enum EventStyles {
    struct Style {
        let icon: String
        let color: NSColor
    }

    static func style(for event: String) -> Style {
        switch event {
        case "toolError":
            return Style(icon: "✕", color: NSColor(red: 1.0, green: 0.42, blue: 0.42, alpha: 1))
        case "longBash":
            return Style(icon: "⏱", color: NSColor(red: 0.31, green: 0.80, blue: 0.77, alpha: 1))
        case "needsInput":
            return Style(icon: "?", color: NSColor(red: 1.0, green: 0.90, blue: 0.43, alpha: 1))
        case "compactionEnd":
            return Style(icon: "✓", color: NSColor(red: 0.58, green: 0.88, blue: 0.64, alpha: 1))
        case "agentEnd":
            return Style(icon: "◆", color: NSColor(red: 0.42, green: 0.71, blue: 0.93, alpha: 1))
        default:
            return Style(icon: "●", color: NSColor(red: 0.56, green: 0.56, blue: 0.58, alpha: 1))
        }
    }
}
