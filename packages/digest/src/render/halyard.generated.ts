// generated — run npm run sync-tokens (source: packages/ui/tokens.css, packages/ui/src/index.ts). Do not edit.
export const HALYARD_TOKENS_CSS = `/*
 * HALYARD: Fleet design tokens. FROZEN NAMES (values may be tuned by the design task).
 * Prefix --fl-. Theme: dark by default; follows prefers-color-scheme unless [data-theme] is set
 * on <html>: [data-theme="dark"] | [data-theme="light"].
 */
:root {
  /* type */
  --fl-font-display: 'Instrument Serif', 'Iowan Old Style', Georgia, serif;
  --fl-font-sans: 'Schibsted Grotesk', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --fl-font-mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --fl-text-2xs: 0.6875rem; /* 11 */
  --fl-text-xs: 0.75rem; /* 12 */
  --fl-text-sm: 0.8125rem; /* 13 */
  --fl-text-md: 0.9375rem; /* 15 */
  --fl-text-lg: 1.125rem; /* 18 */
  --fl-text-xl: 1.5rem; /* 24 */
  --fl-text-2xl: 2.25rem; /* 36 */
  --fl-text-3xl: 3.5rem; /* 56 */
  --fl-text-4xl: 5.5rem; /* 88 */
  --fl-leading-tight: 1.1;
  --fl-leading-normal: 1.5;
  --fl-tracking-caps: 0.08em;

  /* space (4px base) */
  --fl-space-0: 0;
  --fl-space-1: 2px;
  --fl-space-2: 4px;
  --fl-space-3: 8px;
  --fl-space-4: 12px;
  --fl-space-5: 16px;
  --fl-space-6: 24px;
  --fl-space-7: 32px;
  --fl-space-8: 48px;
  --fl-space-9: 64px;
  --fl-space-10: 96px;
  --fl-space-11: 128px;

  /* radius */
  --fl-radius-xs: 2px;
  --fl-radius-sm: 4px;
  --fl-radius-md: 6px;
  --fl-radius-lg: 10px;
  --fl-radius-pill: 999px;

  /* motion */
  --fl-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --fl-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --fl-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --fl-dur-instant: 80ms;
  --fl-dur-fast: 140ms;
  --fl-dur-base: 220ms;
  --fl-dur-slow: 420ms;
  --fl-dur-cinematic: 900ms;

  /* model identity (same in both themes) */
  --fl-model-opus: #ff6a2b;
  --fl-model-sonnet: #7fd1d9;
  --fl-model-haiku: #b6e85a;
  --fl-model-fable: #e9e2cf;
  --fl-model-astra: #e58ac9;
  --fl-model-unknown: #8a8f88;
}

/* dark (default) */
:root,
:root[data-theme='dark'] {
  color-scheme: dark;
  --fl-bg: #0b0d0c;
  --fl-surface-1: #121514;
  --fl-surface-2: #181c1a;
  --fl-surface-3: #20251f;
  --fl-border: rgba(233, 226, 207, 0.09);
  --fl-border-strong: rgba(233, 226, 207, 0.18);
  --fl-fg: #ece7da;
  --fl-fg-muted: #a7a596;
  --fl-fg-subtle: #6f7069;
  --fl-accent: #ff6a2b;
  --fl-accent-fg: #0b0d0c;
  --fl-success: #9be564;
  --fl-warn: #f5b83d;
  --fl-danger: #ff5964;
  --fl-info: #7fd1d9;
  --fl-focus: #ffb547;
  --fl-series-1: #ff6a2b;
  --fl-series-2: #7fd1d9;
  --fl-series-3: #b6e85a;
  --fl-series-4: #f5b83d;
  --fl-series-5: #e58ac9;
  --fl-series-6: #e9e2cf;
  --fl-series-7: #5fa88a;
  --fl-series-8: #c98b5a;
  --fl-elev-0: none;
  --fl-elev-1: 0 1px 0 rgba(255, 255, 255, 0.03) inset, 0 1px 2px rgba(0, 0, 0, 0.5);
  --fl-elev-2: 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 8px 24px rgba(0, 0, 0, 0.45);
  --fl-elev-3: 0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 24px 64px rgba(0, 0, 0, 0.6);
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme='dark']) {
    color-scheme: light;
    --fl-bg: #f3f0e8;
    --fl-surface-1: #fbf9f4;
    --fl-surface-2: #ffffff;
    --fl-surface-3: #ece8dd;
    --fl-border: rgba(24, 26, 22, 0.1);
    --fl-border-strong: rgba(24, 26, 22, 0.2);
    --fl-fg: #181a16;
    --fl-fg-muted: #55574f;
    --fl-fg-subtle: #85877d;
    --fl-accent: #e2511a;
    --fl-accent-fg: #ffffff;
    --fl-success: #3d8a2a;
    --fl-warn: #a86d00;
    --fl-danger: #d1283a;
    --fl-info: #1f7f8a;
    --fl-focus: #e2511a;
    --fl-series-1: #e2511a;
    --fl-series-2: #1f7f8a;
    --fl-series-3: #5d8f1c;
    --fl-series-4: #b07a00;
    --fl-series-5: #b4428f;
    --fl-series-6: #6b6656;
    --fl-series-7: #2f7a5c;
    --fl-series-8: #8f5a2e;
    --fl-elev-0: none;
    --fl-elev-1: 0 1px 2px rgba(24, 26, 22, 0.08);
    --fl-elev-2: 0 8px 24px rgba(24, 26, 22, 0.1);
    --fl-elev-3: 0 24px 64px rgba(24, 26, 22, 0.16);
  }
}
:root[data-theme='light'] {
  color-scheme: light;
  --fl-bg: #f3f0e8;
  --fl-surface-1: #fbf9f4;
  --fl-surface-2: #ffffff;
  --fl-surface-3: #ece8dd;
  --fl-border: rgba(24, 26, 22, 0.1);
  --fl-border-strong: rgba(24, 26, 22, 0.2);
  --fl-fg: #181a16;
  --fl-fg-muted: #55574f;
  --fl-fg-subtle: #85877d;
  --fl-accent: #e2511a;
  --fl-accent-fg: #ffffff;
  --fl-success: #3d8a2a;
  --fl-warn: #a86d00;
  --fl-danger: #d1283a;
  --fl-info: #1f7f8a;
  --fl-focus: #e2511a;
  --fl-series-1: #e2511a;
  --fl-series-2: #1f7f8a;
  --fl-series-3: #5d8f1c;
  --fl-series-4: #b07a00;
  --fl-series-5: #b4428f;
  --fl-series-6: #6b6656;
  --fl-series-7: #2f7a5c;
  --fl-series-8: #8f5a2e;
  --fl-elev-0: none;
  --fl-elev-1: 0 1px 2px rgba(24, 26, 22, 0.08);
  --fl-elev-2: 0 8px 24px rgba(24, 26, 22, 0.1);
  --fl-elev-3: 0 24px 64px rgba(24, 26, 22, 0.16);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --fl-dur-instant: 0ms;
    --fl-dur-fast: 0ms;
    --fl-dur-base: 0ms;
    --fl-dur-slow: 0ms;
    --fl-dur-cinematic: 0ms;
  }
}
`;

export const HALYARD_FONT_URL =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&family=Schibsted+Grotesk:wght@400;500;600;700&display=swap';
