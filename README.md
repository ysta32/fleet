# Fleet

Mission control for Claude Code agents.

## Install

```sh
bash scripts/install.sh
```

The script needs Node 20 or newer. It installs the `fleet` command, writes the
launchd agent `dev.fleet.collector` and prints the local URL, `http://127.0.0.1:4747/`
by default. Rerunning it is safe. Variables:

- `FLEET_FROM=/path/to/checkout` builds and installs from a local checkout.
- `FLEET_FROM_GIT=1` clones the repository first. Otherwise the npm package is used.
- `FLEET_PREFIX=<dir>` installs under a custom npm prefix instead of the global one.
- `FLEET_NO_LAUNCHD=1` writes the plist but does not load it.

## Commands

- `fleet install [--dry-run]` installs and loads the launchd agent. `--dry-run`
  prints the plist path and contents and changes nothing.
- `fleet doctor` checks Node, the port, `~/.claude/projects`, `gh auth`, config
  permissions, launchd and web assets. Each line reads `ok`, `warn` or `fail`,
  then the fact, then what to do. Exit code 0 means all ok, 1 means warnings
  only, 2 means at least one failure.
- `fleet token` prints the access token and LAN URL. `fleet status`, `fleet open`
  and `fleet uninstall` do what they say.

The optional menu bar app is in [menubar/](menubar/README.md).
