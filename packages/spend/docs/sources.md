# Sources

Each source produces usage records: timestamp, model, token counts, and where available a repo name, branch, and session id. Records from all sources are de-duplicated by record id, priced, and combined. Only records from roughly the start of the previous month onward are used (month start minus 31 days).

`fleet-spend` prints a status per source: `ok`, `missing` (nothing found or not configured), or `error` (a short, path-free note says what failed).

## Claude Code

- Reads: every `*.jsonl` under `~/.claude/projects` (override with `paths.claudeProjectsDir`) modified within the window.
- Keeps: model, token counts (input, output, cache read, cache write 5m and 1h), timestamp, session id, repo display name, git branch.
- Also derives `army` and `task` labels from the working directory when it follows the Fleet worktree layout, or from branches named `orch/...`.
- Enable: nothing to do.

## Codex

- Reads: `rollout-*.jsonl` files under `~/.codex/sessions` (override with `paths.codexSessionsDir`).
- Keeps token counts, model, and timestamps. Record ids are derived from a hash of the file's path relative to the sessions directory, not the path itself.
- Enable: nothing to do.

## Cursor

Cursor usage comes from a CSV you export; fleet-spend does not read Cursor's local database.

1. Open cursor.com/dashboard and go to your usage.
2. Export the usage CSV.
3. Set `paths.cursorExportPath` to the downloaded file.

Columns used: `date`, `model`, `input (w/o cache write)`, `input (w/ cache write)`, `output tokens`, `cache read`, `cost`. When `cost` is present it is used as the vendor cost instead of the price table. Re-export periodically; the file is a snapshot.

## GitHub Copilot

GitHub Copilot moved to usage-based billing on June 1, 2026. Usage comes from a CSV export.

1. In GitHub, open your Copilot billing and usage page and download the usage report as CSV.
2. Set `paths.copilotExportPath` to the downloaded file.

Columns used: `date`, `model`, `quantity`, `price_per_unit` (or `applied_cost_per_quantity`), `net_amount`, `gross_amount`, `repository`. Cost is `net_amount`, else `gross_amount`, else quantity times unit price. The export has no token counts, so Copilot rows carry the billed amount rather than a token-derived estimate. Check the column names against your own export; rows without a parseable `date` are skipped.

## Anthropic API (opt-in)

Organization-wide usage from the Anthropic Admin API, daily buckets grouped by model.

1. Create an Admin API key in your Anthropic organization settings.
2. Export it in the shell that runs fleet-spend, under any variable name, for example `ANTHROPIC_ADMIN_KEY`.
3. In `spend.json`, set `"apiIngest": true` and, if you used another name, `"anthropicAdminKeyEnv": "YOUR_VAR_NAME"`.

The config holds the variable NAME only. The key is read from the process environment, never from a file, sent only as a request header to `api.anthropic.com`, and never stored or printed.

## OpenAI API (opt-in)

Same steps with an OpenAI admin key, `openaiAdminKeyEnv` (default `OPENAI_ADMIN_KEY`), and `apiIngest: true`. Requests go to `api.openai.com` (completions usage).

## Overlap caveat

API reports are organization-wide and have no request ids. If the same org key also backs your local Claude Code or Codex usage, those tokens appear twice: once from the local logs, once from the API source (`anthropic-api`, `openai-api`). They cannot be de-duplicated. Records are tagged by source so you can compare with `fleet-spend where --by source`; enable API ingestion only if the API usage you want is not already in local logs (for example, CI or server-side calls).
