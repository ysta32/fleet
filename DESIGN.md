# Halyard: the Fleet design system

Fleet is local mission control for Claude Code agents: a live 3D view of the fleet, a dashboard of sessions, armies, PRs, deploys and spend, a phone PWA, and notifications. It is built for one person: a solo developer running a dozen or more agents at once, often from another room. Halyard is the design system behind it. This document is the source of truth for every surface (app, phone, site). Tokens live in `packages/ui/tokens.css`; JS mirrors and icons live in `@fleet/ui`.

## 1. Concept

**A harbour at night, with one signal flare.** A halyard is the line that raises a signal flag up a mast. Fleet's job is the same: most of the time nothing needs you, and the interface stays dark, quiet and legible like instruments on a bridge. When an agent is blocked, CI goes red or spend jumps, one signal goes up in orange, and you should be able to see it from across the room.

Three ideas follow from that:

1. **Quiet by default, loud on purpose.** Neutral ink and bone carry about 90% of every screen. Signal orange is reserved for "needs you" and the one primary action. If two things on a screen are orange, one of them is wrong.
2. **Instruments, not marketing.** Numbers are set in mono with tabular figures, aligned on the right, with units. Charts are thin-line and annotated in place. Nothing is decoration unless it carries state.
3. **Editorial calm.** A serif display face (Instrument Serif) for the few big moments (page titles, the hero numeral of today's spend, empty-state headlines) gives Fleet a voice no other dev tool has. It looks like a logbook, not a SaaS template.

**Mood words:** night watch, logbook, signal, brass and bone, unhurried precision.
**Not:** neon cyberpunk, purple AI gradients, glassmorphism everywhere, playful mascots.

## 2. Research: who we learn from

I did this research from hands-on familiarity with these products as of 2026. No web search was available in this run. Each entry lists what to match and what to avoid.

| Product                                                                              | What it does well                                                                                                                                                                                         | Take                                                                                                                                   | Leave                                                                                                         |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Linear**                                                                           | Speed as a feature: optimistic updates, keyboard-first (`C`, `G then I`), a command palette that drives everything, triage inbox, very consistent density. Backend: sync engine, offline cache, webhooks. | Cmd-K for everything, two-key `G` navigation, optimistic writes with undo toasts, inbox-zero framing.                                  | Monochrome sameness. Every Linear clone looks alike.                                                          |
| **Vercel dashboard**                                                                 | Deploy timeline with live build logs, clear status (Ready/Error/Building), preview URLs, instant rollback, a runtime-logs filter bar.                                                                     | A status vocabulary with one color per state, live log streaming, one-click rollback, "last deployed 3m ago" relative time everywhere. | Black/white with a blue accent: generic now.                                                                  |
| **Raycast**                                                                          | A launcher with extensions, sub-100ms response, perfect keyboard flow, action panel (`Cmd-K` inside a result).                                                                                            | Nested actions per row (`Cmd-K` on a session lists its actions), fuzzy search with ranked recents.                                     | Mac-only chrome idioms on web.                                                                                |
| **Grafana / Datadog**                                                                | Dense time-series, shared crosshair across panels, time-range picker, alert rules, annotations. Backend: retention tiers, query cache.                                                                    | Shared cursor across charts, deploy and incident annotations on spend charts, a global time range.                                     | Panel soup, rainbow series, config-before-value onboarding.                                                   |
| **Things 3**                                                                         | Calm hierarchy, generous whitespace, delightful but brief motion, a "Today" that is genuinely focused.                                                                                                    | A "Now" view that shows only what needs you. Motion that confirms rather than performs.                                                | Too sparse for 20 concurrent agents.                                                                          |
| **Teenage Engineering**                                                              | Instrument aesthetics: monospaced labels, numbered controls, one hot color, strict grids.                                                                                                                 | Numbered and labelled instrument panels, a single accent, UPPERCASE micro-labels only for units and axes.                              | Novelty over clarity.                                                                                         |
| **Stripe dashboard**                                                                 | Money done right: exact amounts, currency, period comparisons, drill-down from aggregate to line item, excellent empty states with test data.                                                             | Spend drill-down (fleet, then project, then session, then turn) and period deltas with sign and color.                                 | Light-only corporate calm.                                                                                    |
| **ccusage / Claude Code usage monitors, Conductor, Vibe Kanban, LangSmith/AgentOps** | Token and cost tallies from local JSONL (ccusage), parallel agents in worktrees (Conductor), kanban of agent tasks (Vibe Kanban), trace trees with latency and cost per span (LangSmith/AgentOps).        | Per-model cost math, worktree-per-agent mental model, trace replay of a session's tool calls.                                          | CLI-only output (ccusage), cloud upload of private transcripts (LangSmith/AgentOps), kanban as the only view. |

### Table stakes Fleet must match

- Live session list with state (running, waiting on you, blocked, idle, done), model, project, worktree, elapsed time, tokens and cost.
- Spend by day, model and project, with exact numbers and period comparison (ccusage parity or better).
- PR, CI and deploy status per project, linked out (Vercel/GitHub parity for status vocabulary).
- Notifications for blocked or waiting agents and failed CI, with quiet hours.
- Command palette, global search, keyboard navigation, deep links.
- Dark and light, responsive to phone, offline-tolerant (PWA), AA accessible.
- Local-first: transcripts never leave the machine. Rate-limited, validated local API with structured errors.

### Three standout features (where Fleet wins)

1. **The live fleet, in space.** A 3D harbour where every agent is a vessel grouped by army and project, moving when it works, pulsing (`alert` motion) when it needs you. No observability tool shows parallel agents as one spatial system. It has to stay legible: an accessible list mirror and a "flat" 2D fallback under reduced motion or low power.
2. **Overnight digest and replay.** Open Fleet in the morning and get a one-screen logbook of what each army did while you slept: merged PRs, deploys, failures, spend. Any session can be replayed as a scrubbable timeline of tool calls. LangSmith-grade traces, but local, and written as a story rather than a span tree.
3. **Needs-you routing to your phone.** One inbox ranks agents that are blocked or waiting by cost of delay (idle tokens burned, downstream tasks blocked). It pushes to the phone PWA with one-tap responses (approve, retry, open). Other tools notify; Fleet triages.

## 3. Identity

### Name and mark

- **System:** Halyard. **Product:** Fleet.
- **Mark** (`packages/ui/brand/mark.svg`): a mast with a signal pennant, crossed by a tilted orbit with one orange dot. Mast and pennant say signal; the orbit says many agents circling one operator. The pennant and dot are always signal orange (`#ff6a2b`). Mast and orbit take `currentColor`.
- **Wordmark** (`brand/wordmark.svg`): lowercase "fleet", drawn monoline with round terminals to match the icon stroke language. It is drawn as paths, so it has no font dependency.
- **Favicon** (`brand/favicon.svg`): the mark on an ink tile with a 7/32 corner radius. It reads at 16px on both light and dark browser chrome.
- Clear space equals the pennant height on every side. Never recolor the pennant, add effects or place the mark on orange.

### Type system

Banned: Inter, Roboto, Arial, Space Grotesk, and bare system stacks used as the primary face.

| Role                          | Face                                      | Why                                                                                                                                                    |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Display (`--fl-font-display`) | **Instrument Serif** (regular and italic) | High-contrast, condensed editorial serif. Gives Fleet a logbook voice and dramatic scale contrast against the dense UI. Use only at 24px and up.       |
| UI (`--fl-font-sans`)         | **Schibsted Grotesk** 400/500/600/700     | A newspaper grotesk with real character (sharp terminals, a narrow `t`). It stays warm at 13–15px where Inter would look generic.                      |
| Data (`--fl-font-mono`)       | **IBM Plex Mono** 400/500/600             | Engineered, with distinct `0/O` and `1/l`. Use it for every number, ID, branch, path and token count. Always set `font-variant-numeric: tabular-nums`. |

**Scale** (rem at 16px, fixed steps, no in-between sizes):

| Token           | px  | Use                                          | Leading                     | Tracking                            |
| --------------- | --- | -------------------------------------------- | --------------------------- | ----------------------------------- |
| `--fl-text-4xl` | 88  | Site hero, the one big numeral               | `--fl-leading-display` 0.96 | `--fl-tracking-display-xl` -0.032em |
| `--fl-text-3xl` | 56  | Page hero, section openers on the site       | 0.96                        | `--fl-tracking-display` -0.022em    |
| `--fl-text-2xl` | 36  | App page titles (serif), KPI numerals (mono) | `--fl-leading-tight` 1.1    | -0.022em                            |
| `--fl-text-xl`  | 24  | Panel titles, empty-state headlines (serif)  | 1.1                         | `--fl-tracking-tight` -0.02em       |
| `--fl-text-lg`  | 18  | Lead paragraphs, dialog titles               | `--fl-leading-snug` 1.3     | 0                                   |
| `--fl-text-md`  | 15  | Body, form inputs                            | `--fl-leading-normal` 1.5   | 0                                   |
| `--fl-text-sm`  | 13  | Dense UI: table rows, nav, buttons           | 1.5                         | 0                                   |
| `--fl-text-xs`  | 12  | Meta, timestamps, chart axes (mono)          | 1.5                         | 0                                   |
| `--fl-text-2xs` | 11  | UPPERCASE micro-labels, units only           | 1.5                         | `--fl-tracking-caps` 0.08em         |

Rules: one serif moment per screen. Body copy is capped at `--fl-measure` (64ch). Numbers are right-aligned in tables and always show a unit (`$4.12`, `182k tok`, `3m 12s`).

### Palette: committed, not evenly spread

Ratio of use on any screen: **ink and surfaces about 75%, bone text about 17%, muted and series colors about 6%, signal orange 2% or less.**

| Role                           | Dark                                                                                                   | Light                                   | Notes                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| Ink (`bg`)                     | `#0b0d0c`                                                                                              | `#f3f0e8`                               | Green-black, never pure `#000`. Light mode is warm paper, not white.                       |
| Surfaces 1/2/3                 | `#121514` `#181c1a` `#20251f`                                                                          | `#fbf9f4` `#ffffff` `#ece8dd`           | Elevation by lightness steps, plus a hairline `border`.                                    |
| Bone (`fg`)                    | `#ece7da`                                                                                              | `#181a16`                               | Warm off-white text.                                                                       |
| `fg-muted`                     | `#a7a596`                                                                                              | `#55574f`                               | Secondary text, AA on every surface.                                                       |
| `fg-subtle`                    | `#6f7069`                                                                                              | `#7c7e74`                               | Placeholders, disabled, large meta only (3:1).                                             |
| **Signal** (`accent`)          | `#ff6a2b`                                                                                              | `#b5400e`                               | Needs-you and the one primary action. Light mode is a deeper rust so it passes AA as text. |
| `focus`                        | `#ffb547`                                                                                              | `#b5400e`                               | Amber focus in dark, so focus is never confused with signal.                               |
| success / warn / danger / info | `#9be564` `#f5b83d` `#ff5964` `#7fd1d9`                                                                | `#347524` `#8e5c00` `#c42637` `#1c717b` | Status only. Always paired with an icon or label, never color alone.                       |
| Model identity                 | opus `#ff6a2b`, sonnet `#7fd1d9`, haiku `#b6e85a`, fable `#e9e2cf`, astra `#e58ac9`, unknown `#8a8f88` | same                                    | Used for fleet vessels and chart series by model.                                          |

**Depth** (added tokens): `--fl-grain` (tiled SVG fractal noise, blended with `overlay` at `--fl-grain-opacity`) on the app canvas and site sections. `--fl-gradient-horizon` is a low orange glow rising from the bottom edge: the harbour light, used once per page. `--fl-gradient-surface` is a top-lit sheen on raised panels. `--fl-gradient-vignette` frames the 3D scene. `--fl-glow-accent` and `--fl-glow-danger` go on the single focal alert. `--fl-glass` with `--fl-blur-md` is only for overlays above the 3D canvas (palette, toasts). Never put glass on glass.

**Change log for values (this task):** the light-theme accent, success, warn, danger, info and fg-subtle failed AA on `surface-3`. Each was darkened along its own hue: accent `#e2511a` to `#b5400e`, success `#3d8a2a` to `#347524`, warn `#a86d00` to `#8e5c00`, danger `#d1283a` to `#c42637`, info `#1f7f8a` to `#1c717b`, fg-subtle `#85877d` to `#7c7e74`. Light focus and series-1 follow the accent. No token names changed.

### Contrast audit (WCAG 2.x)

Generated by `node packages/ui/scripts/contrast.mjs`, which parses `tokens.css` and exits non-zero on any failure. Thresholds: 4.5 for text, 3 for `fg-subtle` (large or non-essential text only) and `focus` (non-text, SC 1.4.11).

<!-- contrast:start -->

| theme | foreground  | on          | fg hex  | bg hex  | ratio | min | pass |
| ----- | ----------- | ----------- | ------- | ------- | ----: | --: | ---- |
| dark  | `fg`        | `bg`        | #ece7da | #0b0d0c | 15.79 | 4.5 | AA   |
| dark  | `fg`        | `surface-1` | #ece7da | #121514 | 14.88 | 4.5 | AA   |
| dark  | `fg`        | `surface-2` | #ece7da | #181c1a | 13.94 | 4.5 | AA   |
| dark  | `fg`        | `surface-3` | #ece7da | #20251f | 12.64 | 4.5 | AA   |
| dark  | `fg-muted`  | `bg`        | #a7a596 | #0b0d0c |  7.86 | 4.5 | AA   |
| dark  | `fg-muted`  | `surface-1` | #a7a596 | #121514 |  7.41 | 4.5 | AA   |
| dark  | `fg-muted`  | `surface-2` | #a7a596 | #181c1a |  6.94 | 4.5 | AA   |
| dark  | `fg-muted`  | `surface-3` | #a7a596 | #20251f |  6.29 | 4.5 | AA   |
| dark  | `accent`    | `bg`        | #ff6a2b | #0b0d0c |  6.82 | 4.5 | AA   |
| dark  | `accent`    | `surface-1` | #ff6a2b | #121514 |  6.43 | 4.5 | AA   |
| dark  | `accent`    | `surface-2` | #ff6a2b | #181c1a |  6.02 | 4.5 | AA   |
| dark  | `accent`    | `surface-3` | #ff6a2b | #20251f |  5.46 | 4.5 | AA   |
| dark  | `success`   | `bg`        | #9be564 | #0b0d0c | 12.80 | 4.5 | AA   |
| dark  | `success`   | `surface-1` | #9be564 | #121514 | 12.06 | 4.5 | AA   |
| dark  | `success`   | `surface-2` | #9be564 | #181c1a | 11.30 | 4.5 | AA   |
| dark  | `success`   | `surface-3` | #9be564 | #20251f | 10.24 | 4.5 | AA   |
| dark  | `warn`      | `bg`        | #f5b83d | #0b0d0c | 10.96 | 4.5 | AA   |
| dark  | `warn`      | `surface-1` | #f5b83d | #121514 | 10.33 | 4.5 | AA   |
| dark  | `warn`      | `surface-2` | #f5b83d | #181c1a |  9.68 | 4.5 | AA   |
| dark  | `warn`      | `surface-3` | #f5b83d | #20251f |  8.77 | 4.5 | AA   |
| dark  | `danger`    | `bg`        | #ff5964 | #0b0d0c |  6.37 | 4.5 | AA   |
| dark  | `danger`    | `surface-1` | #ff5964 | #121514 |  6.01 | 4.5 | AA   |
| dark  | `danger`    | `surface-2` | #ff5964 | #181c1a |  5.63 | 4.5 | AA   |
| dark  | `danger`    | `surface-3` | #ff5964 | #20251f |  5.10 | 4.5 | AA   |
| dark  | `info`      | `bg`        | #7fd1d9 | #0b0d0c | 11.16 | 4.5 | AA   |
| dark  | `info`      | `surface-1` | #7fd1d9 | #121514 | 10.52 | 4.5 | AA   |
| dark  | `info`      | `surface-2` | #7fd1d9 | #181c1a |  9.86 | 4.5 | AA   |
| dark  | `info`      | `surface-3` | #7fd1d9 | #20251f |  8.93 | 4.5 | AA   |
| dark  | `fg-subtle` | `bg`        | #6f7069 | #0b0d0c |  3.90 |   3 | AA   |
| dark  | `fg-subtle` | `surface-1` | #6f7069 | #121514 |  3.67 |   3 | AA   |
| dark  | `fg-subtle` | `surface-2` | #6f7069 | #181c1a |  3.44 |   3 | AA   |
| dark  | `fg-subtle` | `surface-3` | #6f7069 | #20251f |  3.12 |   3 | AA   |
| dark  | `focus`     | `bg`        | #ffb547 | #0b0d0c | 11.10 |   3 | AA   |
| dark  | `focus`     | `surface-1` | #ffb547 | #121514 | 10.46 |   3 | AA   |
| dark  | `focus`     | `surface-2` | #ffb547 | #181c1a |  9.80 |   3 | AA   |
| dark  | `focus`     | `surface-3` | #ffb547 | #20251f |  8.88 |   3 | AA   |
| dark  | `accent-fg` | `accent`    | #0b0d0c | #ff6a2b |  6.82 | 4.5 | AA   |
| light | `fg`        | `bg`        | #181a16 | #f3f0e8 | 15.39 | 4.5 | AA   |
| light | `fg`        | `surface-1` | #181a16 | #fbf9f4 | 16.66 | 4.5 | AA   |
| light | `fg`        | `surface-2` | #181a16 | #ffffff | 17.53 | 4.5 | AA   |
| light | `fg`        | `surface-3` | #181a16 | #ece8dd | 14.32 | 4.5 | AA   |
| light | `fg-muted`  | `bg`        | #55574f | #f3f0e8 |  6.44 | 4.5 | AA   |
| light | `fg-muted`  | `surface-1` | #55574f | #fbf9f4 |  6.97 | 4.5 | AA   |
| light | `fg-muted`  | `surface-2` | #55574f | #ffffff |  7.34 | 4.5 | AA   |
| light | `fg-muted`  | `surface-3` | #55574f | #ece8dd |  5.99 | 4.5 | AA   |
| light | `accent`    | `bg`        | #b5400e | #f3f0e8 |  4.98 | 4.5 | AA   |
| light | `accent`    | `surface-1` | #b5400e | #fbf9f4 |  5.39 | 4.5 | AA   |
| light | `accent`    | `surface-2` | #b5400e | #ffffff |  5.67 | 4.5 | AA   |
| light | `accent`    | `surface-3` | #b5400e | #ece8dd |  4.63 | 4.5 | AA   |
| light | `success`   | `bg`        | #347524 | #f3f0e8 |  4.96 | 4.5 | AA   |
| light | `success`   | `surface-1` | #347524 | #fbf9f4 |  5.37 | 4.5 | AA   |
| light | `success`   | `surface-2` | #347524 | #ffffff |  5.65 | 4.5 | AA   |
| light | `success`   | `surface-3` | #347524 | #ece8dd |  4.62 | 4.5 | AA   |
| light | `warn`      | `bg`        | #8e5c00 | #f3f0e8 |  5.01 | 4.5 | AA   |
| light | `warn`      | `surface-1` | #8e5c00 | #fbf9f4 |  5.42 | 4.5 | AA   |
| light | `warn`      | `surface-2` | #8e5c00 | #ffffff |  5.70 | 4.5 | AA   |
| light | `warn`      | `surface-3` | #8e5c00 | #ece8dd |  4.66 | 4.5 | AA   |
| light | `danger`    | `bg`        | #c42637 | #f3f0e8 |  5.01 | 4.5 | AA   |
| light | `danger`    | `surface-1` | #c42637 | #fbf9f4 |  5.42 | 4.5 | AA   |
| light | `danger`    | `surface-2` | #c42637 | #ffffff |  5.71 | 4.5 | AA   |
| light | `danger`    | `surface-3` | #c42637 | #ece8dd |  4.66 | 4.5 | AA   |
| light | `info`      | `bg`        | #1c717b | #f3f0e8 |  4.99 | 4.5 | AA   |
| light | `info`      | `surface-1` | #1c717b | #fbf9f4 |  5.40 | 4.5 | AA   |
| light | `info`      | `surface-2` | #1c717b | #ffffff |  5.68 | 4.5 | AA   |
| light | `info`      | `surface-3` | #1c717b | #ece8dd |  4.64 | 4.5 | AA   |
| light | `fg-subtle` | `bg`        | #7c7e74 | #f3f0e8 |  3.62 |   3 | AA   |
| light | `fg-subtle` | `surface-1` | #7c7e74 | #fbf9f4 |  3.92 |   3 | AA   |
| light | `fg-subtle` | `surface-2` | #7c7e74 | #ffffff |  4.12 |   3 | AA   |
| light | `fg-subtle` | `surface-3` | #7c7e74 | #ece8dd |  3.37 |   3 | AA   |
| light | `focus`     | `bg`        | #b5400e | #f3f0e8 |  4.98 |   3 | AA   |
| light | `focus`     | `surface-1` | #b5400e | #fbf9f4 |  5.39 |   3 | AA   |
| light | `focus`     | `surface-2` | #b5400e | #ffffff |  5.67 |   3 | AA   |
| light | `focus`     | `surface-3` | #b5400e | #ece8dd |  4.63 |   3 | AA   |
| light | `accent-fg` | `accent`    | #ffffff | #b5400e |  5.67 | 4.5 | AA   |

74 pairs checked, 0 failing.

<!-- contrast:end -->

### Spacing, radius, elevation

- **Space:** `--fl-space-0..11` = 0, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128. Inside components use 4–16. Between groups use 24–32. Between site sections use 96–128. Never improvise a value outside the scale.
- **Rows:** `--fl-row-h` 32px (default) and `--fl-row-h-compact` 26px (dense tables). The sidebar is `--fl-sidebar-w` 232px, and content maxes out at `--fl-content-max` 1440px. On ultrawide screens the extra width goes to the 3D view, not to wider text.
- **Radius:** `xs` 2 (chips, kbd), `sm` 4 (inputs, buttons), `md` 6 (cards, rows), `lg` 10 (panels, dialogs), `xl` 16 (site media frames, phone sheets), `pill` (status dots and tags only). Radii nest: the inner radius equals the outer radius minus the padding.
- **Elevation:** `elev-0` flat (most things) · `elev-1` raised rows and inputs · `elev-2` popovers and menus · `elev-3` dialogs and the palette. Dark mode uses an inset top highlight plus a deep shadow. Light mode uses soft shadows only.
- **Z:** `--fl-z-sticky` 10 · `overlay` 40 · `palette` 50 · `toast` 60.

### Motion language

Three named verbs. Everything that moves uses one of them. Animate only `transform` and `opacity`.

| Motion       | Token                  | Duration | Easing                                              | Use                                                                                                                                     |
| ------------ | ---------------------- | -------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **dispatch** | `--fl-motion-dispatch` | 260ms    | `cubic-bezier(0.5, 0, 0.75, 0)` (accelerate out)    | Something leaves: agent spawned and sailing off, PR pushed, toast dismissed, row archived.                                              |
| **land**     | `--fl-motion-land`     | 420ms    | `cubic-bezier(0.16, 1, 0.3, 1)` (long settle)       | Something arrives: new session row, panel opens, digest cards stagger in at `--fl-stagger` 24ms (max 8 items, then appear together).    |
| **alert**    | `--fl-motion-alert`    | 640ms    | `cubic-bezier(0.34, 1.56, 0.64, 1)` (one overshoot) | Needs-you: a vessel pulses once, the inbox badge pops once. Never loops. A persistent state is shown with a static glow, not animation. |

Support durations: `instant` 80 (hover color), `fast` 140 (press, toggle), `base` 220 (menus), `slow` 420, `cinematic` 900 (3D camera moves and site scroll reveals only). JS mirror: `import { motion } from '@fleet/ui'` gives `motion.named.land`, `motion.ease(curve, t)` and `motion.dur(name)`, which returns 0 under reduced motion.

**Reduced motion:** every duration token becomes `0ms`. The 3D view stops camera drift and switches pulses to static glows. Scroll reveals render in place. Nothing that communicates state depends on motion.

**Choreography (few, high-impact moments):** (1) first load: the harbour fades up and vessels `land` in army order; (2) an agent becomes blocked: its vessel plays `alert` while the inbox count plays `alert` in sync; (3) a deploy succeeds: the release row runs `land` with a 1px success sweep. That is all. No hover parallax and no idle animation.

### Iconography

A custom set, `packages/ui/icons/*.svg` (38 icons), exported as `icons` from `@fleet/ui`.

- 20×20 grid, 1.5 stroke, round caps and joins, `currentColor`, `fill="none"`. The only filled shapes are dots (circle r ≤ 1.6). This is enforced by `scripts/build-icons.mjs`.
- Draw on a 2px live area. Stroke ends land on .25/.75 coordinates for crisp 1x rendering.
- Render at 16 (`--fl-icon-sm`, inline with 13px text) or 20 (`--fl-icon-md`). Never scale strokes. Size comes from CSS, so there is no width or height attribute.
- An icon always comes with a text label or an `aria-label`. Status icons pair with color, never stand in for it.
- `chevron` points right; rotate it with CSS. `close` dismisses, `x` (circled) means failed.
- Domain vocabulary: fleet, army, agent, session, worktree, task, review, merge, deploy, release, ci, cost, token, live, replay, waiting, blocked, alert, pennant, offline, undo, spark.

### Voice and tone

Operator-grade: written like a good on-call engineer's handoff note. Short, specific and calm.

- Sentence case everywhere: buttons, headings, menu items. Use UPPERCASE only for 11px unit and axis labels.
- Lead with the fact, then the action: "3 agents waiting on you. Review oldest". Not "Looks like some agents might need attention!"
- Use exact numbers with units: "$4.12 today, up 18% from Tuesday", "blocked 14m".
- Use verbs on buttons: "Retry CI", "Open PR", "Approve plan". Never "Submit" or "OK".
- Errors say what happened, why, and what to do: "Collector stopped. Port 4317 is in use. Change the port in Settings or stop the other process."
- Empty states teach: "No sessions yet. Start Claude Code in any repo and it appears here within 2 seconds."
- No exclamation marks except in a first-ever success. No emoji in UI copy.
- **Banned words:** supercharge, unlock, unleash, revolutionize, seamless, effortless, magical, game-changing, cutting-edge, next-level, blazing fast, leverage, empower, synergy, 10x, AI-powered (as a selling point), simply, just (as in "just do X"), oops, whoops.

## 4. Layout language

### App

- **Asymmetric frame:** sidebar (232px) + main work area + an optional right inspector (360px) for the selected session or PR. Never center the app. Content aligns to a hard left edge.
- **One focal point per screen.** On the dashboard it is the "Needs you" strip at the top left. On Spend it is today's total in a 36px mono numeral. Everything else is quieter.
- **No three identical cards.** KPI rows use mixed widths (2:1:1) and mixed forms (numeral + sparkline + list). Tables are the default container for many items. Cards are for heterogeneous summaries.
- **Density modes:** comfortable (32px rows) and compact (26px). The 3D fleet view gets the largest region on screens 1280px and wider, and collapses to a list on phones.
- **Breakpoints:** 360 (phone: a single column with a bottom action bar), 768 (tablet: sidebar collapses to icons), 1280 (full frame), 1920+ (the inspector is always open and 3D expands).

### Site narrative (hook, problem, product, proof, depth, action)

Each section has one job and one message:

1. **Hook:** an 88px serif headline ("Your agents, at a glance.") over the live harbour (a real WebGL render of a recorded fleet), with `--fl-gradient-horizon` rising beneath. One primary action: install command, copyable.
2. **Problem:** a tight, specific paragraph on running twelve agents in twelve terminals and missing the one that has been blocked for 40 minutes. An honest illustration: a split terminal screenshot.
3. **Product:** three moments shown as real UI recordings, laid out asymmetrically (one large and two stacked, not three columns): the live fleet, the needs-you inbox, the overnight digest.
4. **Proof:** real numbers from the author's own usage, labelled as such, plus open-source signals (license, repo, changelog). No fabricated logos, testimonials or user counts.
5. **Depth:** keyboard map, local-first architecture diagram, cost math and phone PWA, each with a live component preview.
6. **Action:** install, docs and GitHub. The same install command repeats, the page ends, and the footer holds the legal and press kit links.

Site sections alternate full-bleed ink with paper inserts for rhythm. The vertical gap between sections is `--fl-space-10/11`. Grain sits on every full-bleed section.

## 5. Components and states

Every data component ships all six states. A state that has not been designed is a bug.

| Component             | Empty / first-run                                                | Loading                                                                                                  | Error                                                                 | Offline                                                                                  | Success                                                                 |
| --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Session table         | Explains how sessions appear, with a copyable `claude` command.  | 6 skeleton rows at row height (`--fl-skeleton` with a shine sweep using `land` easing). No layout shift. | An inline banner with the cause and a retry. Keeps stale rows dimmed. | A "Last synced 2m ago" pill. Rows stay readable and actions are disabled with a tooltip. | The new row runs `land`.                                                |
| Needs-you inbox       | "Nothing needs you." in serif, plus the time of the last alert.  | Skeleton chips.                                                                                          | Banner.                                                               | Shows the queue from cache and holds actions until reconnect.                            | The resolved item runs `dispatch`, with an undo toast (5s).             |
| 3D fleet              | An empty harbour with a single ghost vessel and the setup steps. | Harbour fades up, no spinner.                                                                            | Falls back to the 2D list with a reason.                              | Freezes the scene with a desaturated overlay.                                            | Vessel `land`.                                                          |
| Spend charts          | "No spend recorded for this range." plus a range shortcut.       | An axis skeleton.                                                                                        | Inline error per chart.                                               | Cached.                                                                                  | n/a                                                                     |
| PR / CI / deploy rows | A link to connect GitHub/Vercel.                                 | Skeleton.                                                                                                | Shows the provider error verbatim inside a details element.           | Cached, with a stale badge.                                                              | A success sweep.                                                        |
| Toasts                | n/a                                                              | n/a                                                                                                      | Danger, persistent until dismissed.                                   | An offline toast appears once.                                                           | Auto-dismiss in 5s, with undo for destructive actions. Paused on hover. |
| Command palette       | Recents + suggested commands.                                    | Instant (local index).                                                                                   | "No match for 'x'" with suggestions.                                  | Local commands still work.                                                               | n/a                                                                     |

Use skeletons, never spinners, for anything that reserves layout. A 12px inline progress ring is allowed only inside a button while its action is pending, and the button keeps its width.

## 6. Keyboard map and command palette

| Keys                                       | Action                                                        |
| ------------------------------------------ | ------------------------------------------------------------- |
| `Cmd K` / `Ctrl K`                         | Command palette (everything is reachable from here)           |
| `/`                                        | Focus search in the current view                              |
| `G` then `F` / `D` / `I` / `S` / `P` / `R` | Go to Fleet (3D) / Dashboard / Inbox / Spend / PRs / Replay   |
| `J` / `K`                                  | Next / previous row                                           |
| `Enter`                                    | Open the selection in the inspector                           |
| `Cmd Enter`                                | The primary action on the selection (approve, retry, open PR) |
| `.`                                        | Action menu for the selection (Raycast-style)                 |
| `E`                                        | Resolve (dispatch) the inbox item                             |
| `Z` / `Cmd Z`                              | Undo the last action (within the toast window)                |
| `T`                                        | Toggle the theme                                              |
| `Space`                                    | Play/pause in replay; in 3D, recenter the camera              |
| `?`                                        | Keyboard cheat sheet                                          |
| `Esc`                                      | Close the topmost layer                                       |

**Palette spec:** `--fl-z-palette`, `elev-3`, `--fl-glass` + `--fl-blur-md` over the 3D canvas, 640px wide, anchored 20vh from the top (not centered). Fuzzy matching over commands, sessions, projects, PRs and settings, with groups in that order and recents first. Each result shows an icon, a label, mono meta (project, branch) and a right-aligned shortcut. `Tab` scopes to a group. `.` opens actions for the highlighted result. Opening takes under 16ms from a local index, with no network on open. It is announced as `role="dialog"` with `aria-activedescendant` on a listbox.

## 7. Accessibility

- WCAG 2.2 AA. The contrast audit above is enforced by script.
- Focus: `:focus-visible` uses a `--fl-focus-width` 2px outline in `--fl-focus` at a 2px offset. Composite components use `--fl-focus-ring`. The focus ring is never removed.
- Hit targets are at least 24×24 (WCAG 2.5.8) and 44×44 on the phone PWA.
- Status is never conveyed by color alone (icon + label). Live regions announce new needs-you items politely.
- Reduced motion is honored in CSS and JS (`motion.dur`). The 3D view has a full list equivalent.
- Selection (`--fl-selection`) and scrollbars (`--fl-scrollbar`) are styled in both themes.

## 8. Using it

See `packages/ui/README.md`. In short: import `@fleet/ui/tokens.css` and `@fleet/ui/fonts.css` once, use `var(--fl-*)` everywhere, `icons.name` for SVG strings, `palette.dark|light` for WebGL, and `motion` for JS animation. Checks: `npm run build -w @fleet/ui`, `npm run check:design -w @fleet/ui` (icons valid and up to date, contrast passes), and `npx vitest run packages/ui` (palette and motion mirrors match tokens.css).

## Progress log

- **2026-10-07** · Halyard finalized (task 20-design-system). Research synthesis and the three standout features are written. The light-theme status and accent colors were retuned to pass AA on every surface (74 pairs checked, 0 failing). Added tokens only: named motions (dispatch, land, alert), display tracking and leading, depth (grain, glows, gradients, glass, blur), skeleton, selection, scrollbar, focus ring, layout and z-scale. Shipped 38 custom icons with a validator and generator, the brand mark, wordmark and favicon, and the JS `motion` and `palette` mirrors with sync tests. Still to do: the visual QA loop on real app surfaces (screenshots at 375/768/1280/1920 in both themes), PWA icon PNG set, and OG images.
