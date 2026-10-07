# @fleet/ui: Halyard

Fleet's design system: CSS tokens, fonts, a custom icon set, a brand mark, and JS mirrors of motion and palette for WebGL. The full rationale (palette, type, motion, voice, layout, states, keyboard map) is in [`/DESIGN.md`](../../DESIGN.md).

## Install the tokens once

```ts
// app entry (e.g. packages/web/src/main.tsx)
import '@fleet/ui/fonts.css'; // Instrument Serif, Schibsted Grotesk, IBM Plex Mono
import '@fleet/ui/tokens.css'; // --fl-* variables, dark/light, reduced motion, focus/selection/scrollbars
```

The theme follows `prefers-color-scheme`. To force a theme, set `<html data-theme="dark">` or `data-theme="light"`.

## Use tokens, never raw values

```css
.panel {
  background: var(--fl-surface-1) var(--fl-gradient-surface);
  border: var(--fl-hairline) solid var(--fl-border);
  border-radius: var(--fl-radius-lg);
  padding: var(--fl-space-5) var(--fl-space-6);
  box-shadow: var(--fl-elev-1);
}
.panel[data-entering] {
  animation: land var(--fl-motion-land) both;
}
.kpi {
  font: 500 var(--fl-text-2xl) / var(--fl-leading-tight) var(--fl-font-mono);
  font-variant-numeric: tabular-nums;
}
.title {
  font: var(--fl-text-2xl) / var(--fl-leading-display) var(--fl-font-display);
  letter-spacing: var(--fl-tracking-display);
}
.canvas::after {
  /* grain */
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: var(--fl-grain);
  background-size: var(--fl-grain-size);
  opacity: var(--fl-grain-opacity);
  mix-blend-mode: overlay;
}
```

In TS, `v('accent')` returns `'var(--fl-accent)'`. `COLOR_TOKENS` is the frozen name list. `ADDED_THEME_TOKENS` and `ADDED_GLOBAL_TOKENS` list the tokens added after the freeze. **Token names are frozen and changes are add-only.**

## Icons

```ts
import { icons, type IconName } from '@fleet/ui';
el.innerHTML = icons.blocked; // 20x20 SVG string, stroke = currentColor, size via CSS
```

In React: `<span className="icon" aria-hidden dangerouslySetInnerHTML={{ __html: icons[name] }} />`. Size the icon with `width/height: var(--fl-icon-sm | --fl-icon-md)` on the inner `svg`. Always pair it with a visible label or an `aria-label`. Raw files live in `@fleet/ui/icons/*.svg` (in `files`).

To add an icon, draw `icons/<kebab-name>.svg` following the rules in DESIGN.md, then run `npm run icons -w @fleet/ui`. That validates the SVGs and regenerates `src/icons.ts`.

## Motion (JS / r3f)

```ts
import { motion } from '@fleet/ui';
const { duration, easing } = motion.named.land; // 420ms, [0.16, 1, 0.3, 1]
const ms = motion.dur('alert'); // 0 when prefers-reduced-motion
useFrame(() => {
  mesh.scale.setScalar(1 + 0.2 * motion.ease(motion.easing.alert, t));
});
```

`dispatch` is for things leaving, `land` for things arriving, and `alert` is a single needs-you pulse that never loops.

## Palette (WebGL / canvas)

```ts
import { palette, hexToInt, hexToRgb01 } from '@fleet/ui';
const p = palette[theme]; // 'dark' | 'light'
material.color.setHex(hexToInt(p['model-opus']));
uniforms.uBg.value = hexToRgb01(p.bg);
```

## Recipes for other packages

- **Overnight digest:** title in `--fl-font-display` at `--fl-text-2xl`, one row per army (not cards), mono numbers with units, `land` stagger at `--fl-stagger`. Empty state copy: "Quiet night. Nothing ran between 23:00 and 07:00."
- **Spend:** today's total in mono at `--fl-text-2xl`, series colors `--fl-series-1..8` (or `--fl-model-*` when grouped by model), the delta colored `--fl-danger` when up and `--fl-success` when down, always with a sign and a percentage. Use `icons.cost` and `icons.token` for row icons.

## Brand

`brand/mark.svg` (the pennant stays orange, mast and orbit use `currentColor`), `brand/wordmark.svg`, `brand/favicon.svg`.

## Checks

```sh
npm run build -w @fleet/ui           # tsc
npm run check:design -w @fleet/ui    # icons valid + src/icons.ts fresh, AA contrast audit
npx vitest run packages/ui           # palette/motion mirrors match tokens.css
node packages/ui/scripts/contrast.mjs --write && npx prettier --write DESIGN.md   # refresh the DESIGN.md table
```
