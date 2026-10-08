# Changelog

All notable changes to Fleet are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

Fleet is in v0.x development. No version has been published yet, so everything below sits under Unreleased.

## [Unreleased]

Work toward the first public release, v0.1.0.

### Added

- Collector daemon and the `fleet` CLI: `start`, `install`, `uninstall`, `status`, `token`, `open`, `doctor` and `demo`. It reads Claude Code transcripts locally and serves a token-protected API on 127.0.0.1:4747 by default.
- launchd agent for macOS, so the collector starts at login.
- Notifications for blocked armies, waiting sessions, failed CI and failed deploys, through macOS notifications or an ntfy topic you choose.
- Read-only GitHub status for pull requests and CI through the `gh` CLI.
- Shared protocol types, the cost estimator and a deterministic synthetic demo fleet (`createDemoFleet`).
- Web app: a live 3D view of the fleet, a dashboard of sessions, armies, PRs and alerts, and replay of recent history.
- Halyard design system: tokens, type, motion, 38 icons, the brand mark and a contrast audit.
- Marketing site with docs, built as a static export.
