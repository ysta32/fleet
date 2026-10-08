/**
 * Halyard palette, JS mirror of the hex colour tokens in ../tokens.css, for WebGL / canvas / r3f
 * where CSS variables are unavailable. Keep in sync with tokens.css (enforced by motion-palette.test.ts).
 */
const model = {
  'model-opus': '#ff6a2b',
  'model-sonnet': '#7fd1d9',
  'model-haiku': '#b6e85a',
  'model-fable': '#e9e2cf',
  'model-astra': '#e58ac9',
  'model-unknown': '#8a8f88',
} as const;

const dark = {
  bg: '#0b0d0c',
  'surface-1': '#121514',
  'surface-2': '#181c1a',
  'surface-3': '#20251f',
  fg: '#ece7da',
  'fg-muted': '#a7a596',
  'fg-subtle': '#8a8b82',
  accent: '#ff6a2b',
  'accent-fg': '#0b0d0c',
  success: '#9be564',
  warn: '#f5b83d',
  danger: '#ff5964',
  info: '#7fd1d9',
  focus: '#ffb547',
  'series-1': '#ff6a2b',
  'series-2': '#7fd1d9',
  'series-3': '#b6e85a',
  'series-4': '#f5b83d',
  'series-5': '#e58ac9',
  'series-6': '#e9e2cf',
  'series-7': '#5fa88a',
  'series-8': '#c98b5a',
  skeleton: '#1b1f1d',
  'skeleton-shine': '#232825',
  ...model,
} as const;

const light = {
  bg: '#f3f0e8',
  'surface-1': '#fbf9f4',
  'surface-2': '#ffffff',
  'surface-3': '#ece8dd',
  fg: '#181a16',
  'fg-muted': '#55574f',
  'fg-subtle': '#64665c',
  accent: '#b5400e',
  'accent-fg': '#ffffff',
  success: '#347524',
  warn: '#8e5c00',
  danger: '#c42637',
  info: '#1c717b',
  focus: '#b5400e',
  'series-1': '#b5400e',
  'series-2': '#1f7f8a',
  'series-3': '#5d8f1c',
  'series-4': '#b07a00',
  'series-5': '#b4428f',
  'series-6': '#6b6656',
  'series-7': '#2f7a5c',
  'series-8': '#8f5a2e',
  skeleton: '#e6e2d6',
  'skeleton-shine': '#f0ece2',
  // darker model identities so dots and swatches hold 3:1 on light surfaces (mirrors tokens.css)
  'model-opus': '#c2501c',
  'model-sonnet': '#1f7f8a',
  'model-haiku': '#5d8f1c',
  'model-fable': '#857a5c',
  'model-astra': '#b4428f',
  'model-unknown': '#767a73',
} as const satisfies Record<keyof typeof dark, string>;

export type PaletteKey = keyof typeof dark;
export type ThemeName = 'dark' | 'light';
export const palette: { readonly dark: typeof dark; readonly light: typeof light } = { dark, light };

/** '#rrggbb' -> 0xrrggbb (three.js Color / setHex). */
export const hexToInt = (hex: string): number => {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`hexToInt: expected #rrggbb, got ${hex}`);
  return parseInt(hex.slice(1), 16);
};
/** '#rrggbb' -> [r, g, b] in 0..1 (WebGL uniforms). */
export const hexToRgb01 = (hex: string): [number, number, number] => {
  const n = hexToInt(hex);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
