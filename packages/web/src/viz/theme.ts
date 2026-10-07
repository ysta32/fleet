import type { AgentRole, CiState, ModelFamily, OrchPhase, OrchTaskState } from '@fleet/shared';

/**
 * Halyard design tokens (packages/ui/tokens.css, dark theme) copied as constants:
 * WebGL cannot read CSS custom properties. Keep in sync with --fl-* values.
 */
export const HALYARD = {
  bg: '#0b0d0c',
  surface1: '#121514',
  surface2: '#181c1a',
  surface3: '#20251f',
  border: 'rgba(233, 226, 207, 0.09)',
  borderStrong: 'rgba(233, 226, 207, 0.18)',
  fg: '#ece7da',
  fgMuted: '#a7a596',
  fgSubtle: '#6f7069',
  accent: '#ff6a2b',
  accentFg: '#0b0d0c',
  success: '#9be564',
  warn: '#f5b83d',
  danger: '#ff5964',
  info: '#7fd1d9',
  focus: '#ffb547',
  fontDisplay: "'Instrument Serif', 'Iowan Old Style', Georgia, serif",
  fontSans: "'Schibsted Grotesk', ui-sans-serif, system-ui, -apple-system, sans-serif",
  fontMono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  trackingCaps: '0.08em',
  radiusSm: 4,
  radiusMd: 6,
} as const;

/** Visualizer palette derived from Halyard: warm ink, bone hairlines, one signal-orange accent. */
export const THEME = {
  background: HALYARD.bg,
  fog: HALYARD.bg,
  gridCell: '#171a18',
  gridSection: '#262a26',
  /** hairline geometry (rings, tethers, guides) */
  hairline: HALYARD.fg,
  hairlineDim: HALYARD.fgSubtle,
  stationIdle: HALYARD.fgSubtle,
  stationRunning: HALYARD.accent,
  stationBlocked: HALYARD.danger,
  stationDone: HALYARD.success,
  stationPlain: HALYARD.fgMuted,
  gate: HALYARD.warn,
  beam: HALYARD.fg,
  release: HALYARD.focus,
  success: HALYARD.success,
  failure: HALYARD.danger,
  warn: HALYARD.warn,
  scan: HALYARD.fg,
  accent: HALYARD.accent,
  hudBg: 'rgba(18, 21, 20, 0.92)',
  hudBorder: HALYARD.borderStrong,
  hudText: HALYARD.fg,
  hudDim: HALYARD.fgSubtle,
  hudMuted: HALYARD.fgMuted,
} as const;

/** Model identity colours (--fl-model-*). */
export const MODEL_COLORS: Record<ModelFamily, string> = {
  opus: '#ff6a2b',
  sonnet: '#7fd1d9',
  haiku: '#b6e85a',
  fable: '#e9e2cf',
  astra: '#e58ac9',
  unknown: '#8a8f88',
};

export const TASK_STATE_COLORS: Record<OrchTaskState, string> = {
  queued: '#3a3e39',
  running: HALYARD.accent,
  review: HALYARD.warn,
  landed: HALYARD.success,
  blocked: HALYARD.danger,
  failed: HALYARD.danger,
};

/** HDR multiplier per task state. Only "live" states exceed the bloom threshold. */
export const TASK_STATE_INTENSITY: Record<OrchTaskState, number> = {
  queued: 1.4,
  running: 2.6,
  review: 1.3,
  landed: 0.7,
  blocked: 2.2,
  failed: 2.2,
};

export const PHASE_COLORS: Record<OrchPhase, string> = {
  running: THEME.stationRunning,
  blocked: THEME.stationBlocked,
  done: THEME.stationDone,
  idle: THEME.stationIdle,
};

export const CI_COLORS: Record<CiState, string> = {
  pending: HALYARD.warn,
  success: HALYARD.success,
  failure: HALYARD.danger,
  none: '#33372f',
};

export type BotShape = 'diamond' | 'cube' | 'tetra' | 'sphere' | 'torus' | 'cone' | 'ico';

export const ROLE_SHAPES: Record<AgentRole, BotShape> = {
  lead: 'diamond',
  senior: 'ico',
  coder: 'cube',
  critic: 'tetra',
  scout: 'sphere',
  tester: 'torus',
  triager: 'cone',
  other: 'ico',
};

/** Base size of a bot by role (scene units). */
export const ROLE_SCALE: Record<AgentRole, number> = {
  lead: 0.3,
  senior: 0.25,
  coder: 0.19,
  critic: 0.21,
  scout: 0.14,
  tester: 0.2,
  triager: 0.2,
  other: 0.18,
};
