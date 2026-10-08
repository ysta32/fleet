# Overnight: design

## Concept: the morning paper for your fleet

Overnight is one front page per day, about work that happened while you slept. It has a nameplate
(the date), one headline, what needs you, who did the work (agents or you) and what shipped. It
reads like a broadsheet edited by a calm operator, not like a dashboard. Every visual decision
supports that metaphor: a masthead with a double rule, numbered section rules, ruled lists instead
of cards, serif display type for the editorial voice and mono type for every fact.

**Mood:** dawn over a print room. The page sits on warm ink (dark) or bone paper (light), with a
faint grain and a single band of signal-orange light at the top edge, like the sky just before
sunrise. It stays quiet until something is red.

## Halyard, applied

All values come from Fleet's Halyard tokens (`packages/ui/tokens.css`). The standalone page
inlines them from `src/render/halyard.generated.ts` (`npm run sync-tokens`; a test fails on drift).
`DIGEST_CSS` opens with **one mapping block**, `.ovn-root { --ovn-*: var(--fl-*) }`, and every
component rule below it uses only `--ovn-*` (enforced by test). The fragment ships `DIGEST_CSS`
alone, because the Fleet host already provides the tokens.

| Role          | Token                                                           | Rule                                                                                     |
| ------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Ground        | `--fl-bg` + `--fl-grain` (falls back to an inline SVG noise)    | Never flat                                                                               |
| Ink           | `--fl-fg`, `--fl-fg-muted`                                      | All text. `--fl-fg-subtle` only for non-text marks (AA)                                  |
| Accent        | `--fl-accent` (signal orange)                                   | The dawn glow, edition mark, overall trend, focus, link underline on hover. Never status |
| Status        | `--fl-danger` / `--fl-warn` / `--fl-success` / `--fl-fg-subtle` | Only where health is shown, always as shape + word                                       |
| Status text   | `color-mix(status 70%, fg)`                                     | Coloured text is mixed toward ink so it passes AA in light mode                          |
| Agents vs you | `--fl-series-2` (solid) vs `--fl-series-6` (hatched)            | Pattern + colour, so the split reads in greyscale                                        |

Theme: dark by default, follows `prefers-color-scheme`, and `[data-theme]` on `<html>` overrides it,
all inherited from Halyard.

## Type

Instrument Serif speaks (date, headline, project names, summaries). Schibsted Grotesk explains (UI,
highlights). IBM Plex Mono states facts (every number, id, SHA, time, label). Tabular numerals are
used throughout. Display tracking is `var(--fl-tracking-display, -0.02em)`.

| Level                      | Face                          | Size                                                                       |
| -------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| Nameplate (date)           | Serif, weekday italic + muted | `clamp(2rem, 5.4cqi, 2.875rem)`, leading 0.95                              |
| Headline (the focal point) | Serif                         | `clamp(1.875rem, 4.9cqi, 3.25rem)`, balanced, the largest type on the page |
| Project name               | Serif                         | `clamp(1.75rem, 3.6cqi, 2.25rem)`                                          |
| Summary lead               | Serif                         | `clamp(1.25rem, 2.2cqi, 1.4375rem)`, max 36em                              |
| Body / highlights          | Grotesk                       | 15px, 1.5                                                                  |
| Labels                     | Mono caps                     | 11px, +0.08em                                                              |
| Facts                      | Mono                          | 12–24px                                                                    |

Font loading uses one Google Fonts request (`HALYARD_FONT_URL`, `display=swap`) with preconnect.
Metric-adjusted local fallbacks (`size-adjust`/`ascent-override`) keep the swap from shifting
layout. The fragment never loads fonts.

## Layout language

- Layout responds to the **container** (`container: ovn / inline-size`), not the viewport, so the
  fragment in a narrow Fleet panel lays out like the page on a phone.
- The page is at most 1240px wide. From 1080px it uses a main column plus a 19rem sticky **rail**
  (numbers and the agents lane) behind a hairline, rather than stretching the column. Below that,
  the rail dissolves (`display: contents`) and its sections are ordered into the flow.
- Order: masthead, warnings notice, headline + health tally, numbers, **01 Needs you**, agents vs
  you, **02 Projects**, the quiet line, then the colophon.
- Rules carry the hierarchy: a 3px + 1px double rule under the nameplate, a 1px ink rule under each
  numbered section label, and hairlines between rows. There are no boxed cards.
- Needs-you rows follow `kind icon · reason pills · title · project/detail · age · action`. Rows
  carry a 2px status bar and get 44px hit areas on touch widths.

## Motion

There is one choreographed moment: on load, sections rise 10px and fade in, staggered from 0 to
420ms (`--fl-dur-slow`, `--fl-ease-out`). It uses transform and opacity only and is pure CSS, so it
works without JS. It sits inside `prefers-reduced-motion: no-preference`, and reduced motion
removes animations and transitions entirely. Hover and focus colour changes use `--fl-dur-fast`.
The details marker morphs from plus to minus (background-size only).

## Interaction

Everything works without JS: `<details>` for activity lists and overflow, and real links for
older/newer. A small inline script (under 2KB) adds `j`/`k` row focus, `←`/`→` editions, `g` `i`
for the archive, and `?` for a native `<dialog>` shortcut sheet (Esc closes it). Keyboard hints
appear only once JS has run. Focus rings use `--fl-focus`. Printing opens every `<details>` and
switches to ink on white.

## States

| State             | Treatment                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quiet night       | The masthead stays. "No activity in this window. Nothing needs you this morning." The numbers and agents lane are dropped, and one muted line lists the projects. |
| All green         | Needs-you is omitted, replaced by a single line: "Nothing needs you this morning. Everything that ran, passed."                                                   |
| Rough night       | A 3px danger rule sits above the headline and the Needs-you rule turns red. Up to 5 rows show, then "+N more" in a `<details>`.                                   |
| LLM fallback      | A `summaries: deterministic` mono note in the dateline, plus a colophon line.                                                                                     |
| Partial data      | A collapsible warn notice under the masthead; affected projects get a `partial data` tag.                                                                         |
| First run         | "This is the first edition. Tomorrow's will compare against today." The trend reads "1 of 14 nights".                                                             |
| Archive first run | One row, plus "Earlier editions will appear here…"                                                                                                                |

## Progress log

- **2026-10-07, round 0:** replaced the indigo SaaS card UI (Inter, gradients, tile grid) with the
  broadsheet system on Halyard. Added the token sync, history-driven sparklines, the agents lane,
  the keyboard script and print styles.
- **2026-10-07, round 1 (360/768/1280/1920, light and dark, 9 states):** headless Chrome clamps
  windows to about 500px, so narrow shots are rendered through an iframe sized to the target
  width. Fixes: the headline measure was capped in body ems (it ran to 5 lines), so it now uses
  `52rem`; the masthead trend wrapped under the date, so its caption is narrower; the quiet state
  said "quiet" three times (headline, tally, calm line), so the tally is dropped and the line is
  now "No activity in this window"; "All activity" broke across lines at 360; and a single red
  project with a long list was styled as a rough night, so rough now means 2 or more red projects.
- **2026-10-07, round 2:** the 80px date nameplate competed with the headline, which broke "one
  focal point". The date is now a 46px serif dateline (muted italic weekday) and the headline is
  the largest type on the page (up to 52px), with a tighter masthead rhythm.
- **2026-10-07, round 3:** a failure under a minute old read "0m ago", so it now reads "just
  now"; the dateline separators indented oddly when wrapping on phones, so they now apply only
  from 640px.
- **2026-10-07, round 4 (all 7 scenarios × page/archive/email × light/dark × 360/768/1280/1920, 168 shots via
  `npm run visual`):** the ground rendered mid-grey (`#3b3c3c`) instead of ink. Halyard's `--fl-grain` tile is 55%
  noise meant for its own layer, but the page painted it directly. Grain now sits on `.ovn-root::before` at
  `--fl-grain-opacity` with `mix-blend-mode: overlay`, so the measured ground is `#0b0d0c` dark and `#f3f0e8` light.
  The harness 360 shots were laid out at ~500px and cropped (headless Chrome clamps the window), so narrow widths now
  render in an exact-width iframe. Headless Chrome 154 also never exits after `--screenshot`, so the harness accepts
  a finished, size-stable PNG and kills the process group (24 min → 30 s per scenario).
- **2026-10-07, round 5:** the masthead trend wrapped under the date as an orphaned block at 360/768, so below 1080px
  it is a full-width row with a one-line caption. Seven stats split 5 + 2 at 768, so from 640px the grid is 4
  columns (4 + 3). The agents lane bars stayed 64px across a 600px row, so they now fill the row until the rail
  appears. The partial-data notice clipped at 360, so it now wraps. In the email, a deploy with no commit message was
  titled just "main", so it now reads "Production deploy (main)".
- **2026-10-07, round 6:** the email "light" shots were dark because email dark mode follows the OS scheme, not
  `[data-theme]`, so the harness pins the media query per theme. First-run shots never showed the first-edition state
  because the harness passed no edition, so it now passes the index length (No. 001 vs No. 014). At 360 the trend
  caption still wrapped beside the sparkline, so the trend row now wraps the caption under it.
- **2026-10-07, round 7:** archive rows at 640–1079px truncated headlines to about 20 characters because the stats
  shared the row, so the stats now sit under the headline until 1080px. The latest-card trend caption stacked into 3
  narrow lines, so it is now wider.
- **2026-10-07, round 8 (verification):** all 168 shots re-checked. Index rows read in full at 768, rough-night
  hierarchy (red rule, red needs-you rule, +9 more) holds at 1280, and the email light and dark both use Halyard
  values (contrast ≥ 4.5:1 for text, drift-tested). The baseline was committed from this round. Known limitation:
  the harness has no stored history, so page shots show "1 of 14 nights". Real archives show the full trend (see
  the archive shot).
