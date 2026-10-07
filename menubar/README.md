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

It polls `http://127.0.0.1:<port>/api/snapshot` immediately and every five seconds.
Run the Fleet collector separately. Loopback access needs no token. FleetBar
does not log snapshot data or display transcript text, alert bodies, or army
status/handoff text.

The title shows `◆ <count>` for working or waiting agents, with a red dot when
any alert is uncleared. The menu shows each project's active agent count and
army progress as landed tasks / total tasks, plus the army phase. Idle, done,
and failed agents are excluded from active counts. An unavailable collector or
invalid snapshot shows `◆ —` and “Fleet unavailable”; polling continues.

Choose **Open Fleet** to open the local dashboard in your browser, or **Quit**
to exit. FleetBar does not install itself as a login item.
