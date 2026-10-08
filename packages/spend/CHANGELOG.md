# Changelog

## 1.0.0 - 2026-10-07

Initial release.

- Ingest from Claude Code and Codex local session logs (read-only, metadata only).
- Ingest from Cursor and GitHub Copilot usage CSV exports.
- Opt-in Anthropic Admin API and OpenAI usage API ingestion, with the key read from a named environment variable.
- Versioned price table (`2026-10-01`) with explicit per-model cache read and write rates and long-context tiers.
- Month-to-date, today, forecast, and one-hour burn rate; breakdowns by repo, model, session, army, task, day, branch, and source.
- Monthly budget with `warnAt` thresholds and budget alerts, delivered via macOS notification, Fleet loopback, or ntfy; delivered alerts are not repeated.
- Savings tips with dollar estimates (tier fit, cache hit ratio, cache TTL, Copilot model choice, session share).
- CLI: summary, `where`, `tips`, `budget set|clear`, `check` (exit 0/1/2, 3 on error), `json`, `brief`, `watch`, `serve` (127.0.0.1, ports 4500-4999), `--json`, `--no-color`, `--ascii`.
- Error messages are one line and path-free; source errors never include paths or keys.
- Spend tab React components (`fleet-spend/web`) for Fleet and the Fleet site.
