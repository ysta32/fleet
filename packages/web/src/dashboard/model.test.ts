import { describe, expect, it } from 'vitest';
import type { Agent, FleetSnapshot, OrchTask, Session } from '@fleet/shared';
import {
  aggregateFleet,
  dagLayout,
  formatCost,
  formatCount,
  relativeTime,
  sortSessions,
  totalTokens,
} from './model';

const now = new Date(2026, 9, 7, 12).getTime();
const session = (overrides: Partial<Session> = {}): Session => ({
  id: 'synthetic-session',
  projectId: 'alpha',
  model: 'opus',
  startedAt: now - 1000,
  lastActivity: now,
  status: 'active',
  tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
  costUsd: 2,
  toolCalls: 1,
  agentIds: [],
  ...overrides,
});
const task = (id: string, depends: string[] = []): OrchTask => ({
  id,
  depends,
  slug: `synthetic-${id}`,
  state: 'queued',
});
const snapshot = (): FleetSnapshot => ({
  version: 1,
  generatedAt: now,
  projects: [
    { id: 'alpha', name: 'Alpha', path: '', lastActivity: now },
    { id: 'beta', name: 'Beta', path: '', lastActivity: now },
  ],
  sessions: [],
  agents: [],
  prs: [],
  releases: [],
  deploys: [],
  alerts: [],
});

describe('dagLayout', () => {
  it('layers an unordered diamond with every dependency to the left of its dependent', () => {
    const tasks = [task('d', ['b', 'c']), task('c', ['a']), task('a'), task('b', ['a'])];
    const before = JSON.stringify(tasks);
    const layout = dagLayout(tasks);
    const nodes = new Map(layout.nodes.map((node) => [node.task.id, node]));
    expect(nodes.get('a')!.layer).toBe(0);
    expect(nodes.get('b')!.layer).toBe(1);
    expect(nodes.get('c')!.layer).toBe(1);
    expect(nodes.get('d')!.layer).toBe(2);
    expect(nodes.get('b')!.y).not.toBe(nodes.get('c')!.y);
    expect(layout.edges).toHaveLength(4);
    for (const edge of layout.edges) expect(nodes.get(edge.from)!.x).toBeLessThan(nodes.get(edge.to)!.x);
    for (const node of layout.nodes) {
      expect(node.x + 170).toBeLessThan(layout.width);
      expect(node.y + 52).toBeLessThan(layout.height);
      expect(node.unresolved).toBe(false);
    }
    expect(JSON.stringify(tasks)).toBe(before);
  });
  it('handles empty and disconnected graphs', () => {
    expect(dagLayout([])).toMatchObject({ nodes: [], edges: [], missingDependencies: [] });
    expect(dagLayout([task('a'), task('b')]).nodes.map((node) => node.layer)).toEqual([0, 0]);
  });
  it('reports missing dependencies and deduplicates edges', () => {
    const result = dagLayout([task('a'), task('b', ['a', 'a', 'missing'])]);
    expect(result.edges).toEqual([{ from: 'a', to: 'b' }]);
    expect(result.missingDependencies).toEqual([{ task: 'b', dependency: 'missing' }]);
    expect(result.nodes[1].layer).toBe(1);
  });
  it('keeps cycles and downstream tasks visible without hanging', () => {
    const result = dagLayout([
      task('root'),
      task('a', ['b']),
      task('b', ['a']),
      task('downstream', ['b']),
      task('self', ['self']),
    ]);
    expect(result.nodes).toHaveLength(5);
    expect(result.nodes.filter((node) => node.unresolved).map((node) => node.task.id)).toEqual([
      'a',
      'b',
      'downstream',
      'self',
    ]);
    expect(result.nodes[0].unresolved).toBe(false);
  });
});

describe('aggregateFleet', () => {
  it('sums session usage once, separates today, and counts only working agents by model', () => {
    const data = snapshot();
    const midnight = new Date(2026, 9, 7).getTime();
    data.sessions = [
      session(),
      session({ id: 'old', startedAt: midnight - 1, costUsd: 5 }),
      session({ id: 'boundary', startedAt: midnight, costUsd: 3 }),
    ];
    const agent: Agent = {
      id: 'worker',
      sessionId: 'synthetic-session',
      projectId: 'alpha',
      role: 'coder',
      model: 'astra',
      label: 'synthetic coder',
      status: 'working',
      location: { kind: 'project', projectId: 'alpha' },
      tokens: { input: 900, output: 900, cacheRead: 0, cacheWrite: 0 },
      startedAt: now,
      lastActivity: now,
    };
    data.agents = [
      agent,
      { ...agent, id: 'idle', status: 'idle' },
      { ...agent, id: 'done', status: 'done' },
      { ...agent, id: 'worker2', model: 'fable' },
    ];
    const result = aggregateFleet(data, now);
    expect(result.costTotal).toBe(10);
    expect(result.costToday).toBe(5);
    expect(result.tokens).toEqual({ input: 30, output: 60, cacheRead: 90, cacheWrite: 120 });
    expect(result.projects[0]).toMatchObject({
      working: true,
      activeAgents: 2,
      activeByModel: { astra: 1, fable: 1, opus: 0 },
    });
    expect(result.projects[1]).toMatchObject({ working: false, activeAgents: 0 });
  });
  it('keeps active sessions and running armies visible without active agents', () => {
    const data = snapshot();
    data.sessions = [session()];
    data.projects[1].orch = {
      projectId: 'beta',
      phase: 'running',
      statusText: '',
      handoffText: '',
      tasks: [],
      inflight: [],
      worktrees: [],
      blocked: [],
      updatedAt: now,
    };
    expect(aggregateFleet(data, now).projects.map((project) => project.working)).toEqual([true, true]);
  });
  it('returns zero totals for an empty fleet', () => {
    const result = aggregateFleet(snapshot(), now);
    expect(result.costToday).toBe(0);
    expect(result.costTotal).toBe(0);
    expect(totalTokens(result.tokens)).toBe(0);
  });
});

describe('sorting and formatters', () => {
  it('sorts numeric values numerically and leaves the input order intact', () => {
    const data = [session({ id: 'expensive', costUsd: 10 }), session({ id: 'cheap', costUsd: 2 })];
    expect(sortSessions(data, new Map(), 'cost', 'asc').map((item) => item.id)).toEqual([
      'cheap',
      'expensive',
    ]);
    expect(sortSessions(data, new Map(), 'cost', 'desc').map((item) => item.id)).toEqual([
      'expensive',
      'cheap',
    ]);
    expect(data[0].id).toBe('expensive');
  });
  it('sorts project display names and tolerates absent titles and tools', () => {
    const data = [session({ id: 'a', projectId: 'alpha' }), session({ id: 'b', projectId: 'beta' })];
    expect(
      sortSessions(
        data,
        new Map([
          ['alpha', 'Zeta'],
          ['beta', 'Alpha'],
        ]),
        'project',
        'asc',
      )[0].id,
    ).toBe('b');
    expect(sortSessions(data, new Map(), 'title', 'desc')[0].id).toBe('b');
    expect(sortSessions(data, new Map(), 'lastTool', 'asc')).toHaveLength(2);
  });
  it('formats costs, token counts, and relative timestamps including future clock skew', () => {
    expect(formatCost(12.345)).toBe('$12.35');
    expect(formatCount(1500)).toBe('1.5K');
    expect(relativeTime(now + 60000, now)).toBe('just now');
    expect(relativeTime(now - 120000, now)).toBe('2m ago');
    expect(relativeTime(now - 7200000, now)).toBe('2h ago');
    expect(relativeTime(now - 172800000, now)).toBe('2d ago');
  });
});
