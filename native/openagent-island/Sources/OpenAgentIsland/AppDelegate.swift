import AppKit
import Foundation

struct EventData: Codable {
	let event: String
	let title: String
	let message: String
}

final class AppDelegate: NSObject, NSApplicationDelegate {
	private var statusItem: NSStatusItem!
	private let panel = NotchPanel()
	private let client = SSEClient()
	private var connectItem: NSMenuItem!

	func applicationDidFinishLaunching(_ notification: Notification) {
		statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
		if let button = statusItem.button {
			button.image = NSImage(
				systemSymbolName: "sparkle",
				accessibilityDescription: "openagent-island"
			)
		}

		let menu = NSMenu()
		menu.addItem(withTitle: "openagent-island", action: nil, keyEquivalent: "")
		menu.addItem(.separator())
		connectItem = menu.addItem(withTitle: "Reconnect", action: #selector(reconnect), keyEquivalent: "r")
		menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
		statusItem.menu = menu

		client.onEvent = { [weak self] event in
			DispatchQueue.main.async {
				self?.panel.show(event: event)
			}
		}

		client.onStatusChange = { [weak self] connected in
			DispatchQueue.main.async {
				self?.statusItem.button?.image = NSImage(
					systemSymbolName: connected ? "sparkle" : "sparkle.slash",
					accessibilityDescription: connected ? "Connected" : "Disconnected"
				)
			}
		}

		reconnect()
	}

	@objc func reconnect() {
		let port = ProcessInfo.processInfo.environment["OPENAGENT_PORT"] ?? "4096"
		client.connect(url: "http://127.0.0.1:\(port)/sse/notifications")
	}
}
