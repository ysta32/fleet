import { describe, expect, it } from 'vitest';
import type { FleetEvent, FleetSnapshot } from '@fleet/shared';
import { selectionEvents, selectionShown } from './SelectionCard';

const event = (id: string, ts: number, extra: Partial<FleetEvent>): FleetEvent => ({
  id,
  ts,
  kind: 'agent.tool',
  projectId: 'p',
  severity: 'info',
  label: id,
  ...extra,
});
const snapshot = {
  agents: [
    { id: 's1', sessionId: 's1' },
    { id: 's1:sub', sessionId: 's1' },
    { id: 's2', sessionId: 's2' },
  ],
} as unknown as FleetSnapshot;
const events = [
  event('own', 1, { sessionId: 's1' }),
  event('subagent', 3, { agentId: 's1:sub' }),
  event('other', 2, { sessionId: 's2', agentId: 's2' }),
  event('project-only', 4, {}),
];

describe('selectionEvents', () => {
  it('collects a session and its agents, newest first', () => {
    expect(selectionEvents(snapshot, { kind: 'session', id: 's1' }, events).map((e) => e.id)).toEqual([
      'subagent',
      'own',
    ]);
  });
  it('gives a lead agent its untagged session events but not its subagents', () => {
    expect(selectionEvents(snapshot, { kind: 'agent', id: 's1' }, events).map((e) => e.id)).toEqual(['own']);
  });
  it('scopes agents to their own events and projects to everything in them', () => {
    expect(selectionEvents(snapshot, { kind: 'agent', id: 's2' }, events).map((e) => e.id)).toEqual([
      'other',
    ]);
    expect(selectionEvents(snapshot, { kind: 'project', id: 'p' }, events, 2).map((e) => e.id)).toEqual([
      'project-only',
      'subagent',
    ]);
  });
});

describe('selectionShown', () => {
  const snap = {
    sessions: [{ id: 's1' }],
    agents: [{ id: 'a1' }],
    projects: [{ id: 'p1' }],
  } as unknown as FleetSnapshot;
  it('is true only when the selected entity exists, so the scene card shows only without a drawer', () => {
    expect(selectionShown(snap, { kind: 'session', id: 's1' })).toBe(true);
    expect(selectionShown(snap, { kind: 'agent', id: 'a1' })).toBe(true);
    expect(selectionShown(snap, { kind: 'project', id: 'p1' })).toBe(true);
    expect(selectionShown(snap, { kind: 'session', id: 'gone' })).toBe(false);
    expect(selectionShown(snap, null)).toBe(false);
    expect(selectionShown(null, { kind: 'project', id: 'p1' })).toBe(false);
  });
});
