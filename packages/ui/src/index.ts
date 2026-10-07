/** Halyard token names (frozen). Values live in ../tokens.css; this is the typed name list + helpers. */
export const TOKEN_PREFIX = '--fl-';
export const COLOR_TOKENS = [
  'bg',
  'surface-1',
  'surface-2',
  'surface-3',
  'border',
  'border-strong',
  'fg',
  'fg-muted',
  'fg-subtle',
  'accent',
  'accent-fg',
  'success',
  'warn',
  'danger',
  'info',
  'focus',
  'series-1',
  'series-2',
  'series-3',
  'series-4',
  'series-5',
  'series-6',
  'series-7',
  'series-8',
  'model-opus',
  'model-sonnet',
  'model-haiku',
  'model-fable',
  'model-astra',
  'model-unknown',
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];
export const v = (name: string): string => `var(${TOKEN_PREFIX}${name})`;
export const FONT_URL =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&family=Schibsted+Grotesk:wght@400;500;600;700&display=swap';
