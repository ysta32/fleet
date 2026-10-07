# Privacy

fleet-spend is read-only, local, and keeps metadata only.

## What it reads

Only these, read-only:

- `~/.claude/projects/**/*.jsonl` (or `paths.claudeProjectsDir`)
- `~/.codex/sessions/**/rollout-*.jsonl` (or `paths.codexSessionsDir`)
- The Cursor and Copilot CSV files you point to with `paths.cursorExportPath` and `paths.copilotExportPath`
- `~/.config/fleet/spend.json` (its own config)
- `~/.config/fleet/config.json`, only to find the Fleet token, and only if `FLEET_TOKEN` is not set and `notify.fleet` is on
- Git metadata of a working directory, to get a repo display name

It does not read `.env` files. API keys are read only from the environment variable whose name you put in the config.

## What it keeps

Per record: source, timestamp, model, token counts, a record id, and where available repo display name, branch, session id, and task or army labels. It does not keep prompt or response text, tool inputs, file contents, or absolute paths, and the summary it emits contains no absolute paths.

## What it writes

- `~/.config/fleet/spend.json`, only when you run `budget set` or `budget clear` (mode 0600).
- `~/.config/fleet/spend-state.json`: which alert ids were already delivered, so they are not repeated (mode 0600).

Nothing is written to your agent log directories.

## Network calls

None by default. There is no telemetry and no update check. The only calls that can happen:

| Call                                                      | When                                                                                                                    | Sends                                                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `api.anthropic.com` Admin usage report (GET)              | `apiIngest` is true and the named env var is set                                                                        | Your admin key in a header; a start date and grouping query                                                  |
| `api.openai.com` organization completions usage (GET)     | Same                                                                                                                    | Your admin key in a header; a start date query                                                               |
| `http://127.0.0.1:4747/api/alerts` (POST), Fleet loopback | An alert fires, `notify.fleet` is true, and a Fleet token is found (`FLEET_TOKEN` env or `~/.config/fleet/config.json`) | Bearer token header; JSON of kind `spend.budget`, alert title (80 chars max), body (200 chars max), alert id |
| Your `notify.ntfyUrl` (POST)                              | An alert fires and `ntfyUrl` is not empty                                                                               | Alert title as a header, alert body as the text                                                              |

Alert titles and bodies contain dollar amounts, a month, and a threshold. They do not contain prompts, responses, paths, or repo names.

Not network, but local: with `notify.macos`, alerts also run `osascript` to show a macOS notification.

`fleet-spend serve` listens on 127.0.0.1 only, accepts only loopback Host headers, answers GET only, and sets no CORS headers, so other machines and other websites cannot read it.

## Verifying

The code is small. Network calls are in `src/ingest/api.ts` and `src/notify.ts`; searching the package for `fetch` finds nothing else.
