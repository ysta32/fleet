# Visual QA

Start the synthetic web app on port 4501 and marketing site on port 4503. Override
with `VISUAL_APP_URL` and `VISUAL_SITE_URL` (explicit ports must be 4500–4599).
The current worktree contains a placeholder app and no site; approve baselines
only after those surfaces and the following contract land.

## Page contract

Both app and site must honor `?demo=1&freeze=1&seed=fleet-visual-v1` before starting
any data providers. `demo=1` selects synthetic fixtures without collector requests,
live integrations, persisted user state, or real filesystem data. `seed` must
select repeatable fixtures, IDs, timestamps, and layout. `freeze=1` stops demo
streaming, clocks, timers that change UI, particles, camera drift, and WebGL
animation at a deterministic frame while allowing initial rendering. CSS motion
is also disabled by the harness; reduced motion alone does not freeze WebGL.
Tests intentionally do not mock the UI or replace its data provider. API requests
and WebSockets are blocked in synthetic captures as a second line of defense.

Theme selection uses both `prefers-color-scheme` and `html[data-theme]`. Captures
use Chromium, DPR 1, UTC, en-US, 900px viewport height, full-page screenshots, and
widths 375, 768, 1280, 1920. Each waits for network idle, fonts, and 1.5 seconds of
WebGL initialization. Keep the browser version and OS consistent for baselines.

## Commands

- List cases: `npx playwright test tests/visual --list`
- Capture: `~/.claude/orch/bin/serial e2e -- npm run shots -- 'http://127.0.0.1:4501/?demo=1' /tmp/fleet-shots --routes /`
- Create/review baselines after the contract is implemented: `~/.claude/orch/bin/serial e2e -- npm run test:visual -- --update-snapshots`
- Compare approved baselines: `~/.claude/orch/bin/serial e2e -- npm run test:visual`

Baseline PNGs belong in `tests/visual/baselines`; review and commit only synthetic
images. Missing baselines fail comparison runs. The tolerance is 0.02 changed
pixel ratio. Failure artifacts go under `.orch/visual-results`. The default site
coverage is home, features, pricing, docs, about, privacy, and terms.

The capture command refuses an initial URL without `demo=1`, then forces it on
every requested route. It also adds the freeze and seed parameters. `--allow-live`
is an explicit opt-out reserved for local inspection: output must be in a
new subdirectory of this worktree's `.orch`, including resolved symlinks, and receives
a `.gitignore` excluding every artifact. Never force-add or commit live captures.
The visual tests always force demo mode and have no live opt-out.
