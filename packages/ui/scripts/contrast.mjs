#!/usr/bin/env node
// Halyard contrast audit. Parses ../tokens.css, computes WCAG 2.x contrast ratios for every
// text/UI pair we ship, prints a markdown table, and exits 1 if any pair misses its threshold.
// Usage: node packages/ui/scripts/contrast.mjs [--write]   (--write refreshes the table in /DESIGN.md)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'tokens.css'), 'utf8');

/** Extract `--fl-x: #hex` declarations from the first block whose selector matches `selRe`. */
function block(selRe) {
  const m = css.match(selRe);
  if (!m) throw new Error(`theme block not found: ${selRe}`);
  const start = css.indexOf('{', m.index) + 1;
  const end = css.indexOf('}', start);
  const out = {};
  for (const d of css.slice(start, end).matchAll(/--fl-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[d[1]] = d[2];
  return out;
}

const base = block(/^:root\s*\{/m);
const themes = {
  dark: { ...base, ...block(/^:root,\s*\n:root\[data-theme='dark'\]\s*\{/m) },
  light: { ...base, ...block(/^:root\[data-theme='light'\]\s*\{/m) },
};

const lin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const SURFACES = ['bg', 'surface-1', 'surface-2', 'surface-3'];
// [foreground, minimum ratio, role]
const TEXT = [
  ['fg', 4.5, 'body text'],
  ['fg-muted', 4.5, 'secondary text'],
  ['accent', 4.5, 'accent text / links'],
  ['success', 4.5, 'status text'],
  ['warn', 4.5, 'status text'],
  ['danger', 4.5, 'status text'],
  ['info', 4.5, 'status text'],
  ['fg-subtle', 3, 'large text, placeholders, disabled (non-essential)'],
  ['focus', 3, 'focus ring (non-text, 1.4.11)'],
];

const rows = [];
let fail = 0;
for (const [theme, t] of Object.entries(themes)) {
  for (const [fg, min, role] of TEXT) {
    for (const s of SURFACES) {
      if (!t[fg] || !t[s]) throw new Error(`missing token ${fg} or ${s} in ${theme}`);
      const r = ratio(t[fg], t[s]);
      const ok = r >= min;
      if (!ok) fail++;
      rows.push({ theme, fg, s, a: t[fg], b: t[s], r, min, ok, role });
    }
  }
  const r = ratio(t['accent-fg'], t.accent);
  if (r < 4.5) fail++;
  rows.push({
    theme,
    fg: 'accent-fg',
    s: 'accent',
    a: t['accent-fg'],
    b: t.accent,
    r,
    min: 4.5,
    ok: r >= 4.5,
    role: 'button label',
  });
}

const lines = [
  '| theme | foreground | on | fg hex | bg hex | ratio | min | pass |',
  '|---|---|---|---|---|---:|---:|---|',
];
for (const x of rows)
  lines.push(
    `| ${x.theme} | \`${x.fg}\` | \`${x.s}\` | ${x.a} | ${x.b} | ${x.r.toFixed(2)} | ${x.min} | ${x.ok ? 'AA' : '**FAIL**'} |`,
  );
lines.push('', `${rows.length} pairs checked, ${fail} failing.`);
const table = lines.join('\n');
console.log(table);

// --write: replace the block between <!-- contrast:start --> and <!-- contrast:end --> in /DESIGN.md.
if (process.argv.includes('--write')) {
  const doc = join(here, '..', '..', '..', 'DESIGN.md');
  const src = readFileSync(doc, 'utf8');
  const re = /<!-- contrast:start -->[\s\S]*?<!-- contrast:end -->/;
  if (!re.test(src)) throw new Error('DESIGN.md is missing contrast markers');
  writeFileSync(doc, src.replace(re, `<!-- contrast:start -->\n\n${table}\n\n<!-- contrast:end -->`));
}
process.exit(fail ? 1 : 0);
