import AppKit
import CoreFoundation

private struct Snapshot: Decodable {
    let version: Int
    let projects: [Project]
    let agents: [Agent]
    let alerts: [Alert]
    let sessions: [Session]?
}

private struct Project: Decodable {
    let id: String
    let name: String
    let orch: Army?
}

private struct Army: Decodable {
    let phase: String
    let tasks: [ArmyTask]
    let blocked: [String]?
}

private struct Session: Decodable {
    let status: String
}

private struct ArmyTask: Decodable {
    let state: String
}

private struct Agent: Decodable {
    let projectId: String
    let status: String

    var isActive: Bool { status == "working" || status == "waiting" }
}

private struct Alert: Decodable {
    let cleared: Bool?
    let kind: String?
    let projectId: String?
}

private let collectorLabel = "dev.fleet.collector"

extension Snapshot {
    /// Mirrors the dashboard's "Needs you": open alerts, sessions waiting on the operator,
    /// and blocked armies that no army.blocked alert already represents.
    var needsYouCount: Int {
        let open = alerts.filter { $0.cleared != true }
        let waiting = (sessions ?? []).filter { $0.status == "waiting" }.count
        let alerted = Set(open.filter { $0.kind == "army.blocked" }.compactMap { $0.projectId })
        let blocked = projects.filter { project in
            guard let army = project.orch, !alerted.contains(project.id) else { return false }
            return army.phase == "blocked" || !(army.blocked ?? []).isEmpty
                || army.tasks.contains { $0.state == "blocked" }
        }.count
        return open.count + waiting + blocked
    }
}

/// Monochrome template glyph that follows the Halyard mark in packages/ui/brand/mark.svg:
/// a mast with a pennant and the orbit ring. Template images take the menu bar's tint.
private func templateIcon() -> NSImage {
    let side: CGFloat = 18
    let image = NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in
        let k = rect.width / 32
        NSColor.black.setStroke()
        NSColor.black.setFill()
        let mast = NSBezierPath()
        mast.move(to: NSPoint(x: 12 * k, y: 5 * k))
        mast.line(to: NSPoint(x: 12 * k, y: 27 * k))
        mast.lineWidth = 2.5 * k
        mast.lineCapStyle = .round
        mast.stroke()
        let pennant = NSBezierPath()
        pennant.move(to: NSPoint(x: 12.75 * k, y: 27.25 * k))
        pennant.line(to: NSPoint(x: 25 * k, y: 22.75 * k))
        pennant.line(to: NSPoint(x: 12.75 * k, y: 18.25 * k))
        pennant.close()
        pennant.fill()
        let ring = NSBezierPath(ovalIn: NSRect(x: 3 * k, y: 8.5 * k, width: 26 * k, height: 10.5 * k))
        var tilt = AffineTransform(translationByX: 16 * k, byY: 13.75 * k)
        tilt.rotate(byDegrees: 14)
        tilt.translate(x: -16 * k, y: -13.75 * k)
        ring.transform(using: tilt)
        ring.lineWidth = 2 * k
        ring.stroke()
        return true
    }
    image.isTemplate = true
    return image
}

private func configuredPort() -> Int {
    let url = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".config/fleet/config.json")
    guard let data = try? Data(contentsOf: url),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let port = json["port"] as? NSNumber,
          CFGetTypeID(port) != CFBooleanGetTypeID(),
          port.doubleValue >= 1, port.doubleValue <= 65535,
          port.doubleValue.rounded() == port.doubleValue
    else { return 4747 }
    return port.intValue
}

private final class FleetBar: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var timer: Timer?
    private var request: URLSessionDataTask?
    private var running = false
    private let baseURL = URL(string: "http://127.0.0.1:\(configuredPort())")!
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 4
        configuration.timeoutIntervalForResource = 4
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        render(nil, message: "Connecting to the collector.")
        poll()
        let timer = Timer(timeInterval: 5, repeats: true) { [weak self] _ in
            self?.poll()
        }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        request?.cancel()
        session.invalidateAndCancel()
    }

    /// Polls /api/health for the status dot, then /api/snapshot for counts.
    private func poll() {
        guard request == nil else { return }
        request = session.dataTask(with: baseURL.appendingPathComponent("api/health")) {
            [weak self] _, response, error in
            let healthy = error == nil && (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async {
                guard let self = self else { return }
                if healthy {
                    self.request = nil
                    self.fetchSnapshot()
                } else {
                    self.request = nil
                    self.running = false
                    self.render(nil, message: "Collector stopped. Start it from this menu or run fleet install.")
                }
            }
        }
        request?.resume()
    }

    private func fetchSnapshot() {
        guard request == nil else { return }
        request = session.dataTask(with: baseURL.appendingPathComponent("api/snapshot")) {
            [weak self] data, response, error in
            var snapshot: Snapshot?
            if error == nil,
               let response = response as? HTTPURLResponse,
               response.statusCode == 200,
               let data = data,
               let decoded = try? JSONDecoder().decode(Snapshot.self, from: data),
               decoded.version == 1 {
                snapshot = decoded
            }
            let result = snapshot
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.request = nil
                self.running = true
                self.render(result, message: "Collector is running but returned an unreadable snapshot. Update Fleet.")
            }
        }
        request?.resume()
    }

    private func render(_ snapshot: Snapshot?, message: String) {
        let active = snapshot?.agents.filter { $0.isActive } ?? []
        let needs = snapshot?.needsYouCount ?? 0
        let button = statusItem.button
        button?.image = templateIcon()
        button?.imagePosition = .imageLeading
        button?.attributedTitle = NSAttributedString(
            string: snapshot == nil ? " —" : (needs > 0 ? " \(needs)" : ""),
            attributes: [.foregroundColor: NSColor.labelColor]
        )
        button?.toolTip = snapshot == nil ? message : "Fleet: \(needs) need you, \(active.count) active agents"

        let menu = NSMenu()
        // status dot: filled when /api/health answers, hollow when it does not
        addLabel("\(running ? "●" : "○") \(running ? "Collector running" : "Collector stopped")", to: menu)
        if let snapshot = snapshot {
            addLabel("Needs you: \(needs)", to: menu)
            let counts = Dictionary(grouping: active, by: { $0.projectId }).mapValues { $0.count }
            if snapshot.projects.isEmpty { addLabel("No projects yet", to: menu) }
            for project in snapshot.projects.sorted(by: {
                $0.name.localizedStandardCompare($1.name) == .orderedAscending
            }) {
                addLabel("\(project.name): \(counts[project.id, default: 0]) active", to: menu)
                if let army = project.orch {
                    let landed = army.tasks.filter { $0.state == "landed" }.count
                    addLabel("Army: \(landed)/\(army.tasks.count) landed · \(army.phase)",
                             to: menu, indentation: 1)
                }
            }
        } else {
            addLabel(message, to: menu)
        }
        menu.addItem(.separator())
        let open = NSMenuItem(title: "Open Fleet", action: #selector(openFleet), keyEquivalent: "o")
        open.target = self
        menu.addItem(open)
        let toggle = NSMenuItem(
            title: running ? "Stop collector" : "Start collector",
            action: running ? #selector(stopCollector) : #selector(startCollector),
            keyEquivalent: ""
        )
        toggle.target = self
        menu.addItem(toggle)
        let quit = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        statusItem.menu = menu
    }

    private func addLabel(_ title: String, to menu: NSMenu, indentation: Int = 0) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        item.indentationLevel = indentation
        menu.addItem(item)
    }

    @objc private func openFleet() {
        NSWorkspace.shared.open(baseURL)
    }

    private func launchctl(_ arguments: [String], then done: (() -> Void)? = nil) {
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
            process.arguments = arguments
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try? process.run()
            process.waitUntilExit()
            DispatchQueue.main.async {
                done?()
                self.poll()
            }
        }
    }

    @objc private func startCollector() {
        let domain = "gui/\(getuid())"
        let plist = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/\(collectorLabel).plist").path
        // bootstrap first: it fails harmlessly when the agent is already loaded, and kickstart then restarts it
        launchctl(["bootstrap", domain, plist]) {
            self.launchctl(["kickstart", "-k", "\(domain)/\(collectorLabel)"])
        }
    }

    @objc private func stopCollector() {
        launchctl(["bootout", "gui/\(getuid())/\(collectorLabel)"])
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }
}

let application = NSApplication.shared
private let delegate = FleetBar()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
