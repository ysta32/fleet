import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OrchRun } from '@fleet/shared';
import { diffOrch, readOrchRun, worktreeOf } from './reader.js';

let project: string;

beforeEach(async () => {
  project = await mkdtemp(path.join(os.tmpdir(), 'fleet-orch-test-'));
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

async function fixture(files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(project, '.orch', name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}

function run(overrides: Partial<OrchRun> = {}): OrchRun {
  return {
    projectId: 'synthetic-project',
    phase: 'idle',
    statusText: '',
    handoffText: '',
    tasks: [],
    inflight: [],
    worktrees: [],
    blocked: [],
    updatedAt: 1,
    ...overrides,
  };
}

describe('readOrchRun', () => {
  it('returns undefined without .orch, and handles an empty .orch directory', async () => {
    expect(await readOrchRun(project, 'p')).toBeUndefined();
    await mkdir(path.join(project, '.orch'));
    expect(await readOrchRun(project, 'p')).toMatchObject({
      projectId: 'p',
      phase: 'idle',
      tasks: [],
      inflight: [],
      blocked: [],
      worktrees: [],
      statusText: '',
      handoffText: '',
    });
  });

  it('parses task metadata, plain inflight rows, aliases and state precedence', async () => {
    await fixture({
      ACTIVE: '',
      'TASKS/01-first.md': 'DEPENDS: -\nRISK: normal\nROUTE: gpt_code',
      'TASKS/t02-second.md': '- DEPENDS: 01, t03\n- RISK: HIGH\n- ROUTE: claude',
      'TASKS/03-third.md': '**DEPENDS:** `01`, `t02`\n**RISK:** low',
      'TASKS/04-fourth.md': '- DEPENDS: -\nRISK: invalid',
      'TASKS/05-fifth.md': '',
      'TASKS/06-sixth.md': '',
      'TASKS/README.md': 'ignore',
      'STATUS.md': 'LANDED: 01\nt02 BLOCKED\n03 LANDED\n04 BLOCKED\nMerged orch-task/06',
      'HANDOFF.md': 'LANDED t02',
      'INFLIGHT.md':
        '# Inflight\n\n01 | coder | astra | wt/01 | abc123 | 12:34\n02 | reviewer | fable | wt/t02 | 12:35\ninvalid | row',
      'wt/t02/marker': '',
      'wt/not-a-directory': '',
    });
    const result = (await readOrchRun(project, 'p'))!;
    expect(result.phase).toBe('blocked');
    expect(result.tasks.map(({ id, state }) => [id, state])).toEqual([
      ['01', 'landed'],
      ['03', 'landed'],
      ['04', 'blocked'],
      ['05', 'queued'],
      ['06', 'landed'],
      ['t02', 'landed'],
    ]);
    expect(result.tasks.find((task) => task.id === 't02')).toMatchObject({
      slug: 'second',
      depends: ['01', 't03'],
      risk: 'high',
      route: 'claude',
    });
    expect(result.tasks.find((task) => task.id === '03')).toMatchObject({
      depends: ['01', 't02'],
      risk: 'low',
    });
    expect(result.tasks.find((task) => task.id === '04')).toMatchObject({ depends: [], risk: undefined });
    expect(result.inflight).toEqual([]);
    expect(result.worktrees).toEqual(['t02']);
    expect(result.blocked).toEqual(['04']);
    expect(result.updatedAt).toBeGreaterThan(0);
  });

  it('accepts reordered markdown columns and omitted fields', async () => {
    await fixture({
      'INFLIGHT.md':
        '| Agent | Task ID | Started | Role |\r\n| --- | --- | --- | --- |\r\n| astra | `t04-example` | 09:01 | coder |\r\n\r\n',
      'TASKS/t04-example.md': '',
    });
    expect((await readOrchRun(project, 'p'))!.inflight).toEqual([
      { task: 't04', role: 'coder', agent: 'astra', worktree: '', baseSha: '', started: '09:01' },
    ]);
  });

  it.each([
    ['Landed 8 tasks by 17:50', []],
    ['v1.6.0 merged (#10, 6e30574)', []],
    ['cycle2: landed 10,12,14,18,19; in flight 09,11,13,16,17,20 17:29', ['10', '12', '14', '18', '19']],
    ['landed: t21 error boundary, 15 deletion log UI', ['15', '21']],
    ['merged 01 t02 03', ['01', '02', '03']],
    ['landed 01; 02', ['01']],
    ['landed 01\n02', ['01']],
    ['landed 17:50, 1.6.0, #10, 12-14, 6e30574, 8 tasks', []],
    ['landed 01 updated at 17:50 with PR #10', ['01']],
    ['03 LANDED', ['03']],
    ['- **t03** error boundary LANDED', ['03']],
  ])('scopes landed IDs in %s', async (status, landed) => {
    const ids = [
      '1',
      '6',
      '8',
      '0',
      '50',
      ...Array.from({ length: 21 }, (_, i) => String(i + 1).padStart(2, '0')),
    ];
    await fixture({
      'STATUS.md': status,
      ...Object.fromEntries(ids.map((id) => [`TASKS/${id}-synthetic.md`, ''])),
    });
    const result = (await readOrchRun(project, 'p'))!;
    expect(result.tasks.filter((task) => task.state === 'landed').map((task) => task.id)).toEqual(landed);
  });

  it.each(['in flight', 'inflight', 'queued', 'blocked', 'running', 'next', 'pending'])(
    'stops landed IDs at the %s state',
    async (state) => {
      await fixture({
        'HANDOFF.md': `landed 01 ${state} 02, t03`,
        'TASKS/01-first.md': '',
        'TASKS/02-second.md': '',
        'TASKS/03-third.md': '',
      });
      expect((await readOrchRun(project, 'p'))!.tasks.map((task) => task.state)).toEqual([
        'landed',
        state === 'blocked'
          ? 'blocked'
          : ['in flight', 'inflight', 'running'].includes(state)
            ? 'running'
            : 'queued',
        state === 'blocked'
          ? 'blocked'
          : ['in flight', 'inflight', 'running'].includes(state)
            ? 'running'
            : 'queued',
      ]);
    },
  );

  it.each(['Task 01 LANDED', '- Task **01** LANDED', '| 01 | auth | LANDED |'])(
    'reads task-prefixed and table states from %s',
    async (status) => {
      await fixture({
        'STATUS.md': status,
        'TASKS/01-auth.md': '',
        'TASKS/02-other.md': '',
      });
      expect((await readOrchRun(project, 'p'))!.tasks.map((task) => task.state)).toEqual([
        'landed',
        'queued',
      ]);
    },
  );

  it.each(['STATUS.md', 'HANDOFF.md'])('reads mixed state segments from %s', async (file) => {
    await fixture({
      [file]: 'cycle2: landed 10,12; in flight 09,11 17:29',
      ...Object.fromEntries(
        ['09', '10', '11', '12', '17', '29'].map((id) => [`TASKS/${id}-synthetic.md`, '']),
      ),
    });
    expect((await readOrchRun(project, 'p'))!.tasks.map(({ id, state }) => [id, state])).toEqual([
      ['09', 'running'],
      ['10', 'landed'],
      ['11', 'running'],
      ['12', 'landed'],
      ['17', 'queued'],
      ['29', 'queued'],
    ]);
  });

  async function states(files: Record<string, string>, ids: string[]): Promise<Record<string, string[]>> {
    await fixture({ ...files, ...Object.fromEntries(ids.map((id) => [`TASKS/${id}-synthetic.md`, ''])) });
    const grouped: Record<string, string[]> = {};
    for (const task of (await readOrchRun(project, 'p'))!.tasks) (grouped[task.state] ??= []).push(task.id);
    return grouped;
  }

  const numbered = (from: number, to: number): string[] =>
    Array.from({ length: to - from + 1 }, (_, offset) => String(from + offset).padStart(2, '0'));

  it('reads a landed list after a version parenthetical and a colon', async () => {
    const landedIds = [...numbered(1, 8), ...numbered(10, 18), '20', '21'];
    expect(
      await states(
        {
          'STATUS.md': [
            '# STATUS run synthetic - tip abc1234 - PR #5 open (v1.1.0)',
            `Landed (v1.1.0): ${landedIds.join(' ')} + prettier pass + eslint ignore`,
            'In flight: 22 changelog (re-review), 23 about/terms (land after 22), 24 item states (re-review), 30 tokens (opus)',
            'Release v1.1.0: local npm run ci rerunning; then merge PR #5',
          ].join('\n'),
        },
        [...landedIds, '09', '19', '22', '23', '24', '30', '31'],
      ),
    ).toEqual({ landed: landedIds, queued: ['09', '19', '31'], running: ['22', '23', '24', '30'] });
  });

  it('expands ranges and plus-joined items after a worded header', async () => {
    expect(
      await states(
        {
          'HANDOFF.md': [
            'SHIPPED: v1.1.0 (PR #3 merged, tag, GitHub release)',
            'LANDED ON BRANCH (unreleased, = v1.2.0 content): 09-14,16-21,23-27,30 (persist wiring, tx filters, EIP-55) + 32 Ledger 2 tokens + DESIGN.md in repo.',
            'IN FLIGHT: 28 e2e features (fix round), 33-35 polish (Opus x6, worktrees .orch/wt/t33..t35, shots).',
            'NEXT: land 28/29 -> land 33-35 -> 40 baseline',
          ].join('\n'),
          'STATUS.md': 'cycle4 polish in flight (29, 36-37), 28/39 finishing 17:45',
        },
        numbered(1, 40),
      ),
    ).toEqual({
      queued: [...numbered(1, 8), '15', '22', '31', '38', '39', '40'],
      landed: [...numbered(9, 14), ...numbered(16, 21), ...numbered(23, 27), '30', '32'],
      running: ['28', '29', '33', '34', '35', '36', '37'],
    });
  });

  it('accepts suffixed and prefixed task ids without counting times or counts', async () => {
    expect(
      await states(
        {
          'STATUS.md': 'wave1: 8 tasks dispatched 17:19; 0 landed',
          'HANDOFF.md': [
            '# HANDOFF (orch/synthetic): EXECUTING',
            'LANDED: t01 CI/community, t06+t06b bank validate in build, t07 keyboard answers.',
            'IN REVIEW: t05 (perf/ErrorBoundary; rereview2), V0 visual tool',
            'IN FLIGHT: t13 bank audit (opus) + t19t spec tests (separate wt).',
            'QUEUED: see PLAN.md; waits on t31,t19 reviews',
          ].join('\n'),
        },
        ['t01', '05', '06', 't06b', 't07', '08', '0', '13', '17', '19', '31', 'V0', 'D1'],
      ),
    ).toEqual({
      queued: ['0', '08', '17', '19', '31', 'D1'],
      running: ['05', '13', 'V0'],
      landed: ['06', 't01', 't06b', 't07'],
    });
  });

  it.each([
    'v1.6.0 merged (#10, 6e30574) + tagged',
    'landed 05-90',
    'landed 10-08',
    'landed 05-07 tasks',
    'merged 10 files, 12 tests in 14 min',
  ])('ignores non-task numbers in %s', async (status) => {
    expect(await states({ 'STATUS.md': status }, numbered(1, 14))).toEqual({ queued: numbered(1, 14) });
  });

  it('prioritizes blocked over inflight rows and running segments', async () => {
    await fixture({
      'STATUS.md': 'blocked 01,02; running 01,02,03',
      'INFLIGHT.md': '01 | coder | astra | wt/01 | abc123 | 12:34',
      'TASKS/01-first.md': '',
      'TASKS/02-second.md': '',
      'TASKS/03-third.md': '',
    });
    expect((await readOrchRun(project, 'p'))!.tasks.map((task) => task.state)).toEqual([
      'blocked',
      'blocked',
      'running',
    ]);
  });

  it.each([
    ['blocked: 03', ['03']],
    ['03 BLOCKED', ['03']],
    ['blocked: t03 error boundary, 15 deletion log UI; queued 10', ['03', '15']],
    ['blocked 03 running 10, 15', ['03']],
    ['blocked 8 tasks by 17:50', []],
    ['v1.6.0 blocked (#10, 6e30574)', []],
    ['blocked 17:50, 1.6.0, #10, 03-15, 6e30574', []],
  ])('scopes blocked IDs in %s', async (status, blocked) => {
    await fixture({
      'STATUS.md': status,
      ...Object.fromEntries(
        ['03', '6', '8', '10', '15', '17', '50'].map((id) => [`TASKS/${id}-synthetic.md`, '']),
      ),
    });
    expect((await readOrchRun(project, 'p'))!.blocked).toEqual(blocked);
  });

  it.each([
    ['01 LANDED, 02 BLOCKED', ['landed', 'blocked', 'queued']],
    ['02 BLOCKED, 01 LANDED', ['landed', 'blocked', 'queued']],
    ['01 LANDED, 02 auth fix BLOCKED, 03 LANDED', ['landed', 'blocked', 'landed']],
    ['01 LANDED 02 BLOCKED', ['landed', 'blocked', 'queued']],
    ['LANDED: 01, 02 BLOCKED', ['landed', 'blocked', 'queued']],
    ['LANDED 01, 02 BLOCKED 03', ['landed', 'landed', 'blocked']],
    ['landed 01, 03; blocked: 02', ['landed', 'blocked', 'landed']],
  ])('binds postfix markers to the preceding item in %s', async (status, states) => {
    await fixture({
      'STATUS.md': status,
      'TASKS/01-first.md': '',
      'TASKS/02-second.md': '',
      'TASKS/03-third.md': '',
    });
    expect((await readOrchRun(project, 'p'))!.tasks.map((task) => task.state)).toEqual(states);
  });

  it('keeps the blocked alert for a postfix-blocked task after a landed one', async () => {
    await fixture({
      'STATUS.md': '01 LANDED, 02 BLOCKED',
      'TASKS/01-first.md': '',
      'TASKS/02-second.md': '',
    });
    const result = (await readOrchRun(project, 'p'))!;
    expect(result.blocked).toEqual(['02']);
    expect(result.phase).toBe('blocked');
    const alerts = diffOrch(undefined, result, 1).filter((event) => event.kind === 'blocked');
    expect(alerts.map((event) => event.taskId)).toEqual(['02']);
  });

  it('uses full state text while limiting excerpts and matching complete ids', async () => {
    const lines = Array.from({ length: 14 }, (_, index) => `Synthetic line ${index}`);
    await fixture({
      'STATUS.md': [...lines, 'LANDED t01', '10 BLOCKED'].join('\r\n'),
      'HANDOFF.md': [...lines, 'BLOCKED: t02'].join('\n'),
      'TASKS/01-first.md': '',
      'TASKS/02-second.md': '',
      'TASKS/03-third.md': '',
    });
    const result = (await readOrchRun(project, 'p'))!;
    expect(result.statusText).toBe(lines.slice(0, 12).join('\n'));
    expect(result.handoffText).toBe(lines.slice(0, 10).join('\n'));
    expect(result.tasks.map((task) => task.state)).toEqual(['landed', 'blocked', 'queued']);
    expect(result.phase).toBe('blocked');
  });

  it('prioritizes done without ACTIVE and blocked without inflight', async () => {
    await fixture({
      'TASKS/01-first.md': '',
      'STATUS.md': '01 BLOCKED',
      ACTIVE: '',
      'REPORT.md': 'Synthetic report',
    });
    expect((await readOrchRun(project, 'p'))!.phase).toBe('blocked');
    await rm(path.join(project, '.orch', 'ACTIVE'));
    expect((await readOrchRun(project, 'p'))!.phase).toBe('done');
  });

  it('keeps an active run running when a report exists', async () => {
    await fixture({ ACTIVE: '', 'REPORT.md': 'Synthetic report' });
    expect((await readOrchRun(project, 'p'))!.phase).toBe('running');
  });

  it('does not swallow filesystem errors other than missing files', async () => {
    await mkdir(path.join(project, '.orch', 'STATUS.md'), { recursive: true });
    await expect(readOrchRun(project, 'p')).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('does not consume the next line for empty metadata fields', async () => {
    await fixture({ 'TASKS/01-first.md': 'ROUTE: \nRISK: normal\nDEPENDS:\n02 is only explanatory text' });
    expect((await readOrchRun(project, 'p'))!.tasks[0]).toMatchObject({
      route: undefined,
      risk: 'normal',
      depends: [],
    });
  });
});

describe('readOrchRun git signal', () => {
  const sh = (...args: string[]): string =>
    execFileSync(
      'git',
      ['-C', project, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', ...args],
      {
        encoding: 'utf8',
        env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined },
      },
    ).trim();
  const commit = async (name: string): Promise<void> => {
    await writeFile(path.join(project, name), name);
    sh('add', name);
    sh('commit', '-q', '-m', name);
  };

  it('uses the inflight base when only the tip survives in the reflog', async () => {
    sh('init', '-q', '-b', 'orch/current');
    await commit('base.txt');
    const base = sh('rev-parse', 'HEAD');
    sh('checkout', '-q', '-b', 'orch-task/t01');
    await commit('work.txt');
    sh('reflog', 'delete', 'orch-task/t01@{1}');
    const tip = sh('rev-parse', 'HEAD');
    expect(sh('reflog', 'show', '--format=%H', 'orch-task/t01')).toBe(tip);
    sh('checkout', '-q', 'orch/current');
    sh('merge', '-q', '--ff-only', 'orch-task/t01');
    await fixture({ 'TASKS/01-auth.md': '' });
    expect((await readOrchRun(project, 'p'))!.tasks[0].state).toBe('queued');
    await fixture({ 'INFLIGHT.md': `01 | coder | a | wt/t01 | ${base} | 12:00` });
    expect((await readOrchRun(project, 'p'))!.tasks[0].state).toBe('landed');
  });

  it('prefers the inflight base over the reflog and refreshes when the base changes', async () => {
    sh('init', '-q', '-b', 'orch/current');
    await commit('base.txt');
    const base = sh('rev-parse', 'HEAD');
    sh('checkout', '-q', '-b', 'orch-task/t01');
    await commit('work.txt');
    const tip = sh('rev-parse', 'HEAD');
    sh('checkout', '-q', 'orch/current');
    sh('merge', '-q', '--ff-only', 'orch-task/t01');
    await fixture({
      'TASKS/01-auth.md': '',
      'INFLIGHT.md': `01 | coder | a | wt/t01 | ${tip} | 12:00`,
    });
    expect((await readOrchRun(project, 'p'))!.tasks[0].state).toBe('running');
    await fixture({ 'INFLIGHT.md': `01 | coder | a | wt/t01 | ${base} | 12:00` });
    const result = (await readOrchRun(project, 'p'))!;
    expect(result.tasks[0].state).toBe('landed');
    expect(result.inflight).toEqual([]);
  });

  it('marks merged task branches with work as landed, read-only', async () => {
    sh('init', '-q', '-b', 'main');
    await commit('base.txt');
    sh('checkout', '-q', '-b', 'orch/synthetic-run');
    for (const branch of ['orch-task/t05', 'orch-task/6', 'orch-task/t07', 'orch-task/08'])
      sh('branch', branch);
    sh('checkout', '-q', 'orch-task/t05');
    await commit('five.txt');
    sh('checkout', '-q', 'orch-task/t07');
    await commit('seven.txt');
    sh('checkout', '-q', 'orch-task/08');
    await commit('eight.txt');
    sh('checkout', '-q', 'orch/synthetic-run');
    sh('merge', '-q', '--ff-only', 'orch-task/08');
    sh('merge', '-q', '--no-ff', '-m', 'land 05', 'orch-task/t05');
    sh('checkout', '-q', 'main');
    await fixture({
      'HANDOFF.md': 'Branch orch/synthetic-run.\nIn flight: 05, 07',
      'INFLIGHT.md': '05 | coder | a | wt/t05 | abc1234 | 12:00\n07 | coder | a | wt/t07 | abc1234 | 12:00',
      ...Object.fromEntries(['05', '06', '07', '08', '09'].map((id) => [`TASKS/${id}-synthetic.md`, ''])),
    });
    const before = sh('for-each-ref', '--format=%(refname) %(objectname)');
    const result = (await readOrchRun(project, 'p'))!;
    expect(result.tasks.map(({ id, state }) => [id, state])).toEqual([
      ['05', 'landed'],
      ['06', 'queued'],
      ['07', 'running'],
      ['08', 'landed'],
      ['09', 'queued'],
    ]);
    expect(result.inflight.map((entry) => entry.task)).toEqual(['07']);
    expect(sh('for-each-ref', '--format=%(refname) %(objectname)')).toBe(before);
    expect(sh('symbolic-ref', 'HEAD')).toBe('refs/heads/main');
  });

  it('falls back to the current branch when the text names no run branch', async () => {
    sh('init', '-q', '-b', 'orch/current');
    await commit('base.txt');
    sh('checkout', '-q', '-b', 'orch-task/t02');
    await commit('two.txt');
    sh('checkout', '-q', 'orch/current');
    sh('merge', '-q', '--ff-only', 'orch-task/t02');
    await fixture({
      'STATUS.md': 'Branch orch/missing',
      'TASKS/02-synthetic.md': '',
      'TASKS/03-synthetic.md': '',
    });
    expect((await readOrchRun(project, 'p'))!.tasks.map((task) => task.state)).toEqual(['landed', 'queued']);
  });
});

describe('diffOrch', () => {
  it('emits state and blocked transitions without exposing source text', () => {
    const prev = run({
      tasks: [
        { id: '01', slug: 'private-slug', depends: [], state: 'running' },
        { id: '02', slug: 'second', depends: [], state: 'queued' },
      ],
    });
    const next = run({
      statusText: 'Synthetic private status',
      handoffText: 'Synthetic private handoff',
      tasks: [
        { ...prev.tasks[0], state: 'landed' },
        { ...prev.tasks[1], state: 'blocked' },
      ],
      blocked: ['02'],
    });
    const events = diffOrch(prev, next, 100);
    expect(events.map(({ kind, taskId, severity, data }) => ({ kind, taskId, severity, data }))).toEqual([
      { kind: 'task.state', taskId: '01', severity: 'success', data: { state: 'landed' } },
      { kind: 'task.state', taskId: '02', severity: 'warn', data: { state: 'blocked' } },
      { kind: 'blocked', taskId: '02', severity: 'warn', data: { state: 'blocked' } },
    ]);
    expect(
      events.every(
        (event) => event.ts === 100 && event.projectId === next.projectId && event.label.length <= 80,
      ),
    ).toBe(true);
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    expect(JSON.stringify(events)).not.toContain('private');
    expect(diffOrch(next, next, 101)).toEqual([]);
  });

  it('emits initial states, completion once, and reblocking after recovery', () => {
    const initial = run({ tasks: [{ id: '01', slug: 'first', depends: [], state: 'queued' }] });
    expect(diffOrch(undefined, initial, 1)).toMatchObject([
      { kind: 'task.state', data: { state: 'queued' } },
    ]);
    const done = run({ phase: 'done' });
    expect(diffOrch(initial, done, 2)).toMatchObject([{ kind: 'army.done', severity: 'success' }]);
    expect(diffOrch(done, done, 3)).toEqual([]);
    const blocked = run({ blocked: ['01'], phase: 'blocked' });
    expect(diffOrch(initial, blocked, 4)).toMatchObject([{ kind: 'blocked', taskId: '01' }]);
    expect(diffOrch(blocked, initial, 5).some((event) => event.kind === 'blocked')).toBe(false);
    expect(diffOrch(initial, blocked, 6)).toMatchObject([{ kind: 'blocked', taskId: '01' }]);
  });
});

describe('worktreeOf', () => {
  it('finds a worktree from its root or a descendant', () => {
    expect(worktreeOf('/synthetic/project/.orch/wt/t04')).toEqual({
      projectPath: '/synthetic/project',
      worktreeId: 't04',
    });
    expect(worktreeOf('/synthetic/project/.orch/wt/04/src/deep/')).toEqual({
      projectPath: '/synthetic/project',
      worktreeId: '04',
    });
    expect(worktreeOf('/synthetic/project/.orch/wt')).toBeUndefined();
    expect(worktreeOf('/synthetic/project/.orch/wt/')).toBeUndefined();
    expect(worktreeOf('/synthetic/project/src')).toBeUndefined();
    expect(worktreeOf('relative/.orch/wt/t04')).toBeUndefined();
  });
});
