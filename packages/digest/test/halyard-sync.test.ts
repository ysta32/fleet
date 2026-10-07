import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { HALYARD_FONT_URL, HALYARD_TOKENS_CSS } from '../src/render/halyard.generated.js';

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

describe('halyard.generated.ts', () => {
  it('matches packages/ui/tokens.css exactly (run `npm run sync-tokens` if this fails)', async () => {
    const css = await readFile(path('../../ui/tokens.css'), 'utf8');
    expect(HALYARD_TOKENS_CSS).toBe(css);
  });

  it('matches FONT_URL in packages/ui/src/index.ts', async () => {
    const src = await readFile(path('../../ui/src/index.ts'), 'utf8');
    const m = /export const FONT_URL\s*=\s*\n?\s*'([^']+)'/.exec(src);
    expect(m?.[1]).toBeTruthy();
    expect(HALYARD_FONT_URL).toBe(m?.[1]);
  });

  it('carries the generated header and is safe to inline into <style>', async () => {
    const file = await readFile(path('../src/render/halyard.generated.ts'), 'utf8');
    expect(file.startsWith('// generated — run npm run sync-tokens')).toBe(true);
    expect(HALYARD_TOKENS_CSS).not.toMatch(/<\/style/i);
    expect(HALYARD_TOKENS_CSS).toContain('--fl-bg');
  });
});
