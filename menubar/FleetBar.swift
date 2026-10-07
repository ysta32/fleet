import AppKit
import CoreFoundation

private struct Snapshot: Decodable {
    let version: Int
    let projects: [Project]
    let agents: [Agent]
    let alerts: [Alert]
}

private struct Project: Decodable {
    let id: String
    let name: String
    let orch: Army?
}

private struct Army: Decodable {
    let phase: String
    let tasks: [ArmyTask]
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
        render(nil, message: "Connecting to Fleet…")
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

    private func poll() {
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
                self.render(result, message: "Fleet unavailable")
            }
        }
        request?.resume()
    }

    private func render(_ snapshot: Snapshot?, message: String) {
        let active = snapshot?.agents.filter { $0.isActive } ?? []
        let hasAlerts = snapshot?.alerts.contains { $0.cleared != true } ?? false
        let title = NSMutableAttributedString(
            string: snapshot == nil ? "◆ —" : "◆ \(active.count)",
            attributes: [.foregroundColor: NSColor.labelColor]
        )
        if hasAlerts {
            title.append(NSAttributedString(string: " ●", attributes: [
                .foregroundColor: NSColor.systemRed,
            ]))
        }
        statusItem.button?.attributedTitle = title
        statusItem.button?.toolTip = snapshot == nil ? message : "Fleet: \(active.count) active agents"

        let menu = NSMenu()
        if let snapshot = snapshot {
            let counts = Dictionary(grouping: active, by: { $0.projectId }).mapValues { $0.count }
            if snapshot.projects.isEmpty { addLabel("No projects", to: menu) }
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

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }
}

let application = NSApplication.shared
private let delegate = FleetBar()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
