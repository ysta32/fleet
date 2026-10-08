import { describe, expect, it } from 'vitest';
import { modeOf } from './mode';

const base = { mode: 'live' as const, connected: true, link: 'ok' as const, synthetic: false };

describe('modeOf', () => {
  it('reads live when connected to real data', () => {
    expect(modeOf(base)).toEqual({ kind: 'live', label: 'Live' });
  });
  it('reads demo for synthetic snapshots served over the live stream', () => {
    expect(modeOf({ ...base, synthetic: true }).label).toBe('Demo');
    expect(modeOf({ ...base, mode: 'demo' }).label).toBe('Demo');
  });
  it('reads offline when the link is lost, even with synthetic data', () => {
    expect(modeOf({ ...base, link: 'offline' }).kind).toBe('offline');
    expect(modeOf({ ...base, synthetic: true, link: 'disconnected' }).label).toBe('Offline');
  });
  it('lets replay win over everything', () => {
    expect(modeOf({ ...base, mode: 'replay', link: 'offline' }).label).toBe('Replay');
  });
  it('reads connecting before the first connection', () => {
    expect(modeOf({ ...base, connected: false, link: 'connecting' }).label).toBe('Connecting');
  });
});
