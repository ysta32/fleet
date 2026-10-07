import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IngestContext, SpendConfig } from '../contracts.js';
import { ingestClaudeCode } from './claude.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'claude-ingest-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function ctx(dir: string, since = 0): IngestContext {
  return {
    config: { paths: { claudeProjectsDir: dir } } as SpendConfig,
    home: tmp,
    now: Date.now(),
    since,
    fetch: globalThis.fetch,
    env: {},
  };
}

interface Opts {
  id?: string;
  req?: string;
  model?: string;
  cwd?: string;
  branch?: string;
  usage?: Record<string, unknown>;
  ts?: string;
}
function line(o: Opts = {}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: o.ts ?? '2026-10-01T00:00:00.000Z',
    sessionId: 's1',
    cwd: o.cwd ?? '/nowhere/proj',
    gitBranch: o.branch ?? 'main',
    requestId: o.req ?? 'r1',
    message: {
      id: o.id ?? 'm1',
      model: o.model ?? 'claude-sonnet-4-5',
      content: [{ type: 'text', text: 'SECRET PROMPT TEXT' }],
      usage: o.usage ?? { input_tokens: 1, output_tokens: 2 },
    },
  });
}

async function put(rel: string, lines: string[]): Promise<string> {
  const p = join(tmp, 'p', rel);
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, lines.join('\n') + '\n');
  return p;
}

describe('ingestClaudeCode', () => {
  it('reports missing dir', async () => {
    const r = await ingestClaudeCode(ctx(join(tmp, 'nope')));
    expect(r.status).toBe('missing');
    expect(r.records).toEqual([]);
  });

  it('dedupes by message.id+requestId keeping the last', async () => {
    await put('a/s.jsonl', [
      line({ usage: { input_tokens: 1, output_tokens: 1 } }),
      line({ usage: { input_tokens: 5, output_tokens: 9 } }),
      line({ id: 'm2', usage: { input_tokens: 3, output_tokens: 3 } }),
    ]);
    const r = await ingestClaudeCode(ctx(join(tmp, 'p')));
    expect(r.records).toHaveLength(2);
    const m1 = r.records.find((x) => x.tokens.output === 9);
    expect(m1?.tokens.input).toBe(5);
  });

  it('splits 5m/1h cache writes and falls back to 5m', async () => {
    await put('a/s.jsonl', [
      line({
        usage: {
          cache_read_input_tokens: 7,
          cache_creation_input_tokens: 30,
          cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 },
        },
      }),
      line({ id: 'm2', usage: { cache_creation_input_tokens: 40 } }),
    ]);
    const r = await ingestClaudeCode(ctx(join(tmp, 'p')));
    const a = r.records.find((x) => x.tokens.cacheWrite1h === 20);
    expect(a?.tokens).toMatchObject({ cacheRead: 7, cacheWrite5m: 10, cacheWrite1h: 20 });
    const b = r.records.find((x) => x.tokens.cacheWrite5m === 40);
    expect(b?.tokens.cacheWrite1h).toBe(0);
  });

  it('reads subagent files, skips synthetic and non-assistant lines, ignores malformed', async () => {
    await put('a/sess/subagents/agent-1.jsonl', [
      line({ id: 'sub' }),
      'not json {{{ "assistant"',
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      line({ id: 'syn', model: '<synthetic>' }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-10-01T00:00:00Z',
        message: { id: 'x', model: 'm' },
      }),
    ]);
    const r = await ingestClaudeCode(ctx(join(tmp, 'p')));
    expect(r.status).toBe('ok');
    expect(r.records).toHaveLength(1);
    expect(r.records[0]?.id).toContain('sub');
  });

  it('attributes worktree cwd to task and army (run branch from HEAD)', async () => {
    const proj = join(tmp, 'fleet-spend');
    await mkdir(join(proj, '.git'), { recursive: true });
    await writeFile(join(proj, '.git', 'HEAD'), 'ref: refs/heads/orch/run1\n');
    await put('a/s.jsonl', [
      line({ cwd: join(proj, '.orch/wt/t02/packages/spend'), branch: 'orch-task/t02' }),
    ]);
    const r = await ingestClaudeCode(ctx(join(tmp, 'p')));
    expect(r.records[0]).toMatchObject({ repo: 'fleet-spend', task: 't02', army: 'fleet-spend:orch/run1' });
  });

  it('worktree army is just the repo when HEAD is unreadable or detached', async () => {
    const proj = join(tmp, 'nohead');
    await mkdir(join(proj, '.git'), { recursive: true });
    await writeFile(join(proj, '.git', 'HEAD'), 'abcdef0123\n');
    await put('a/s.jsonl', [
      line({ cwd: join(proj, '.orch/wt/t03'), branch: 'orch-task/t03' }),
      line({ id: 'm2', cwd: join(tmp, 'gone', '.orch/wt/t04') }),
    ]);
    const r = await ingestClaudeCode(ctx(join(tmp, 'p')));
    expect(r.records.map((x) => x.army).sort()).toEqual(['gone', 'nohead']);
  });

  it('non-worktree on an orch/ branch gets army repo:branch', async () => {
    await put('a/s.jsonl', [line({ cwd: '/x/proj', branch: 'orch/run2' })]);
    const r = await ingestClaudeCode(ctx(join(tmp, 'p')));
    expect(r.records[0]).toMatchObject({ repo: 'proj', army: 'proj:orch/run2' });
    expect(r.records[0]).not.toHaveProperty('task');
  });

  it('uses git root basename when .git exists, else cwd basename', async () => {
    const root = join(tmp, 'work', 'myrepo');
    await mkdir(join(root, '.git'), { recursive: true });
    await mkdir(join(root, 'src', 'deep'), { recursive: true });
    await put('a/s.jsonl', [
      line({ cwd: join(root, 'src', 'deep') }),
      line({ id: 'm2', cwd: '/not/existing/leaf' }),
    ]);
    const r = await ingestClaudeCode(ctx(join(tmp, 'p')));
    expect(r.records.map((x) => x.repo).sort()).toEqual(['leaf', 'myrepo']);
  });

  it('skips files older than since by mtime', async () => {
    const p = await put('a/old.jsonl', [line()]);
    const old = new Date('2020-01-01T00:00:00Z');
    await utimes(p, old, old);
    await put('a/new.jsonl', [line({ id: 'n' })]);
    const r = await ingestClaudeCode(ctx(join(tmp, 'p'), Date.parse('2026-01-01T00:00:00Z')));
    expect(r.records).toHaveLength(1);
    expect(r.records[0]?.id).toContain('n');
  });

  it('emits no content or absolute paths', async () => {
    await put('a/s.jsonl', [line({ cwd: '/Users/someone/secret/proj' })]);
    const r = await ingestClaudeCode(ctx(join(tmp, 'p')));
    const json = JSON.stringify(r);
    expect(json).not.toContain('SECRET PROMPT TEXT');
    expect(json).not.toContain('/Users/someone');
    expect(json).not.toContain(tmp);
    expect(r.records[0]).not.toHaveProperty('content');
  });
});
