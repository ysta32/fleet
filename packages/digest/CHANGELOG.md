# Changelog

All notable changes to `@fleet/digest` (Overnight). Releases are tagged `digest-vX.Y.Z` in the Fleet repo.

## 1.0.0 (2026-10-07)

First release inside the Fleet monorepo (moved from the archived `ysta32/overnight`).

### Added

- Collectors for GitHub (GraphQL, batched) and Vercel, with partial-data warnings when a source fails.
- Deterministic summaries plus optional LLM summaries (`claude-sonnet-5-5`, structured output, deterministic fallback).
- Agent attribution from bot logins, `Co-Authored-By` trailers and the Claude Code PR footer.
- Static archive (`index.html`, one page per night, `latest.json` for the Fleet dashboard), Notion, email (Resend) and
  ntfy delivery.
- Digest JSON contract `overnight.digest/v1` (`SCHEMA.md`) and `renderDigestFragment` / `DIGEST_CSS` for the Fleet site.
- Example GitHub Actions workflow for a **private** repo (`examples/overnight-digest.yml`); it refuses public repos.
- Visual QA harness (`npm run visual`) with 7 synthetic scenarios; baselines are generated locally
  (`npm run visual:update`) and are not committed.

### Design

- Page, archive and email restyled on Halyard, Fleet's design system, as a broadsheet: serif headline, numbered ruled
  sections, mono facts, one signal-orange accent, agents vs you lane, 14-night trend lines, keyboard shortcuts,
  print styles and reduced-motion support.
- Email: table layout (600px, fluid to 320), inline Halyard light values with dark-mode and Outlook overrides,
  drift-tested against the synced tokens.
- Four critique rounds at 360/768/1280/1920 in light and dark (logged in `DESIGN.md`).

### Fixed

- A corrupt or incomplete stored digest in the archive history no longer blocks publishing today's edition.
- The grain texture no longer turns the ink ground grey.
