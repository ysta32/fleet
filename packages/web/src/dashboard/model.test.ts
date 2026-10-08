import { describe, expect, it } from 'vitest';
import type { Agent, FleetSnapshot, OrchTask, Session } from '@fleet/shared';
import {
  aggregateFleet,
  alertKindLabel,
  alertTitle,
  dagLayout,
  formatCost,
  formatCount,
  incidents,
  nowWorking,
  relativeTime,
  sortSessions,
  spendNote,
  stationNeeds,
  taskKey,
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

describe('alert labels', () => {
  it('replaces a title that only echoes the kind', () => {
    expect(alertTitle({ kind: 'ci.failed', title: 'ci.failed' })).toBe('CI failed');
    expect(alertTitle({ kind: 'session.waiting', title: '  ' })).toBe('Waiting on you');
  });
  it('keeps a real collector title', () => {
    expect(alertTitle({ kind: 'ci.failed', title: 'CI failed on #12' })).toBe('CI failed on #12');
  });
  it('falls back to the raw kind when unknown', () => {
    expect(alertKindLabel('army.blocked')).toBe('Army blocked');
    expect(alertKindLabel('future.kind')).toBe('future.kind');
  });
});

describe('nowWorking', () => {
  it('derives the header totals from the same rows it returns, with a reason for agent-less rows', () => {
    const data = snapshot();
    data.sessions = [session({ projectId: 'beta' })];
    const agent: Agent = {
      id: 'worker',
      sessionId: 'synthetic-session',
      projectId: 'alpha',
      role: 'coder',
      model: 'opus',
      label: 'synthetic coder',
      status: 'working',
      location: { kind: 'project', projectId: 'alpha' },
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      startedAt: now,
      lastActivity: now,
    };
    data.agents = [agent, { ...agent, id: 'worker2' }, { ...agent, id: 'idle', status: 'idle' }];
    const result = nowWorking(data, now);
    expect(result.rows.map((row) => [row.project.id, row.activeAgents, row.reason])).toEqual([
      ['alpha', 2, 'agents'],
      ['beta', 0, 'session'],
    ]);
    expect(result.projects).toBe(result.rows.length);
    expect(result.agents).toBe(result.rows.reduce((sum, row) => sum + row.activeAgents, 0));
    expect(result.agents).toBe(2);
  });
  it('reports zero of both when nothing works, as during an empty replay frame', () => {
    const data = snapshot();
    data.sessions = [];
    data.agents = [];
    expect(nowWorking(data, now)).toEqual({ rows: [], agents: 0, projects: 0 });
  });
});

describe('incidents', () => {
  it('reuses one computation per snapshot and dismissal state, handing out a fresh array each call', () => {
    const data = snapshot();
    data.alerts = [
      {
        id: 'a1',
        kind: 'ci.failed',
        projectId: 'alpha',
        title: 'ci.failed',
        body: 'Checks failed on #1',
        at: now,
      },
      {
        id: 'a2',
        kind: 'ci.failed',
        projectId: 'beta',
        title: 'ci.failed',
        body: 'Checks failed on #2',
        at: now,
      },
    ];
    const first = incidents(data);
    const again = incidents(data);
    expect(again).not.toBe(first);
    expect(again[0]).toBe(first[0]);
    // ids not on this snapshot do not change the key
    expect(incidents(data, new Set(['elsewhere']))[0]).toBe(first[0]);
    expect(first.map((entry) => entry.projectId)).toEqual(['alpha', 'beta']);
    first.length = 0;
    expect(incidents(data)).toHaveLength(2);
    // a different dismissal state is its own result
    expect(incidents(data, new Set(['a1'])).map((entry) => entry.projectId)).toEqual(['beta']);
    expect(incidents(data, new Set(['a1', 'a2']))).toEqual([]);
    expect(stationNeeds(data, 'alpha')).toBe(1);
  });

  const coder = (overrides: Partial<Agent> = {}): Agent => ({
    id: 'synthetic-session:coder',
    sessionId: 'synthetic-session',
    projectId: 'alpha',
    role: 'coder',
    model: 'opus',
    label: 'coder t04',
    status: 'waiting',
    currentTask: 't04',
    location: { kind: 'project', projectId: 'alpha' },
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    startedAt: now,
    lastActivity: now,
    ...overrides,
  });
  /** the demo's shape: one blocked task, its waiting coder session, and both alerts */
  const blockedArmy = (): FleetSnapshot => {
    const data = snapshot();
    data.projects[0]!.orch = {
      projectId: 'alpha',
      phase: 'blocked',
      statusText: '',
      handoffText: '',
      tasks: [{ ...task('t04'), slug: 'rate-limit', state: 'blocked' }, task('t05')],
      inflight: [],
      worktrees: [],
      blocked: ['t04'],
      updatedAt: now - 3000,
    };
    data.sessions = [
      session({
        status: 'waiting',
        title: 'Synthetic build',
        lastActivity: now - 2000,
        agentIds: ['synthetic-session', 'synthetic-session:coder'],
      }),
    ];
    data.agents = [
      coder(),
      coder({ id: 'synthetic-session', role: 'lead', status: 'working', currentTask: undefined }),
    ];
    data.alerts = [
      {
        id: 'a1',
        kind: 'session.waiting',
        projectId: 'alpha',
        title: 'session.waiting',
        body: 'Synthetic t04 checkpoint',
        at: now - 1000,
      },
      {
        id: 'a2',
        kind: 'army.blocked',
        projectId: 'alpha',
        title: 'army.blocked',
        body: 'Synthetic t04 checkpoint',
        at: now - 1000,
      },
    ];
    return data;
  };

  it('normalises task ids', () => {
    expect(taskKey('t04')).toBe('4');
    expect(taskKey('04')).toBe('4');
    expect(taskKey('T4')).toBe('4');
    expect(taskKey('refactor-api')).toBe('refactor-api');
  });

  it('folds a blocked task, its waiting session and both alerts into one incident', () => {
    const result = incidents(blockedArmy());
    expect(result).toHaveLength(1);
    const [incident] = result;
    expect(incident).toMatchObject({
      id: 'alpha:task:4',
      kind: 'waiting',
      projectId: 'alpha',
      taskId: 't04',
      taskSlug: 'rate-limit',
      sessionId: 'synthetic-session',
      sessionTitle: 'Synthetic build',
      title: 't04 · rate-limit is waiting on you',
      at: now - 3000,
      alertIds: ['a1', 'a2'],
    });
    expect(incident!.reasons.map((reason) => reason.label)).toEqual(['Army blocked', 'Waiting on you']);
    expect(incident!.body).toBeUndefined();
    expect(stationNeeds(blockedArmy(), 'alpha')).toBe(1);
    expect(stationNeeds(blockedArmy(), 'beta')).toBe(0);
  });

  it('keeps distinct subjects apart and orders oldest first', () => {
    const data = blockedArmy();
    data.sessions.push(
      session({
        id: 'other',
        projectId: 'beta',
        status: 'waiting',
        title: 'Synthetic review',
        lastActivity: now - 9000,
      }),
    );
    data.alerts.push({
      id: 'a3',
      kind: 'ci.failed',
      projectId: 'alpha',
      title: 'ci.failed',
      body: 'Synthetic checks failed on #3',
      at: now - 500,
    });
    data.alerts.push({
      id: 'a4',
      kind: 'ci.failed',
      projectId: 'alpha',
      title: 'ci.failed',
      body: 'Synthetic checks failed on #3',
      at: now - 100,
    });
    const result = incidents(data);
    expect(result.map((incident) => incident.id)).toEqual([
      'beta:session:other',
      'alpha:task:4',
      'alpha:ci.failed:synthetic checks failed on #3',
    ]);
    expect(result[0]!.title).toBe('Synthetic review is waiting on you');
    expect(result[2]).toMatchObject({
      kind: 'alert',
      title: 'CI failed',
      body: 'Synthetic checks failed on #3',
      alertIds: ['a3', 'a4'],
    });
    expect(result[2]!.reasons).toHaveLength(1);
  });

  it('dedupes run.blocked against blocked tasks and keeps a blocked-only incident', () => {
    const data = blockedArmy();
    data.sessions = [];
    data.alerts = [];
    data.projects[0]!.orch!.blocked = ['04'];
    const result = incidents(data);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'blocked', title: 't04 · rate-limit is blocked', alertIds: [] });
    expect(result[0]!.reasons).toEqual([{ kind: 'blocked', label: 'Army blocked', at: now - 3000 }]);
  });

  it('drops dismissed and cleared alerts but keeps live state', () => {
    const data = blockedArmy();
    data.alerts[0]!.cleared = true;
    const result = incidents(data, new Set(['a2']));
    expect(result).toHaveLength(1);
    expect(result[0]!.alertIds).toEqual([]);
  });

  it('keeps alerts with no confident subject as their own incidents', () => {
    const data = snapshot();
    data.alerts = [
      {
        id: 'a1',
        kind: 'session.waiting',
        projectId: 'alpha',
        title: 'session.waiting',
        body: 'Synthetic',
        at: now - 10,
      },
      {
        id: 'a2',
        kind: 'army.blocked',
        projectId: 'alpha',
        title: 'Synthetic run stuck',
        body: 'Synthetic',
        at: now - 5,
      },
    ];
    const result = incidents(data);
    expect(result.map((incident) => [incident.id, incident.kind, incident.title, incident.alertIds])).toEqual(
      [
        ['alpha:alert:a1', 'waiting', 'Waiting on you', ['a1']],
        ['alpha:alert:a2', 'blocked', 'Synthetic run stuck', ['a2']],
      ],
    );
  });

  it('matches task tokens exactly: an alert about t4 never joins t40, and ambiguity stays apart', () => {
    const data = blockedArmy();
    data.sessions = [];
    const orch = data.projects[0]!.orch!;
    orch.tasks = [
      { ...task('t4'), slug: 'four', state: 'blocked' },
      { ...task('t40'), slug: 'forty', state: 'blocked' },
    ];
    orch.blocked = [];
    data.alerts = [
      {
        id: 'b4',
        kind: 'army.blocked',
        projectId: 'alpha',
        title: 'army.blocked',
        body: 'Synthetic t4 checkpoint',
        at: now,
      },
      {
        id: 'b40',
        kind: 'army.blocked',
        projectId: 'alpha',
        title: 'army.blocked',
        body: 'Synthetic t40 checkpoint',
        at: now,
      },
      {
        id: 'both',
        kind: 'army.blocked',
        projectId: 'alpha',
        title: 'army.blocked',
        body: 'Synthetic t4 and t40',
        at: now,
      },
    ];
    const byId = new Map(incidents(data).map((incident) => [incident.id, incident.alertIds]));
    expect(byId.get('alpha:task:4')).toEqual(['b4']);
    expect(byId.get('alpha:task:40')).toEqual(['b40']);
    expect(byId.get('alpha:alert:both')).toEqual(['both']);
  });

  it('uses structured alert subjects: taskId joins the task, sessionId joins the session it holds', () => {
    const data = blockedArmy();
    data.alerts = [
      {
        id: 's1',
        kind: 'session.waiting',
        projectId: 'alpha',
        title: 'Waiting',
        body: '',
        sessionId: 'synthetic-session',
        at: now,
      },
      {
        id: 't1',
        kind: 'army.blocked',
        projectId: 'alpha',
        title: 'Blocked',
        body: '',
        taskId: '04',
        at: now,
      },
      {
        id: 't5',
        kind: 'army.blocked',
        projectId: 'alpha',
        title: 'Blocked',
        body: '',
        taskId: 't05',
        at: now,
      },
      {
        id: 'gone',
        kind: 'session.waiting',
        projectId: 'alpha',
        title: 'Waiting',
        body: '',
        sessionId: 'ended',
        at: now,
      },
    ];
    const byId = new Map(incidents(data).map((incident) => [incident.id, incident]));
    expect(byId.get('alpha:task:4')!.alertIds).toEqual(['s1', 't1']);
    expect(byId.get('alpha:task:5')).toMatchObject({
      taskId: 't05',
      title: 't05 · synthetic-t05 is blocked',
      alertIds: ['t5'],
    });
    expect(byId.get('alpha:session:ended')).toMatchObject({ kind: 'waiting', alertIds: ['gone'] });
    expect(byId.size).toBe(3);
  });

  it('reports an army blocked with no task ids as one incident', () => {
    const data = blockedArmy();
    data.sessions = [];
    data.alerts = [];
    data.projects[0]!.orch!.blocked = [];
    data.projects[0]!.orch!.tasks = [task('t05')];
    expect(incidents(data).map((incident) => [incident.id, incident.title])).toEqual([
      ['alpha:army', 'Army blocked'],
    ]);
  });
});

describe('spendNote', () => {
  const spend = (todayUsd: number, totalUsd: number, todaySessions: number, sessions: number) => ({
    todayUsd,
    totalUsd,
    earlierUsd: Math.max(0, totalUsd - todayUsd),
    todaySessions,
    sessions,
  });
  it('adds the session count and the total with older sessions, not today again', () => {
    const note = spendNote(spend(6.56, 38.65, 21, 29));
    expect(note.text).toBe('21 sessions since midnight · $38.65 including older sessions');
    expect(note.text).not.toContain('$6.56');
    expect(note.title).toBe(
      'Today counts sessions started since local midnight: $6.56. ' +
        'Sessions started before it add $32.09, for $38.65 in all.',
    );
  });
  it('splits in shown cents, so today plus earlier always reads as the total', () => {
    // 6.555 + 32.094 = 38.649: rounded separately the parts would read $6.56 + $32.09 vs $38.65
    const note = spendNote(spend(6.555, 38.649, 1, 3));
    expect(note.text).toBe('1 session since midnight · $38.65 including older sessions');
    expect(note.title).toContain('$6.56. Sessions started before it add $32.09, for $38.65');
    const odd = spendNote(spend(0.125, 10.13, 2, 4));
    expect(odd.title).toContain('$0.13. Sessions started before it add $10.00, for $10.13');
  });
  it('rounds the split the way the shown figures round, not with Math.round', () => {
    // formatCost shows 1.005 as $1.01 (Math.round(1.005 * 100) is 100), so earlier must be $0.99
    expect(formatCost(1.005)).toBe('$1.01');
    const note = spendNote(spend(1.005, 2, 1, 2));
    expect(note.title).toBe(
      'Today counts sessions started since local midnight: $1.01. ' +
        'Sessions started before it add $0.99, for $2.00 in all.',
    );
  });
  it('counts every session when all of them started today', () => {
    expect(spendNote(spend(4, 4, 3, 3))).toEqual({ text: 'Across 3 sessions' });
    expect(spendNote(spend(0, 0, 0, 1))).toEqual({ text: 'Across 1 session' });
  });
});
