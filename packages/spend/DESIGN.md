# Fleet Spend: design direction (within Halyard)

## Concept
One question per screen: **where is my month going, compared with the budget?** The Spend tab treats a month like a
ship's log: a single large figure (money spent so far), one plain sentence (where it will land and by how much it
misses or clears the budget), and one line drawn toward the month end. Everything else (KPIs, breakdowns, model
mix, daily bars, savings, sources) sits below as supporting evidence, quieter in color and smaller in type.

## Mood
Calm and exact. The feel is a printed instrument panel: warm ink and bone surfaces, one hot accent, no decoration
that does not carry data. Numbers are the hero; prose is short and numeric ("On pace for $710 by Oct 31, $310 over
the $400 budget.").

## Palette usage (Halyard tokens only, `var(--fl-*, <dark fallback>)`)
- Dominant: `--fl-bg`, `--fl-surface-1..3`, `--fl-fg`, `--fl-fg-muted`, `--fl-fg-subtle`. Warm ink (dark) and bone (light).
- One sharp accent, `--fl-accent`, reserved for the focal series: the cumulative line, its forecast and range, the
  current month's daily bars, and the ranked bars. Earlier days and secondary marks use `--fl-fg-subtle`.
- Status colors only for state, always with text: `--fl-warn` (forecast over budget, partial sources), `--fl-danger`
  (over budget, budget-cross callout, errors), `--fl-success` (savings figures, connected sources).
- Burn tint: idle/cool/warm/hot map to `--fl-fg-subtle`/`--fl-info`/`--fl-warn`/`--fl-danger`, shown as a dot plus the word.
- Identity: models use `--fl-model-*` (opus, sonnet, haiku, fable, astra); other models take a stable hashed slot
  from `--fl-series-*`. Color follows the entity, never its rank.
- Depth: layered radial washes of the accent (`color-mix`, 5-11%) over a surface-to-bg gradient on the hero; panels
  carry a faint vertical gradient. No flat default backgrounds, no purple or blue gradients.

## Type
- Display serif `--fl-font-display` (Instrument Serif): the marketing headline, the hero sentence, the onboarding title. Sparingly.
- UI sans `--fl-font-sans` (Schibsted Grotesk): labels, buttons, prose.
- Mono `--fl-font-mono` (IBM Plex Mono) with `tabular-nums`: every number and dollar figure.
- Scale contrast: hero figure `clamp(3rem, 12cqi, 6.5rem)` with tight tracking (-0.045em) and dimmed cents, against
  11-13px eyebrows and labels. Eyebrows are uppercase with `--fl-tracking-caps`.

## Motion
One choreographed entrance, transform and opacity only, durations from tokens (reduced motion sets them to 0, and
a scoped `prefers-reduced-motion` rule disables animation outright):
1. Hero figure and sentence rise 10px and fade in (`--fl-dur-slow`).
2. The chart's data layer grows up from the baseline (`scaleY`, `--fl-dur-cinematic`).
3. Labels, markers and the budget-cross callout fade in after the line lands (700ms delay).
4. KPI tiles stagger in at 60ms steps.
Micro-interactions: segmented control presses scale to 0.96; ranked rows and bars highlight on hover/focus; the
chart crosshair and tooltip follow pointer or arrow keys.

## Layout language
- One column of sections, max width set by the host; `container-type: inline-size` on `.fls-root`, so the layout
  responds to the space it is given (Fleet tab, standalone page, marketing frame) rather than the viewport.
- Order: status chips, alerts, hero (figure, sentence, chart), KPI strip (Today, Budget left, Forecast, Savings),
  breakdown + model mix (3:2 above 860px), daily bars, savings cards, sources, footnote.
- KPI strip: 1 column under 400px, 2 columns, 4 columns from 760px. Hairline dividers via a 1px grid gap.
- Charts: SVG for marks (non-scaling strokes), HTML for every label so text never stretches. One y axis, starting at zero.
- Spacing and radii only from `--fl-space-*` and `--fl-radius-*`.

## States
- `summary === undefined`: skeleton in the final layout (hero, KPIs, panels), `aria-busy`, shimmer disabled under reduced motion.
- `summary === null`: first run. Lists all six sources with how to enable each, plus `npx fleet-spend`.
- `error`: inline `role="alert"` banner with a plain cause; shown above data when data exists.
- Partial sources: badge in the status row and a banner naming what is missing; totals say they exclude it.
- No budget: "No budget" tile with the command to set one; the hero omits the budget rule.
- Empty month: charts show plain empty messages instead of zero-height marks.
- Every figure derived from logs is labeled estimated; the price table version is in the footnote.

## Accessibility
Charts are focusable groups with arrow-key navigation, a `role="tooltip"` referenced by `aria-describedby`, a
polite live region, and a visually hidden data table. The segmented control is a tablist with roving tabindex and
arrow keys. Focus rings use `--fl-focus`. Status is never color alone.

## Progress log
- Round 0 (before): original inline-styled tab (generic grey cards, blue accent, sparkline only, marketing copy
  citing unverified "9x" and "$29 to $750").
- Round 1: rebuilt on Halyard tokens with a scoped stylesheet. Hero cumulative chart with budget rule, forecast and
  range band, budget-cross callout; ranked breakdown with keyboard tabs; model mix (cost vs tokens); 31-day bars;
  savings cards; sources; skeleton, onboarding and error states. Fixed: React escaped `>` in the injected style text
  (hydration mismatch), now injected raw. Copy rewritten per D-10. Demo data made internally consistent.
- Round 2: made the month-to-date figure the single focal point (giant mono figure, serif sentence, chart in one
  hero block with layered accent washes); moved Today into the KPI strip; added the choreographed entrance; muted
  current-month bars so the hero line leads; fixed the marketing headline selector (it leaked into the nested hero
  eyebrow) and enlarged the headline; segmented control scrolls instead of wrapping on phones; budget tag hidden on
  narrow widths to avoid colliding with the callout; KPI grid no longer leaves an empty cell at tablet width;
  skeleton now mirrors the hero layout.
