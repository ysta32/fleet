# Changelog

All notable changes to Fleet are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Site features page: the replay window reads the last hour, 6 hours or overnight (12 hours), as in the app, instead of up to 24 hours, and the GitHub and replay facts sit under the copy so that section's columns balance.

## [1.1.2] - 2026-10-08

### Fixed

- Session and fleet costs price each Claude model at its own version's rates. Every Opus model was billed at the old Opus 4.1 rates ($15/$75, $1.50 cache reads), so Opus 4.5 and later sessions showed about 3 to 7 times their real cost.

## [1.1.1] - 2026-10-08

### Changed

- Site: the Next runtime starts after first paint, so the hero poster is the first thing painted. Home on mobile Lighthouse went from 95 (LCP 3.0s) to 99 (LCP 2.2s).
- Site hero: the flare ring sits on the waiting vessel, and on phones a 14px needs-you label with a backing halo sits beside it, clear of the header.
- The Overview spend note adds information instead of repeating the headline, and its hover split always adds up to the total shown.
- The session drawer shows a same-second run's time once instead of a stack of "+0s" rows.
- On phones the Help sheet leads with the phone alerts switch.

### Fixed

- The site digest's date title follows the visitor's time zone, like its times.

## [1.1.0] - 2026-10-08

The redesign release: one signal per incident, a demo world that reads like a real night, and a site built around it.

### Added

- Replay tape deck in the 3D view: scrub, play and step through the last 12 hours, with the camera returning home on deselect.
- Light harbour palette for the 3D view.
- Incidents: alerts, waiting sessions and blocked army tasks for the same task are grouped into one incident with sub-reasons. The station badges, Overview, Alerts list, nav badge and timeline notches all read the same incident list.
- `createDemoWorld()` and the local-time helpers (`formatLocalTime`, `formatUtcTime`, `localStartOfDay`, `sessionSpend`) in `@fleet/shared`, so the app and the site render the same synthetic world.
- Armies view: dependency edges routed as bundled lanes that never overlap; the graph scales to fit or scrolls by whole columns to the blocked or running task.
- Station labels are laid out together each frame: stations that need you are always labelled, labels avoid each other and the overlays, and leader lines end at the label's edge.
- The live timeline shows the same density bars and incident notches as replay, and the replay header shows spend and agents at the playhead.
- Phone: a "More" sheet in navigation, bottom-anchored phone alerts sheet and recents first in the command palette.
- Site: a problem-first hero whose signal is the waiting station in the live scene, a replay deck on the features page, a docs rail with copy buttons and a live 404.

### Changed

- The collector sends one notification per incident, and sends again when a waiting incident escalates to blocked or when the incident reopens. Every distinct alert is still stored.
- The demo world runs at a realistic pace: about 24 PRs and $40 a night, with 3 to 5 needs-you incidents, fictional project titles and no "Synthetic" prefixes. The demo disclosure stays in the app chrome.
- All times in the app and site are local, with UTC in the tooltip. Today's spend comes from one source everywhere.
- The session drawer is a proper dialog: focus is trapped, the camera stops at 1.6x and keeps the target clear of overlays, and the timeline is ordered oldest first and grouped by task.
- Site hero: the camera holds the waiting station in frame, the poster renders server-side and is preloaded, and digest times are formatted in the visitor's own time zone.
- Spend at phone width: fixed-width figures, no colliding date ticks and an AA-contrast budget label.
- The site install box shows the full command and copies it exactly; the product table shows five rows with a fixed-ratio preview.

### Fixed

- In demo mode the phone alerts switch is simulated and never asks for notification permission or changes a real push subscription.
- Push: coalescing happens only after delivery, and subscriptions answering 403 are pruned.
- Inflight ids no longer start with a hyphen.

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
- Token exchange: remote browsers trade the token for an HttpOnly, SameSite=Strict cookie. API routes never accept `?token=`. A token link only mints the cookie on a top-level same-origin page load and then redirects it off the URL. `fleet token` prints the token separately from the URL.
- Paths are canonicalized before routing, so slash, dot-segment and encoded variants can't reach the API through the shell.
- Failed remote logins on any route share a per-client rate limit. Loopback is never limited, and requests with `X-Forwarded-For` or `Forwarded` are always treated as remote.
- Remote redaction also withholds tool targets, agent labels, task slugs, PR titles and branches, release names and deploy environments.
- The config file is tightened to 0600 on load (never through a symlink). VAPID keys and push subscriptions are stored 0600 in a 0700 directory.
- The installer clones from git by default (the npm package isn't published yet) and is wrapped so a truncated download runs nothing.
- The web app no longer reads a token from localStorage and clears any left by pre-release builds.
- The CI privacy guard runs as its own job and scans every tracked file for real home paths and credential shapes.

### Fixed

- Spend summary no longer lingers after leaving demo mode.
- Web Push VAPID subject uses an https URL, because Apple's push service rejects a localhost mailto.
- The installer copies the freshly built dashboard into the collector, so new installs and upgrades no longer ship stale assets.
- Deploy-failure alerts reach notifications and push.
- `fleet-spend` declares its runtime dependency on `@fleet/shared`. Spend budget alerts and the menu-bar app follow custom `FLEET_PORT` and `FLEET_CONFIG` settings.
- Visualizer station tags stay inside the canvas, and the legend no longer covers the first-run setup steps.
- Phone alerts: notification clicks open same-origin paths only, a failed subscribe is rolled back, and unsubscribe errors are reported.
