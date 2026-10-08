#!/usr/bin/env node
// Copies Halyard (packages/ui) tokens + font URL into src/render/halyard.generated.ts so the
// standalone digest pages can inline them without a runtime dependency on @fleet/ui.
// Usage: npm run sync-tokens (also runs as prebuild). test/halyard-sync.test.ts fails on drift.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const TOKENS = here('../../ui/tokens.css');
const UI_INDEX = here('../../ui/src/index.ts');
const OUT = here('../src/render/halyard.generated.ts');

/** Body of a JS template literal: escape the three sequences that are special inside backticks. */
function templateBody(s) {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

const css = await readFile(TOKENS, 'utf8');
// The CSS is inlined raw into a <style> element: a closing tag would end it early.
if (/<\/style/i.test(css)) {
  throw new Error(`sync-tokens: ${TOKENS} contains "</style"; refusing to inline it into a <style> element`);
}
const index = await readFile(UI_INDEX, 'utf8');
const m = /export const FONT_URL\s*=\s*\n?\s*'([^']+)'/.exec(index);
if (!m || !m[1]) throw new Error(`sync-tokens: FONT_URL not found in ${UI_INDEX}`);
const fontUrl = m[1];
if (!/^https:\/\/fonts\.googleapis\.com\//.test(fontUrl)) {
  throw new Error(`sync-tokens: unexpected FONT_URL ${JSON.stringify(fontUrl)}`);
}

const out = `// generated — run npm run sync-tokens (source: packages/ui/tokens.css, packages/ui/src/index.ts). Do not edit.
export const HALYARD_TOKENS_CSS = \`${templateBody(css)}\`;

export const HALYARD_FONT_URL =
  '${fontUrl}';
`;
await writeFile(OUT, out, 'utf8');
console.log(`sync-tokens: wrote ${OUT}`);
