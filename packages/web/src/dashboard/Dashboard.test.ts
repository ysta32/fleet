import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FleetSnapshot } from '@fleet/shared';
import type { FleetView } from '../data/contract';
import Dashboard from './Dashboard';
import type { DashboardTab } from './Dashboard';

const now = 1791374400000;
function fixture(): FleetView {
  const snapshot: FleetSnapshot = {
    version: 1,
    generatedAt: now,
    projects: [
      {
        id: 'demo',
        name: 'Synthetic project',
        path: '',
        lastActivity: now,
        orch: {
          projectId: 'demo',
          phase: 'blocked',
          statusText: 'PRIVATE_STATUS_SENTINEL',
          handoffText: 'PRIVATE_HANDOFF_SENTINEL',
          tasks: [{ id: '01', slug: 'synthetic-task', depends: [], state: 'blocked' }],
          inflight: [],
          worktrees: [],
          blocked: ['Synthetic blocker'],
          updatedAt: now,
        },
      },
    ],
    sessions: [
      {
        id: 'session',
        projectId: 'demo',
        title: 'Synthetic session',
        model: 'fable',
        startedAt: now,
        lastActivity: now,
        status: 'active',
        tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
        costUsd: 0.2,
        toolCalls: 1,
        agentIds: [],
        lastTool: { name: 'Edit', target: 'example.ts', at: now },
      },
    ],
    agents: [],
    prs: [
      {
        projectId: 'demo',
        number: 1,
        title: 'Synthetic PR',
        state: 'open',
        ci: 'failure',
        url: 'javascript:alert(1)',
        headRef: 'synthetic',
        updatedAt: now,
      },
    ],
    releases: [
      {
        projectId: 'demo',
        tag: 'v0',
        name: 'Synthetic release',
        url: 'https://example.com/release',
        publishedAt: now,
      },
    ],
    deploys: [{ projectId: 'demo', id: 'deploy', environment: 'preview', state: 'ready', createdAt: now }],
    alerts: [
      {
        id: 'alert',
        projectId: 'demo',
        kind: 'army.blocked',
        title: 'Synthetic alert',
        body: 'Synthetic details',
        at: now,
      },
      {
        id: 'cleared',
        projectId: 'demo',
        kind: 'army.done',
        title: 'CLEARED_SENTINEL',
        body: '',
        at: now,
        cleared: true,
      },
    ],
  };
  return {
    mode: 'demo',
    connected: true,
    snapshot,
    events: [
      {
        id: 'event',
        ts: now,
        kind: 'agent.tool',
        projectId: 'demo',
        severity: 'info',
        label: 'Edit example.ts',
        data: { hidden: 'PRIVATE_EVENT_SENTINEL' },
      },
    ],
    onEvent: () => () => {},
    startReplay: () => {},
    replay: {
      from: now,
      to: now,
      at: now,
      playing: false,
      speed: 1,
      seek: () => {},
      setPlaying: () => {},
      setSpeed: () => {},
      load: () => {},
      exit: () => {},
    },
  };
}
function render(tab: DashboardTab, view = fixture()) {
  return renderToStaticMarkup(createElement(Dashboard, { tab, view, selection: null, onSelect: () => {} }));
}

describe('Dashboard', () => {
  it('renders the overnight slot even before the snapshot arrives', () => {
    expect(render('overnight', { ...fixture(), snapshot: null })).toBe('<div data-slot="overnight"></div>');
  });
  it('renders a loading state', () => {
    expect(render('overview', { ...fixture(), snapshot: null })).toContain('Waiting for fleet data');
  });
  it('renders overview totals and recent metadata events', () => {
    const html = render('overview');
    expect(html).toContain('Synthetic project');
    expect(html).toContain('$0.20');
    expect(html).toContain('Edit example.ts');
  });
  it('renders sortable session columns and sanitized last tool metadata', () => {
    const html = render('sessions');
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('Synthetic session');
    expect(html).toContain('model-fable');
    expect(html).toContain('Edit · example.ts');
    expect(html).toContain('data-label="Tokens"');
  });
  it('renders army progress, state-colored SVG tasks, and inflight state', () => {
    const html = render('armies');
    expect(html).toContain('<progress');
    expect(html).toContain('<svg');
    expect(html).toContain('task-blocked');
    expect(html).toContain('No tasks inflight.');
  });
  it('renders PR CI, releases, and deploys with safe links', () => {
    const html = render('prs');
    expect(html).toContain('CI failure');
    expect(html).toContain('Synthetic release');
    expect(html).toContain('preview');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://example.com/release"');
  });
  it('renders blockers and active alerts, hiding cleared alerts', () => {
    const html = render('alerts');
    expect(html).toContain('Synthetic blocker');
    expect(html).toContain('Synthetic alert');
    expect(html).not.toContain('CLEARED_SENTINEL');
  });
  it('never renders status excerpts, handoff excerpts, or arbitrary event data', () => {
    for (const tab of ['overview', 'sessions', 'armies', 'prs', 'alerts'] as const) {
      expect(render(tab)).not.toContain('PRIVATE_');
    }
  });
  it('lists waiting sessions in alerts so "Review oldest" never lands on an empty inbox', () => {
    const base = fixture();
    const snapshot = {
      ...base.snapshot!,
      projects: base.snapshot!.projects.map((project) => ({ ...project, orch: undefined })),
      alerts: [],
      sessions: base.snapshot!.sessions.map((session) => ({ ...session, status: 'waiting' as const })),
    };
    const html = render('alerts', { ...base, snapshot });
    expect(html).toContain('Waiting on you');
    expect(html).toContain('Synthetic session');
    expect(html).not.toContain('Nothing needs you.');
  });
  it('shows the calm empty state only when nothing needs the operator', () => {
    const base = fixture();
    const snapshot = {
      ...base.snapshot!,
      projects: base.snapshot!.projects.map((project) => ({ ...project, orch: undefined })),
      alerts: [],
    };
    expect(render('alerts', { ...base, snapshot })).toContain('Nothing needs you.');
  });
});
