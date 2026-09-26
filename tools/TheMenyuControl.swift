import Cocoa

final class AppDelegate: NSObject, NSApplicationDelegate {
    private lazy var projectPath = Bundle.main.bundleURL.deletingLastPathComponent().path
    private var backend: Process?
    private var frontend: Process?
    private var window: NSWindow!
    private var statusLabel: NSTextField!
    private var detailLabel: NSTextField!
    private var startButton: NSButton!
    private var stopButton: NSButton!
    private var dataLabel: NSTextField!
    private let accessCode = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(10)).lowercased()
    private let sessionSecret = UUID().uuidString + UUID().uuidString

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildWindow()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopProcesses()
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 360),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "The Menyu"
        window.center()

        let content = NSView()
        window.contentView = content

        let title = NSTextField(labelWithString: "THE MENYU")
        title.font = NSFont.boldSystemFont(ofSize: 30)
        title.textColor = NSColor(calibratedRed: 0.09, green: 0.25, blue: 0.41, alpha: 1)

        let subtitle = NSTextField(labelWithString: "CHIP CHOP · Tokyo event operations")
        subtitle.font = NSFont.systemFont(ofSize: 15)
        subtitle.textColor = .secondaryLabelColor

        statusLabel = NSTextField(labelWithString: "Desk stopped")
        statusLabel.font = NSFont.boldSystemFont(ofSize: 19)
        statusLabel.textColor = .secondaryLabelColor

        detailLabel = NSTextField(labelWithString: "Start the desk, then open the browser workspace.")
        detailLabel.font = NSFont.systemFont(ofSize: 13)
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.maximumNumberOfLines = 2

        startButton = button("Start event desk", action: #selector(startDesk))
        startButton.keyEquivalent = "\r"
        stopButton = button("Stop", action: #selector(stopDesk))
        stopButton.isEnabled = false
        let openButton = button("Open browser", action: #selector(openBrowser))

        let controls = NSStackView(views: [startButton, openButton, stopButton])
        controls.orientation = .horizontal
        controls.spacing = 10
        controls.distribution = .fillEqually

        dataLabel = NSTextField(labelWithString: "Data: backend/data.json   •   Access code: \(accessCode)")
        dataLabel.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        dataLabel.textColor = .tertiaryLabelColor
        dataLabel.isSelectable = true

        let stack = NSStackView(views: [title, subtitle, spacer(10), statusLabel, detailLabel, spacer(8), controls, spacer(8), dataLabel])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 7
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 34),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -34),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 34),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -30),
            controls.widthAnchor.constraint(equalTo: stack.widthAnchor),
            dataLabel.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
    }

    private func button(_ title: String, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        button.controlSize = .large
        return button
    }

    private func spacer(_ height: CGFloat) -> NSView {
        let view = NSView()
        view.translatesAutoresizingMaskIntoConstraints = false
        view.heightAnchor.constraint(equalToConstant: height).isActive = true
        return view
    }

    @objc private func startDesk() {
        guard backend?.isRunning != true || frontend?.isRunning != true else {
            openBrowser()
            return
        }
        stopProcesses()
        statusLabel.stringValue = "Starting desk…"
        statusLabel.textColor = .systemOrange
        detailLabel.stringValue = "Starting the local backend and browser server."
        startButton.isEnabled = false
        stopButton.isEnabled = true

        backend = launch("cd \(shellQuote(projectPath))/backend && exec env STAFF_ACCESS_CODE=\(shellQuote(accessCode)) SESSION_SECRET=\(shellQuote(sessionSecret)) npm start")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self, self.backend?.isRunning == true else { return }
            self.frontend = self.launch("cd \(self.shellQuote(self.projectPath))/react-frontend && exec npm run dev")
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                guard let self, self.frontend?.isRunning == true else { return }
                self.statusLabel.stringValue = "Desk running"
                self.statusLabel.textColor = .systemGreen
                self.detailLabel.stringValue = "The event workspace is ready at http://localhost:4175"
                self.openBrowser()
            }
        }
    }

    @objc private func stopDesk() {
        stopProcesses()
        statusLabel.stringValue = "Desk stopped"
        statusLabel.textColor = .secondaryLabelColor
        detailLabel.stringValue = "The local servers are stopped. Your event data is still saved."
        startButton.isEnabled = true
        stopButton.isEnabled = false
    }

    @objc private func openBrowser() {
        if let url = URL(string: "http://localhost:4175") {
            NSWorkspace.shared.open(url)
        }
    }

    private func launch(_ command: String) -> Process {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", command]
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, self.backend?.isRunning != true, self.frontend?.isRunning != true else { return }
                self.statusLabel?.stringValue = "Desk stopped"
                self.statusLabel?.textColor = .secondaryLabelColor
                self.startButton?.isEnabled = true
                self.stopButton?.isEnabled = false
            }
        }
        do {
            try process.run()
        } catch {
            statusLabel?.stringValue = "Could not start"
            detailLabel?.stringValue = error.localizedDescription
        }
        return process
    }

    private func stopProcesses() {
        [frontend, backend].forEach { process in
            if let process, process.isRunning { process.terminate() }
        }
        frontend = nil
        backend = nil
    }

    private func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
