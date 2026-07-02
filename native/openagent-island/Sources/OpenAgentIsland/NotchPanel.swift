import AppKit

final class NotchPanel: NSPanel {
    private let container = NSVisualEffectView()
    private let iconLabel = NSTextField(labelWithString: "")
    private let titleLabel = NSTextField(labelWithString: "")
    private let messageLabel = NSTextField(labelWithString: "")
    private var dismissTimer: DispatchSourceTimer?

    override init(
        contentRect: NSRect,
        styleMask style: NSWindow.StyleMask,
        backing backingStoreType: NSWindow.BackingStoreType,
        defer flag: Bool
    ) {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 44),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        self.level = .mainMenu + 3
        self.isOpaque = false
        self.backgroundColor = .clear
        self.hasShadow = true
        self.isMovable = false
        self.collectionBehavior = [.fullScreenAuxiliary, .canJoinAllSpaces, .stationary]
        self.hidesOnDeactivate = false

        setupViews()
    }

    private func setupViews() {
        container.wantsLayer = true
        container.layer?.cornerRadius = 22
        container.layer?.masksToBounds = true
        container.blendingMode = .behindWindow
        container.material = .hudWindow
        container.state = .active

        let stack = NSStackView()
        stack.orientation = .horizontal
        stack.spacing = 8
        stack.edgeInsets = NSEdgeInsets(top: 6, left: 12, bottom: 6, right: 12)

        iconLabel.font = .systemFont(ofSize: 16, weight: .medium)
        titleLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        titleLabel.textColor = .white
        messageLabel.font = .systemFont(ofSize: 12)
        messageLabel.textColor = NSColor(white: 0.85, alpha: 1)
        messageLabel.lineBreakMode = .byTruncatingTail

        stack.addArrangedSubview(iconLabel)
        stack.addArrangedSubview(titleLabel)
        stack.addArrangedSubview(messageLabel)
        stack.setHuggingPriority(.defaultHigh, for: .horizontal)

        container.addSubview(stack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: container.topAnchor),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])

        contentView = container
    }

    func show(event: EventData) {
        let style = EventStyles.style(for: event.event)
        iconLabel.stringValue = style.icon
        iconLabel.textColor = style.color
        titleLabel.stringValue = event.title
        messageLabel.stringValue = event.message

        positionAtNotch()
        alphaValue = 0
        orderFrontRegardless()

        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.25
            animator().alphaValue = 1
        }

        scheduleDismiss()
    }

    private func positionAtNotch() {
        guard let screen = NSScreen.main else { return }
        let screenFrame = screen.frame
        let panelSize = contentView?.fittingSize ?? NSSize(width: 320, height: 44)
        let x = screenFrame.midX - panelSize.width / 2
        let y = screenFrame.maxY - panelSize.height - screen.safeAreaInsets.top
        setFrameOrigin(NSPoint(x: x, y: y))
    }

    private func scheduleDismiss() {
        dismissTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 4)
        timer.setEventHandler { [weak self] in
            NSAnimationContext.runAnimationGroup({ ctx in
                ctx.duration = 0.3
                ctx.completionHandler = { self?.orderOut(nil) }
                self?.animator().alphaValue = 0
            })
        }
        timer.resume()
        dismissTimer = timer
    }
}
