# Fleet menu bar

Optional macOS AppKit status app. Requires the Swift compiler from the Apple
Command Line Tools; no Xcode project or third-party dependencies are needed.

From the repository root:

```sh
bash menubar/build.sh
open menubar/build/FleetBar.app
```

The build produces a standalone binary and an unsigned `.app` bundle under
`menubar/build/` (gitignored). The app runs without a Dock icon.

FleetBar reads only the `port` setting from `~/.config/fleet/config.json` at
startup using JSONSerialization. Missing, unreadable, or invalid settings fall
back to port 4747. Restart FleetBar after changing the port.

It polls `http://127.0.0.1:<port>/api/health` for the status dot, then
`/api/snapshot` for counts, immediately and every five seconds. Run the Fleet
collector separately, or let launchd run it (`fleet install`). Loopback access
needs no token. FleetBar does not log snapshot data or display transcript text,
alert bodies, or army status/handoff text.

The menu bar shows a monochrome template glyph of the Halyard mark (see
`packages/ui/brand/mark.svg`) that follows the system tint, plus the
needs-you count when it is above zero. The menu shows:

- a status dot: `●` Collector running, `○` Collector stopped
- **Needs you: N**, the same count as the dashboard: open alerts, sessions
  waiting on you, and blocked armies without an alert
- each project's active agent count and army progress (landed tasks / total
  tasks, plus the army phase)
- **Open Fleet**, which opens the local dashboard in your browser
- **Start collector** or **Stop collector**, which drive the user launchd agent
  `dev.fleet.collector` with `launchctl bootstrap`, `kickstart -k` and `bootout`.
  Start needs the plist from `fleet install`.
- **Quit**

When the collector is stopped the glyph shows an em dash and the menu says how
to start it. Polling continues. FleetBar does not install itself as a login item.
