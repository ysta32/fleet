import type { LinkState } from './connection';

export type ModeKind = 'live' | 'demo' | 'replay' | 'offline' | 'connecting';

/**
 * What the command-bar pill says. Replay wins; synthetic data always reads "Demo" (even when a
 * demo collector serves it over the live stream); a lost link reads "Offline" instead of "Live".
 */
export function modeOf(input: {
  mode: 'live' | 'demo' | 'replay';
  connected: boolean;
  link: LinkState;
  synthetic: boolean;
}): { kind: ModeKind; label: string } {
  if (input.mode === 'replay') return { kind: 'replay', label: 'Replay' };
  if (input.link === 'offline' || input.link === 'disconnected') return { kind: 'offline', label: 'Offline' };
  if (input.mode === 'demo' || input.synthetic) return { kind: 'demo', label: 'Demo' };
  return input.connected ? { kind: 'live', label: 'Live' } : { kind: 'connecting', label: 'Connecting' };
}
