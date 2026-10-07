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
