import { createContext, useContext, useEffect, useState } from 'react';
import * as THREE from 'three';
import { palette, type ThemeName } from '@fleet/ui';
import type { AgentRole, CiState, ModelFamily, OrchPhase, OrchTaskState } from '@fleet/shared';

/**
 * Visualizer theme derived from the Halyard JS mirrors (@fleet/ui palette). WebGL cannot read CSS
 * variables, so every colour here comes from `palette.dark | palette.light`.
 *
 * Colour discipline (DESIGN.md): ink + bone carry the scene; signal orange (accent) is reserved for
 * "needs you" (blocked / waiting); status colours only for status.
 */
export interface VizTheme {
  name: ThemeName;
  dark: boolean;
  bg: string;
  surface1: string;
  surface2: string;
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  accent: string;
  focus: string;
  success: string;
  warn: string;
  danger: string;
  info: string;
  gridCell: string;
  gridSection: string;
  /** body colour of station cores / pillars */
  coreBody: string;
  model: Record<ModelFamily, string>;
  task: Record<OrchTaskState, string>;
  /** HDR multiplier per task state; only live states exceed the bloom threshold (dark only) */
  taskGain: Record<OrchTaskState, number>;
  phase: Record<OrchPhase, string>;
  ci: Record<CiState, string>;
  /** effects blend mode: additive light on ink, multiplied ink on paper */
  fxBlending: THREE.Blending;
  bloom: number;
  /** clamp an emissive gain for the theme (paper cannot glow past 1) */
  gain(k: number): number;
  hud: { bg: string; border: string; borderStrong: string; shadow: string };
  vignette: string;
  grainOpacity: number;
}

export const FONTS = {
  display: "'Instrument Serif', 'Iowan Old Style', Georgia, serif",
  mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  sans: "'Schibsted Grotesk', ui-sans-serif, system-ui, sans-serif",
  trackingCaps: '0.08em',
} as const;

function build(name: ThemeName): VizTheme {
  const p = palette[name];
  const dark = name === 'dark';
  return {
    name,
    dark,
    bg: p.bg,
    surface1: p['surface-1'],
    surface2: p['surface-2'],
    fg: p.fg,
    fgMuted: p['fg-muted'],
    fgSubtle: p['fg-subtle'],
    accent: p.accent,
    focus: p.focus,
    success: p.success,
    warn: p.warn,
    danger: p.danger,
    info: p.info,
    gridCell: dark ? '#141716' : '#e7e2d6',
    gridSection: dark ? '#1f2320' : '#d6d0c1',
    coreBody: dark ? '#141210' : '#f6f3ec',
    model: {
      opus: p['model-opus'],
      sonnet: p['model-sonnet'],
      haiku: p['model-haiku'],
      fable: dark ? p['model-fable'] : '#8a8270',
      astra: p['model-astra'],
      unknown: p['model-unknown'],
    },
    task: {
      queued: dark ? '#3a3e39' : '#c9c3b3',
      running: p.fg,
      review: p.warn,
      landed: p.success,
      blocked: p.accent,
      failed: p.danger,
    },
    taskGain: dark
      ? { queued: 1.2, running: 1.5, review: 1.05, landed: 0.5, blocked: 2.6, failed: 2.2 }
      : { queued: 1, running: 1, review: 1, landed: 1, blocked: 1, failed: 1 },
    phase: { running: p.fg, blocked: p.accent, done: p.success, idle: p['fg-subtle'] },
    ci: { pending: p.warn, success: p.success, failure: p.danger, none: dark ? '#33372f' : '#c9c3b3' },
    fxBlending: dark ? THREE.AdditiveBlending : THREE.MultiplyBlending,
    bloom: dark ? 0.8 : 0,
    gain: dark ? (k: number) => k : (k: number) => Math.min(1, k),
    hud: dark
      ? {
          bg: 'rgba(18, 21, 20, 0.9)',
          border: 'rgba(233, 226, 207, 0.09)',
          borderStrong: 'rgba(233, 226, 207, 0.18)',
          shadow: '0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 64px rgba(0,0,0,0.6)',
        }
      : {
          bg: 'rgba(251, 249, 244, 0.94)',
          border: 'rgba(24, 26, 22, 0.1)',
          borderStrong: 'rgba(24, 26, 22, 0.2)',
          shadow: '0 12px 40px rgba(60, 50, 30, 0.14)',
        },
    vignette: dark
      ? 'radial-gradient(140% 100% at 50% 0%, rgba(11,13,12,0) 55%, rgba(5,6,6,0.65) 100%)'
      : 'radial-gradient(140% 100% at 50% 0%, rgba(243,240,232,0) 60%, rgba(214,206,188,0.55) 100%)',
    grainOpacity: dark ? 0.07 : 0.05,
  };
}

const cache: Partial<Record<ThemeName, VizTheme>> = {};
export function vizTheme(name: ThemeName): VizTheme {
  return (cache[name] ??= build(name));
}

/** Resolve the active theme: html[data-theme] wins, else prefers-color-scheme. */
export function resolveThemeName(): ThemeName {
  if (typeof document === 'undefined') return 'dark';
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return 'dark';
}

/** Live theme name, following html[data-theme] mutations and colour-scheme changes. */
export function useThemeName(): ThemeName {
  const [name, setName] = useState<ThemeName>(resolveThemeName);
  useEffect(() => {
    const update = () => setName(resolveThemeName());
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: light)') : null;
    mq?.addEventListener('change', update);
    update();
    return () => {
      mo.disconnect();
      mq?.removeEventListener('change', update);
    };
  }, []);
  return name;
}

export const VizThemeContext = createContext<VizTheme>(vizTheme('dark'));
export const useVizTheme = (): VizTheme => useContext(VizThemeContext);

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
  lead: 0.26,
  senior: 0.22,
  coder: 0.17,
  critic: 0.19,
  scout: 0.13,
  tester: 0.18,
  triager: 0.18,
  other: 0.16,
};
