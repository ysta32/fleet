import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  palette,
  motion,
  icons,
  ICON_NAMES,
  ADDED_GLOBAL_TOKENS,
  ADDED_THEME_TOKENS,
  COLOR_TOKENS,
} from './index.js';

const root = join(__dirname, '..');
const css = readFileSync(join(root, 'tokens.css'), 'utf8');
function block(re: RegExp): Record<string, string> {
  const m = css.match(re);
  if (!m || m.index === undefined) throw new Error(`block ${re} missing`);
  const start = css.indexOf('{', m.index) + 1;
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--fl-([\w-]+):\s*([^;]+);/g)].map((d) => [d[1], d[2].replace(/\s+/g, ' ').trim()]),
  );
}
const base = block(/^:root\s*\{/m);
const dark = { ...base, ...block(/^:root,\s*\n:root\[data-theme='dark'\]\s*\{/m) };
const light = { ...base, ...block(/^:root\[data-theme='light'\]\s*\{/m) };

describe('palette mirrors tokens.css', () => {
  for (const [name, theme] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    it(name, () => {
      for (const [k, hex] of Object.entries(palette[name])) expect(theme[k], `${name} ${k}`).toBe(hex);
    });
  }
  it('light media-query block equals [data-theme=light] block', () => {
    const mq = css.slice(css.indexOf('@media (prefers-color-scheme: light)'));
    const inner = block(/:root:not\(\[data-theme='dark'\]\)\s*\{/m);
    expect(mq.length).toBeGreaterThan(0);
    expect(inner).toEqual(block(/^:root\[data-theme='light'\]\s*\{/m));
  });
});

describe('frozen + added token names exist', () => {
  it('every COLOR_TOKEN and added token is declared', () => {
    for (const t of COLOR_TOKENS) expect(dark[t] ?? base[t], t).toBeDefined();
    for (const t of COLOR_TOKENS) expect(light[t] ?? base[t], t).toBeDefined();
    for (const t of ADDED_THEME_TOKENS) {
      expect(dark[t], t).toBeDefined();
      expect(light[t], t).toBeDefined();
    }
    for (const t of ADDED_GLOBAL_TOKENS) expect(base[t], t).toBeDefined();
  });
});

describe('motion mirrors tokens.css', () => {
  it('durations', () => {
    for (const [k, ms] of Object.entries(motion.duration))
      expect(base[`dur-${k}`] ?? base[k], k).toBe(`${ms}ms`);
  });
  it('easings', () => {
    const map = {
      out: 'ease-out',
      inOut: 'ease-in-out',
      spring: 'ease-spring',
      dispatch: 'ease-dispatch',
      land: 'ease-land',
      alert: 'ease-alert',
    } as const;
    for (const [k, curve] of Object.entries(motion.easing))
      expect(base[map[k as keyof typeof map]], k).toBe(motion.cssEasing(curve));
  });
  it('ease() is monotone at endpoints and matches linear for a linear curve', () => {
    expect(motion.ease(motion.easing.land, 0)).toBe(0);
    expect(motion.ease(motion.easing.land, 1)).toBe(1);
    expect(motion.ease([0.25, 0.25, 0.75, 0.75], 0.37)).toBeCloseTo(0.37, 4);
    expect(motion.ease(motion.easing.land, 0.5)).toBeGreaterThan(0.8);
  });
  it('dur() respects reduced motion', () => {
    expect(motion.dur('land', true)).toBe(0);
    expect(motion.dur('land', false)).toBe(420);
  });
});

describe('icons', () => {
  it('map matches icons/*.svg', () => {
    const files = readdirSync(join(root, 'icons')).filter((f) => f.endsWith('.svg'));
    expect(ICON_NAMES.length).toBe(files.length);
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(28);
    for (const f of files)
      expect(icons[f.slice(0, -4) as keyof typeof icons]).toBe(
        readFileSync(join(root, 'icons', f), 'utf8').trim(),
      );
  });
});
