# Changelog

All notable changes to Fleet are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-10-07

First public release.

### Added

- Collector daemon and the `fleet` CLI: `start`, `install`, `uninstall`, `status`, `token`, `open`, `doctor` and `demo`. It reads Claude Code transcripts locally and serves a token-protected API on 127.0.0.1:4747 by default.
- launchd agent for macOS, so the collector starts at login.
- Notifications for blocked armies, waiting sessions, failed CI and failed deploys, through macOS notifications or an ntfy topic you choose.
- Read-only GitHub status for pull requests and CI through the `gh` CLI.
- Shared protocol types, the cost estimator and a deterministic synthetic demo fleet (`createDemoFleet`).
- Web app: a live 3D view of the fleet, a dashboard of sessions, armies, PRs and alerts, and replay of recent history.
- Halyard design system: tokens, type, motion, 38 icons, the brand mark and a contrast audit.
- Marketing site with docs, built as a static export and deployed to Vercel at https://fleet-jet-seven.vercel.app.
- Web Push notifications to the installed PWA, with VAPID keys generated and stored locally. Disabled in demo mode.
- Web app Spend view and the `fleet-spend` package: month-to-date spend, month-end forecast, budget alerts and breakdowns by repo, model, session and army.
- Overnight (`@fleet/digest`): a morning digest of merged PRs, commits, releases, CI failures, deployments and agent contributions, with a per-project health light and a static HTML archive.
- Agent detection and army tracking from the Claude Code transcript ingester, with a per-process parsed-file cache for fast rescans.
- Optional macOS menu-bar app (FleetBar) showing collector status and the needs-you count.
- `scripts/install.sh`, a one-command installer, and `fleet doctor` environment checks.
- Screenshot and visual-regression tooling that works from demo mode only (`npm run shots`, `npm run test:visual`) and `scripts/make-gif.mjs` for the hero GIF.
- README, CONTRIBUTING and DESIGN documentation, and a privacy guard in CI.

### Security

- The collector is read-only and binds 127.0.0.1 unless `lan` is set. Loopback needs no token; other clients need the access token and a valid Host header (DNS-rebinding defence).
- Non-loopback clients and push payloads receive a redacted snapshot with opaque project and agent identifiers. Transcript-derived text is withheld unless `shareContent` is enabled.
- Hardened HTML rendering in the digest against script injection.

### Fixed

- Spend summary no longer lingers after leaving demo mode.
- Web Push VAPID subject uses an https URL, because Apple's push service rejects a localhost mailto.
