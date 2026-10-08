import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IngestContext } from '../contracts.js';
import { ingestCodex } from './codex.js';

let home: string;
let ctx: IngestContext;
const timestamp = '2026-10-07T12:00:00.000Z';
const ts = Date.parse(timestamp);
const usage = (input: number, cached: number, output: number) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  output_tokens: output,
  reasoning_output_tokens: 7,
  total_tokens: input + output,
});
const event = (info: unknown, time = timestamp) => ({
  timestamp: time,
  type: 'event_msg',
  payload: { type: 'token_count', info },
});

async function fixture(lines: unknown[], name = 'rollout-test.jsonl'): Promise<void> {
  const directory = join(
    ctx.config.paths.codexSessionsDir ?? join(home, '.codex', 'sessions'),
    '2026',
    '10',
    '07',
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, name),
    lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n'),
  );
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'fleet-codex-'));
  ctx = {
    home,
    now: ts,
    since: 0,
    fetch,
    env: {},
    config: {
      budget: { monthlyUsd: null, warnAt: [0.5, 0.8] },
      anthropicAdminKeyEnv: 'ANTHROPIC_ADMIN_KEY',
      openaiAdminKeyEnv: 'OPENAI_ADMIN_KEY',
      apiIngest: false,
      paths: {},
      notify: { macos: false, fleet: false, ntfyUrl: '' },
      port: 4917,
    },
  };
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('ingestCodex', () => {
  it('uses last usage, splits cached input, and does not double count reasoning', async () => {
    await fixture([
      {
        type: 'session_meta',
        payload: { id: 'session-1', cwd: '/private/projects/my-repo', git: { branch: 'feature/spend' } },
      },
      { type: 'turn_context', payload: { model: 'gpt-5-codex' } },
      { type: 'response_item', payload: { text: 'PRIVATE PROMPT' } },
      event({ last_token_usage: usage(100, 30, 20), total_token_usage: usage(500, 100, 200) }),
      { type: 'turn_context', payload: { model: 'gpt-5' } },
      event({ last_token_usage: usage(10, 0, 8) }),
    ]);
    const result = await ingestCodex(ctx);
    expect(result.status).toBe('ok');
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      source: 'codex',
      ts,
      model: 'gpt-5-codex',
      sessionId: 'session-1',
      repo: 'my-repo',
      branch: 'feature/spend',
      tokens: { input: 70, cacheRead: 30, output: 20, cacheWrite5m: 0, cacheWrite1h: 0 },
    });
    expect(result.records[1]?.model).toBe('gpt-5');
    expect(new Set(result.records.map((record) => record.id)).size).toBe(2);
    expect((await ingestCodex(ctx)).records).toEqual(result.records);
    expect(JSON.stringify(result)).not.toContain('/private/projects');
    expect(JSON.stringify(result)).not.toContain('PRIVATE PROMPT');
    expect(JSON.stringify(result)).not.toContain(home);
  });

  it.each([true, false])('skips repeated totals with last usage present: %s', async (withLast) => {
    const info = {
      total_token_usage: usage(100, 30, 20),
      ...(withLast ? { last_token_usage: usage(100, 30, 20) } : {}),
    };
    await fixture([event(info), event(info, '2026-10-07T12:01:00.000Z')]);
    const result = await ingestCodex(ctx);
    expect(result.status).toBe('ok');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.tokens).toEqual({
      input: 70,
      cacheRead: 30,
      output: 20,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    });
  });

  it('skips zero cumulative usage and updates the baseline on a reset to zero', async () => {
    await fixture([
      event({ total_token_usage: usage(0, 0, 0) }),
      event({ total_token_usage: usage(100, 30, 20) }),
      event({ total_token_usage: usage(0, 0, 0) }),
      event({ total_token_usage: usage(100, 30, 20) }),
    ]);
    const result = await ingestCodex(ctx);
    expect(result.records.map((record) => record.tokens.input)).toEqual([70, 70]);
    expect(result.records.map((record) => record.tokens.output)).toEqual([20, 20]);
  });

  it('diffs cumulative totals, including totals before since and beside last usage', async () => {
    ctx.since = ts;
    await fixture([
      event({ total_token_usage: usage(100, 30, 20) }, '2026-10-06T12:00:00Z'),
      event({ total_token_usage: usage(150, 40, 35) }),
      event({ last_token_usage: usage(20, 5, 10), total_token_usage: usage(170, 45, 45) }),
      event({ total_token_usage: usage(200, 50, 60) }),
    ]);
    const result = await ingestCodex(ctx);
    expect(result.records.map((record) => record.tokens)).toEqual([
      { input: 40, cacheRead: 10, output: 15, cacheWrite5m: 0, cacheWrite1h: 0 },
      { input: 15, cacheRead: 5, output: 10, cacheWrite5m: 0, cacheWrite1h: 0 },
      { input: 25, cacheRead: 5, output: 15, cacheWrite5m: 0, cacheWrite1h: 0 },
    ]);
  });

  it('starts totals at zero and handles a cumulative counter reset', async () => {
    await fixture([
      event({ total_token_usage: usage(100, 30, 20) }),
      event({ total_token_usage: usage(10, 2, 8) }),
    ]);
    const result = await ingestCodex(ctx);
    expect(result.records.map((record) => record.tokens.input)).toEqual([70, 8]);
    expect(result.records.map((record) => record.tokens.output)).toEqual([20, 8]);
  });

  it('tolerates unknown and malformed lines and absent older-format metadata', async () => {
    await fixture([
      'not json',
      null,
      [],
      { type: 'future_type', payload: {} },
      event(null),
      event({}),
      event({ last_token_usage: usage(-1, 0, 2) }),
      event({ last_token_usage: usage(1, 2, 3) }),
      event({ last_token_usage: usage(1, 0, 2) }, 'invalid'),
      event({ last_token_usage: { input_tokens: 12, output_tokens: 3 } }),
      '{"unfinished":',
    ]);
    const result = await ingestCodex(ctx);
    expect(result.status).toBe('ok');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      model: 'unknown',
      tokens: { input: 12, output: 3, cacheRead: 0 },
    });
    expect(result.records[0]).not.toHaveProperty('sessionId');
  });

  it('honors the directory override and isolates cumulative state between files', async () => {
    ctx.config.paths.codexSessionsDir = join(home, 'override');
    await fixture([event({ total_token_usage: usage(100, 0, 20) })], 'rollout-a.jsonl');
    await fixture([event({ total_token_usage: usage(120, 0, 30) })], 'rollout-b.jsonl');
    await fixture([event({ total_token_usage: usage(999, 0, 999) })], 'unrelated.jsonl');
    const result = await ingestCodex(ctx);
    expect(result.records.map((record) => record.tokens.input)).toEqual([100, 120]);
    expect(new Set(result.records.map((record) => record.id)).size).toBe(2);
  });

  it('returns missing for an absent sessions directory', async () => {
    expect(await ingestCodex(ctx)).toEqual({ source: 'codex', records: [], status: 'missing' });
  });

  it('returns ok for an empty directory', async () => {
    await mkdir(join(home, '.codex', 'sessions'), { recursive: true });
    expect(await ingestCodex(ctx)).toEqual({ source: 'codex', records: [], status: 'ok' });
  });

  it('reports read errors without disclosing paths', async () => {
    ctx.config.paths.codexSessionsDir = join(home, 'not-a-directory');
    await writeFile(ctx.config.paths.codexSessionsDir, '');
    const result = await ingestCodex(ctx);
    expect(result.status).toBe('error');
    expect(result.records).toEqual([]);
    expect(result.note).not.toContain(home);
  });
});
