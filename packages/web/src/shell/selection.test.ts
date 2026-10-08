import { describe, expect, it } from 'vitest';
import type { FleetEvent, FleetSnapshot } from '@fleet/shared';
import { selectionEvents } from './SelectionCard';

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
