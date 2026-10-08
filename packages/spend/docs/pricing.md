# Pricing

Token-based sources are priced from a built-in table in `src/pricing/table.ts`. Prices are USD per million tokens.

Current table version: `2026-10-01`.

## How a record is priced

1. If the record has a vendor-reported cost (Cursor CSV `cost`, Copilot billed amount), that is used as-is.
2. Otherwise the model id is matched against the table by lowercase substring; the longest match wins.
3. Cost = input, output, cache read, cache write 5m, and cache write 1h tokens, each at its own rate.
4. If a model has a long-context tier and a call's input plus cache tokens exceed its threshold, that call uses the higher tier.
5. If nothing matches, the record is counted as unpriced rather than guessed.

## Cache rates

Anthropic: cache write 5m is 1.25x input, cache write 1h is 2x input, cache read is 0.1x input for most models. Exceptions: Fable 5.1 and Mythos 5.1 read at 0.025x ($0.25), Opus 5.5 at 0.05x ($0.20). Rates per model are explicit in the table, not computed at runtime.

OpenAI and Google: no write premium. Cache writes bill as ordinary input; cache reads use the published cached-input rate. Gemini cache storage fees are not modeled.

## Anthropic (as of 2026-10-06)

| Model                                         | Input | Output | Cache read | Write 5m | Write 1h |
| --------------------------------------------- | ----- | ------ | ---------- | -------- | -------- |
| claude-fable-5-1                              | 10    | 50     | 0.25       | 12.5     | 20       |
| claude-mythos-5-1                             | 10    | 50     | 0.25       | 12.5     | 20       |
| claude-fable-5                                | 10    | 50     | 1          | 12.5     | 20       |
| claude-mythos-5                               | 10    | 50     | 1          | 12.5     | 20       |
| claude-opus-5-5                               | 4     | 20     | 0.2        | 5        | 8        |
| claude-opus-5                                 | 5     | 25     | 0.5        | 6.25     | 10       |
| claude-opus-4-8 / 4-7 / 4-6 / 4-5             | 5     | 25     | 0.5        | 6.25     | 10       |
| claude-opus-4-1, claude-opus-4, claude-3-opus | 15    | 75     | 1.5        | 18.75    | 30       |
| claude-sonnet-5-5, claude-sonnet-5            | 2     | 10     | 0.2        | 2.5      | 4        |
| claude-sonnet-4-6                             | 3     | 15     | 0.3        | 3.75     | 6        |
| claude-sonnet-4-5, claude-sonnet-4            | 3     | 15     | 0.3        | 3.75     | 6        |
| claude-3-7-sonnet, claude-3-5-sonnet          | 3     | 15     | 0.3        | 3.75     | 6        |
| claude-haiku-5-5                              | 0.1   | 0.5    | 0.01       | 0.125    | 0.2      |
| claude-haiku-4-5                              | 1     | 5      | 0.1        | 1.25     | 2        |
| claude-3-5-haiku                              | 0.8   | 4      | 0.08       | 1        | 1.6      |
| claude-3-haiku                                | 0.25  | 1.25   | 0.03       | 0.3125   | 0.5      |

Long-context tiers: Haiku 5.5 above 100K prompt tokens ($0.50 in, $2.50 out, $0.05 read). Sonnet 4.5 and Sonnet 4 above 200K ($6 in, $22.50 out, $0.60 read).

## OpenAI (needs verification)

These rates were entered from memory of the public pricing page as of 2026-10-01 and are marked UNVERIFIED in the source. Confirm them at platform.openai.com/docs/pricing before relying on OpenAI numbers. Format: input / output / cached input.

gpt-5-pro 15 / 120 / 15; gpt-5-2 1.75 / 14 / 0.175; gpt-5-1 and codex variants 1.25 / 10 / 0.125; gpt-5 and gpt-5-codex 1.25 / 10 / 0.125; gpt-5-mini and codex-mini variants 0.25 / 2 / 0.025; codex-mini-latest 1.5 / 6 / 0.375; gpt-5-nano 0.05 / 0.4 / 0.005; o3-pro 20 / 80 / 20; o1-pro 150 / 600 / 150; o1 15 / 60 / 7.5; o3 2 / 8 / 0.5; o3-mini and o1-mini 1.1 / 4.4 / 0.55; o4-mini 1.1 / 4.4 / 0.275; gpt-4-1 2 / 8 / 0.5; gpt-4-1-mini 0.4 / 1.6 / 0.1; gpt-4-1-nano 0.1 / 0.4 / 0.025; gpt-4o 2.5 / 10 / 1.25; gpt-4o-mini 0.15 / 0.6 / 0.075.

## Google Gemini (needs verification)

Also marked UNVERIFIED, as of 2026-10-01. Input / output / cached input:

gemini-2-5-pro 1.25 / 10 / 0.125 (above 200K prompt tokens: 2.5 / 15 / 0.25); gemini-2-5-flash 0.3 / 2.5 / 0.03; gemini-2-5-flash-lite 0.1 / 0.4 / 0.01.

## Updating the table

1. Edit the entries in `src/pricing/table.ts`. Use the helpers: `anth(input, output, cacheRead)` for Anthropic (derives 1.25x and 2x write rates), `flat(input, output, cacheRead)` for OpenAI and Google.
2. Add the new model's lowercase `match` substrings, with dots written as dashes (`claude-sonnet-4-5`). Put more specific ids so they win: longest match wins.
3. Set `tier` (3 top, 2 mid, 1 small); savings tips use it.
4. Update the SOURCE comment with the page and date you checked.
5. Bump `PRICE_TABLE.version` on any change.
6. Run the tests: `npx vitest run packages/spend/src/pricing`.

Prices change; if a number here disagrees with the vendor's page, the vendor's page is right. Open an issue or a PR with the source link.
