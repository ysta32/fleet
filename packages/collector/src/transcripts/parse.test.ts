import { describe, expect, it } from 'vitest';
import type { FleetEvent } from '@fleet/shared';
import { SessionParser } from './parse.js';
import type { TranscriptFile } from './tailer.js';

const SECRET = 'SECRET-PROMPT-zebra-7731';
const T0 = Date.parse('2026-10-07T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const leadFile: TranscriptFile = {
  path: '/synthetic/projects/-tmp-demo/sess-1.jsonl',
  sessionId: 'sess-1',
  projectDir: '-tmp-demo',
  projectId: '-tmp-demo',
  isSubagent: false,
};

const subFile: TranscriptFile = {
  path: '/synthetic/projects/-tmp-demo/sess-1/subagents/agent-abc.jsonl',
  sessionId: 'sess-1',
  projectDir: '-tmp-demo',
  projectId: '-tmp-demo',
  isSubagent: true,
  parentSessionId: 'sess-1',
  agentFileId: 'abc',
};

const usage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 1000,
  cache_creation_input_tokens: 10,
};

function user(at: number, text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user',
    timestamp: iso(at),
    sessionId: 'sess-1',
    cwd: '/tmp/demo',
    gitBranch: 'main',
    message: { role: 'user', content: text },
    ...extra,
  });
}

function toolResult(at: number, toolUseId: string, cwd = '/tmp/demo'): string {
  return JSON.stringify({
    type: 'user',
    timestamp: iso(at),
    cwd,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: `${SECRET} output` }],
    },
  });
}

function assistant(
  at: number,
  id: string,
  content: unknown[],
  opts: { stop?: string | null; model?: string; cwd?: string; usage?: object } = {},
): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: iso(at),
    sessionId: 'sess-1',
    cwd: opts.cwd ?? '/tmp/demo',
    gitBranch: 'main',
    message: {
      id,
      model: opts.model ?? 'claude-opus-4-1',
      role: 'assistant',
      stop_reason: opts.stop ?? null,
      content,
      usage: opts.usage ?? usage,
    },
  });
}

const tool = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });

function kinds(events: FleetEvent[]): string[] {
  return events.map((e) => e.kind);
}

describe('SessionParser (lead transcript)', () => {
  function fixture(): string[] {
    return [
      JSON.stringify({ type: 'permission-mode', permissionMode: 'default' }),
      user(T0, `${SECRET} please fix things`),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Fix the widget' }),
      // one message split over three lines with repeated usage
      assistant(T0 + 1000, 'msg_1', [{ type: 'thinking', thinking: `${SECRET} thinking` }]),
      assistant(T0 + 1000, 'msg_1', [{ type: 'text', text: `${SECRET} answer` }]),
      assistant(
        T0 + 1000,
        'msg_1',
        [
          tool('tu_1', 'Edit', {
            file_path: `/tmp/demo/src/store.ts`,
            old_string: SECRET,
            new_string: SECRET,
          }),
        ],
        { stop: 'tool_use' },
      ),
      toolResult(T0 + 2000, 'tu_1'),
      assistant(T0 + 3000, 'msg_2', [tool('tu_2', 'Bash', { command: `npm test -- --grep "${SECRET}"` })]),
      toolResult(T0 + 4000, 'tu_2'),
      assistant(T0 + 5000, 'msg_3', [
        tool('tu_3', 'Agent', { subagent_type: 'orch-coder', model: 'sonnet', prompt: `${SECRET} do it` }),
      ]),
      toolResult(T0 + 6000, 'tu_3'),
      assistant(T0 + 7000, 'msg_4', [tool('tu_4', 'Bash', { command: 'gh pr merge 12 --squash' })]),
      toolResult(T0 + 8000, 'tu_4'),
      assistant(T0 + 9000, 'msg_5', [tool('tu_5', 'Bash', { command: 'git merge-base main HEAD' })]),
      toolResult(T0 + 9500, 'tu_5'),
      assistant(T0 + 10_000, 'msg_6', [
        tool('tu_6', 'Bash', { command: 'gh release create v1.2.3 --notes x' }),
      ]),
      toolResult(T0 + 11_000, 'tu_6'),
      JSON.stringify({ type: 'system', subtype: 'info', timestamp: iso(T0 + 11_500), content: SECRET }),
      JSON.stringify({ type: 'file-history-snapshot', snapshot: { files: [SECRET] } }),
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: SECRET }),
      assistant(T0 + 12_000, 'msg_7', [{ type: 'text', text: `${SECRET} done` }], { stop: 'end_turn' }),
      '{"type":"assistant", truncated partial line',
    ];
  }

  it('sums tokens once per message.id and estimates cost', () => {
    const p = new SessionParser(leadFile);
    p.ingest(fixture(), T0 + 12_500);
    const s = p.session(T0 + 12_500);
    // 7 distinct messages, msg_1 spans 3 lines
    expect(s.tokens).toEqual({ input: 700, output: 350, cacheRead: 7000, cacheWrite: 70 });
    expect(s.costUsd).toBeGreaterThan(0);
    expect(s.model).toBe('opus');
    expect(s.modelId).toBe('claude-opus-4-1');
    expect(s.title).toBe('Fix the widget');
    expect(s.gitBranch).toBe('main');
    expect(s.toolCalls).toBe(6);
    expect(s.lastTool).toEqual({ name: 'Bash', target: 'gh', at: T0 + 10_000 });
    expect(s.startedAt).toBe(T0);
    expect(s.lastActivity).toBe(T0 + 12_000);
    expect(s.agentIds).toEqual(['sess-1']);
  });

  it('takes the max usage when a repeated message line grows', () => {
    const p = new SessionParser(leadFile);
    p.ingest(
      [
        assistant(T0, 'm', [], { usage: { input_tokens: 10, output_tokens: 5 } }),
        assistant(T0, 'm', [], { usage: { input_tokens: 10, output_tokens: 40 } }),
        assistant(T0, 'm', [], { usage: { input_tokens: 10, output_tokens: 40 } }),
      ],
      T0,
    );
    expect(p.session(T0).tokens).toEqual({ input: 10, output: 40, cacheRead: 0, cacheWrite: 0 });
  });

  it('emits sanitized tool, spawn, test, merge and release events', () => {
    const p = new SessionParser(leadFile);
    const events = p.ingest(fixture(), T0 + 12_500);
    expect(events[0]).toMatchObject({
      kind: 'session.start',
      ts: T0,
      sessionId: 'sess-1',
      agentId: 'sess-1',
    });
    expect(kinds(events).filter((k) => k === 'session.start')).toHaveLength(1);

    const toolLabels = events.filter((e) => e.kind === 'agent.tool').map((e) => e.label);
    expect(toolLabels).toEqual([
      'Edit store.ts',
      'Bash npm',
      'Agent orch-coder',
      'Bash gh',
      'Bash git',
      'Bash gh',
    ]);

    const spawn = events.find((e) => e.kind === 'agent.spawn');
    expect(spawn?.data).toEqual({ role: 'coder', subagentType: 'orch-coder', model: 'sonnet' });

    const test = events.filter((e) => e.kind === 'test.run');
    expect(test).toHaveLength(1);
    expect(test[0]?.data).toEqual({ runner: 'npm' });

    const merges = events.filter((e) => e.kind === 'merge');
    expect(merges).toHaveLength(1); // git merge-base is not a merge
    expect(merges[0]).toMatchObject({ label: 'PR #12 merged', data: { pr: 12 } });

    const release = events.filter((e) => e.kind === 'release');
    expect(release).toHaveLength(1);
    expect(release[0]).toMatchObject({ label: 'Release v1.2.3', data: { tag: 'v1.2.3' } });

    for (const e of events) {
      expect(e.projectId).toBe('-tmp-demo');
      expect(e.label.length).toBeLessThanOrEqual(80);
    }
  });

  it('never emits or stores message content', () => {
    const p = new SessionParser(leadFile);
    const now = T0 + 60_000;
    const events = p.ingest(fixture(), now);
    const all = JSON.stringify({ events, session: p.session(now), agents: p.agents(now) });
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('zebra');
    expect(all).not.toContain('please fix');
    expect(all).not.toContain('--squash');
  });

  it('derives statuses from time and turn state', () => {
    const p = new SessionParser(leadFile);
    const end = T0 + 12_000;
    p.ingest(fixture(), end + 1000);
    expect(p.session(end + 10_000).status).toBe('active');
    expect(p.agents(end + 10_000)[0]?.status).toBe('working');
    expect(p.session(end + 31_000).status).toBe('waiting');
    expect(p.agents(end + 31_000)[0]?.status).toBe('waiting');
    expect(p.session(end + 30 * 60_000).status).toBe('ended');
    expect(p.agents(end + 30 * 60_000)[0]?.status).toBe('done');

    // a turn that is mid-tool is never waiting; it goes active -> idle -> ended
    const q = new SessionParser(leadFile);
    q.ingest([user(T0, 'x'), assistant(T0 + 1000, 'm1', [tool('t1', 'Read', { file_path: '/a/b.ts' })])], T0);
    expect(q.session(T0 + 60_000).status).toBe('active');
    expect(q.session(T0 + 5 * 60_000).status).toBe('idle');
    expect(q.agents(T0 + 5 * 60_000)[0]?.status).toBe('idle');
    expect(q.session(T0 + 31 * 60_000).status).toBe('ended');
  });

  it('emits session.waiting once per turn after 30s idle, via ingest ticks', () => {
    const p = new SessionParser(leadFile);
    const end = T0 + 12_000;
    expect(kinds(p.ingest(fixture(), end + 1000))).not.toContain('session.waiting');
    expect(p.ingest([], end + 20_000)).toEqual([]);
    const tick = p.ingest([], end + 31_000);
    expect(kinds(tick)).toEqual(['session.waiting']);
    expect(tick[0]).toMatchObject({ ts: end + 31_000, severity: 'warn', sessionId: 'sess-1' });
    expect(p.ingest([], end + 40_000)).toEqual([]);

    // user replies -> new turn -> can wait again
    p.ingest(
      [
        user(end + 50_000, 'more'),
        assistant(end + 51_000, 'msg_8', [{ type: 'text', text: 'ok' }], { stop: 'end_turn' }),
      ],
      end + 52_000,
    );
    expect(p.session(end + 52_000).status).toBe('active');
    expect(kinds(p.ingest([], end + 90_000))).toEqual(['session.waiting']);
  });

  it('moves the agent into worktrees and review', () => {
    const p = new SessionParser(leadFile);
    const events = p.ingest(
      [
        user(T0, 'x'),
        assistant(T0 + 1000, 'm1', [tool('t1', 'Read', { file_path: '/a/b.ts' })], {
          cwd: '/tmp/demo/.orch/wt/t04/packages',
        }),
        toolResult(T0 + 1500, 't1', '/tmp/demo/.orch/wt/t04'),
        assistant(T0 + 2000, 'm2', [tool('t2', 'Agent', { subagent_type: 'orch-critic', prompt: 'p' })], {
          cwd: '/tmp/demo/.orch/wt/t04',
        }),
        toolResult(T0 + 2500, 't2', '/tmp/demo/.orch/wt/t04'),
        assistant(T0 + 3000, 'm3', [tool('t3', 'Bash', { command: 'gpt code --task x ro' })], {
          cwd: '/tmp/demo/.orch/wt/t04',
        }),
        toolResult(T0 + 3500, 't3', '/tmp/demo/.orch/wt/t04'),
        assistant(T0 + 4000, 'm4', [tool('t4', 'Bash', { command: 'ls' })], { cwd: '/tmp/demo' }),
      ],
      T0 + 5000,
    );
    const moves = events.filter((e) => e.kind === 'agent.move').map((e) => e.to);
    expect(moves).toEqual([
      { kind: 'worktree', projectId: '-tmp-demo', ref: 't04' },
      { kind: 'review', projectId: '-tmp-demo' }, // critic spawn; `gpt code ... ro` keeps it there
      { kind: 'project', projectId: '-tmp-demo' },
    ]);
    const spawn = events.find((e) => e.kind === 'agent.spawn');
    expect(spawn?.data).toEqual({ role: 'critic', subagentType: 'orch-critic' });
  });

  it('detects test runners only for listed commands containing "test"', () => {
    const p = new SessionParser(leadFile);
    const cmds = [
      'FOO=1 npx vitest run packages/x',
      'cargo test',
      'go test ./...',
      'echo test',
      'npm run build',
      'pytest -q tests/',
    ];
    const events = p.ingest(
      cmds.map((command, i) => assistant(T0 + i, `m${i}`, [tool(`t${i}`, 'Bash', { command })])),
      T0 + 10,
    );
    expect(events.filter((e) => e.kind === 'test.run').map((e) => e.data?.runner)).toEqual([
      'npx',
      'cargo',
      'go',
      'pytest',
    ]);
  });

  it('is incremental across ingest calls', () => {
    const lines = fixture();
    const whole = new SessionParser(leadFile);
    whole.ingest(lines, T0 + 20_000);
    const parts = new SessionParser(leadFile);
    const evs: FleetEvent[] = [];
    for (const l of lines) evs.push(...parts.ingest([l], T0 + 12_500));
    expect(kinds(evs).filter((k) => k === 'session.start')).toHaveLength(1);
    expect(parts.session(T0 + 20_000)).toEqual(whole.session(T0 + 20_000));
  });
});

describe('SessionParser (subagent transcript)', () => {
  const lines = [
    user(T0, `${SECRET} subagent prompt`, { isSidechain: true }),
    assistant(T0 + 1000, 's1', [tool('x1', 'Write', { file_path: '/tmp/demo/a.ts', content: SECRET })], {
      model: 'claude-sonnet-4-5',
      cwd: '/tmp/demo/.orch/wt/t07',
    }),
    toolResult(T0 + 2000, 'x1', '/tmp/demo/.orch/wt/t07'),
    assistant(T0 + 3000, 's2', [{ type: 'text', text: SECRET }], {
      model: 'claude-sonnet-4-5',
      stop: 'end_turn',
      cwd: '/tmp/demo/.orch/wt/t07',
    }),
  ];

  it('produces one agent with a composite id and no session events', () => {
    const p = new SessionParser(subFile);
    expect(p.isSubagent).toBe(true);
    const events = p.ingest(lines, T0 + 3500);
    expect(kinds(events)).not.toContain('session.start');
    expect(kinds(events)).not.toContain('session.waiting');
    for (const e of events) {
      expect(e.agentId).toBe('sess-1:abc');
      expect(e.sessionId).toBe('sess-1');
    }
    const agents = p.agents(T0 + 3500);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: 'sess-1:abc',
      sessionId: 'sess-1',
      model: 'sonnet',
      status: 'done',
      location: { kind: 'worktree', projectId: '-tmp-demo', ref: 't07' },
      lastTool: { name: 'Write', target: 'a.ts' },
    });
    const s = p.session(T0 + 3500);
    expect(s.id).toBe('sess-1:abc');
    expect(s.tokens.input).toBe(200);
    expect(s.costUsd).toBeGreaterThan(0);
    expect(p.ingest([], T0 + 60_000)).toEqual([]);
    expect(JSON.stringify({ events, s, agents })).not.toContain(SECRET);
  });

  it('is working while mid-turn', () => {
    const p = new SessionParser(subFile);
    p.ingest(lines.slice(0, 2), T0 + 1000);
    expect(p.agents(T0 + 5000)[0]?.status).toBe('working');
  });
});
