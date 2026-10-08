import { createServer as createHttpServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'vite';
import { fleetSpendPlugin } from '../../vite.config';
import { TABS } from '../shell/tabs';
import { initialSpend, spendStart } from './Spend';
import { KEYMAP } from '../shell/hotkeys';

import type { FleetSnapshot } from '@fleet/shared';
import type { FleetView } from '../data/contract';
import Dashboard from './Dashboard';
import type { DashboardTab } from './Dashboard';

vi.mock('virtual:fleet-spend', () => ({ SpendTab: null, DEMO_SUMMARY: null }));

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
  it('renders the demo overnight digest even before the snapshot arrives', () => {
    const html = render('overnight', { ...fixture(), snapshot: null });
    expect(html).toContain('Since you left');
    expect(html).toContain('>Synthetic<');
    expect(html).toContain('Replay the night');
    // The demo night comes from the same synthetic fleet: one army is waiting on you at load.
    expect(html).toMatch(/\d+ need attention/);
    expect(html).toMatch(/needs? you/);
  });
  it('registers both panels in the shared rail, palette and hotkey tab list', () => {
    expect(TABS).toContainEqual({ id: 'overnight', label: 'Overnight', icon: 'moon', key: 'n' });
    expect(TABS).toContainEqual({ id: 'spend', label: 'Spend', icon: 'cost', key: 'c' });
    expect(new Set(TABS.map((tab) => tab.key)).size).toBe(TABS.length);
    for (const tab of TABS.filter((tab) => tab.id === 'overnight' || tab.id === 'spend')) {
      expect(KEYMAP).toContainEqual({ group: 'Go to', keys: ['G', tab.key.toUpperCase()], label: tab.label });
    }
  });
  it('renders the spend not-installed state without needing a snapshot', () => {
    const html = render('spend', { ...fixture(), snapshot: null });
    expect(html).toContain('Spend tracking not installed');
    expect(html).toContain('npm i fleet-spend');
    expect(html).toContain('fleet install');
    expect(html).not.toContain('npx');
    expect(html).not.toContain('Loading spend tracking');
  });
  it('resolves the optional spend module to a real null export when absent', async () => {
    const server = await createServer({
      configFile: false,
      plugins: [
        fleetSpendPlugin(() => {
          throw new Error('MODULE_NOT_FOUND');
        }),
      ],
      server: { middlewareMode: true, hmr: { server: createHttpServer() }, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      const module = await server.ssrLoadModule('virtual:fleet-spend');
      expect(module.SpendTab).toBeNull();
      expect(module.DEMO_SUMMARY).toBeNull();
    } finally {
      await server.close();
    }
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
  it('renders a compact sort control covering every column for the card layout', () => {
    const html = render('sessions');
    const control = /<div class="compact-sort">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
    expect(control).toContain('<select');
    for (const label of [
      'Session',
      'Project',
      'Model',
      'Status',
      'Last tool',
      'Tokens',
      'Cost',
      'Last activity',
    ])
      expect(control).toContain(`>${label}</option>`);
    expect(control).toMatch(/<option value="lastActivity" selected="">Last activity<\/option>/);
    expect(control).toContain('aria-label="Sorted descending, switch to ascending"');
    expect(
      render('sessions', { ...fixture(), snapshot: { ...fixture().snapshot!, sessions: [] } }),
    ).not.toContain('compact-sort');
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
    expect(html).toContain('CI failed');
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
  it('counts one blocked task, its waiting session and its alert as one incident everywhere', () => {
    const base = fixture();
    const snapshot: FleetSnapshot = {
      ...base.snapshot!,
      projects: base.snapshot!.projects.map((project) => ({
        ...project,
        orch: { ...project.orch!, blocked: ['01'] },
      })),
      sessions: base.snapshot!.sessions.map((session) => ({
        ...session,
        status: 'waiting' as const,
        agentIds: ['coder'],
      })),
      agents: [
        {
          id: 'coder',
          sessionId: 'session',
          projectId: 'demo',
          role: 'coder',
          model: 'opus',
          label: 'coder t01',
          status: 'waiting',
          currentTask: 't01',
          location: { kind: 'project', projectId: 'demo' },
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          startedAt: now,
          lastActivity: now,
        },
      ],
    };
    const view = { ...base, snapshot };
    const overview = render('overview', view);
    expect(overview).toContain('1 item is waiting on you.');
    expect(overview).toContain('01 · synthetic-task is waiting on you');
    const alerts = render('alerts', view);
    expect(alerts.match(/class="alert-row incident-row/g)).toHaveLength(1);
    expect(alerts).toContain('1 waiting on you');
    expect(alerts).toContain('Army blocked');
    expect(alerts).toContain('Waiting on you');
    expect(alerts).toContain('Synthetic alert');
    expect(alerts.match(/synthetic-task/g)).toHaveLength(1);
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

describe('initialSpend', () => {
  it('uses the shipped example only for demo fleets', () => {
    const example = { generatedAt: 1 };
    expect(initialSpend(true, example)).toBe(example);
    expect(initialSpend(false, example)).toBeUndefined();
    expect(initialSpend(true, null)).toBeUndefined();
  });
});

describe('spendStart', () => {
  const example = { generatedAt: 1 };
  it('shows the example without fetching while in demo', () => {
    expect(spendStart(true, example)).toEqual({ summary: example, error: undefined, fetch: false });
  });
  it('resets to loading with no error and fetches when demo turns off', () => {
    expect(spendStart(false, example)).toEqual({ summary: undefined, error: undefined, fetch: true });
  });
  it('fetches real data when no example ships', () => {
    expect(spendStart(true, null)).toEqual({ summary: undefined, error: undefined, fetch: true });
  });
});
