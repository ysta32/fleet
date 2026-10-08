import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeFixtureHome, NOW } from '../test/fixture-home.js';
import { analyze, collect, INGESTERS } from './collect.js';
import { loadConfig } from './config.js';
import type { Ingester } from './contracts.js';
import { loadAll } from './index.js';

let home: string;
beforeEach(async () => {
  home = await makeFixtureHome({ monthlyUsd: 100 });
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const config = () => loadConfig(join(home, '.config/fleet/spend.json'), home);

describe('collect', () => {
  it('runs every ingester, dedupes, and reports sources', async () => {
    const result = await collect({ now: NOW, config: config(), home, env: {} });
    const by = Object.fromEntries(result.sources.map((s) => [s.source, s]));
    expect(result.sources.map((s) => s.source)).toEqual(INGESTERS.map(([s]) => s));
    expect(by['claude-code']).toMatchObject({ status: 'ok', records: 4 });
    expect(by.codex).toMatchObject({ status: 'ok', records: 1 });
    expect(by.copilot).toMatchObject({ status: 'ok', records: 1 });
    expect(by.cursor?.status).toBe('missing');
    expect(by['anthropic-api']?.status).toBe('missing');
    expect(result.records).toHaveLength(6);
    expect(new Set(result.records.map((r) => r.id)).size).toBe(6);
  });

  it('turns a rejected ingester into a path-free error source and keeps the rest', async () => {
    const boom: Ingester = async () => {
      throw Object.assign(new Error(`EACCES: permission denied, open '${home}/secret'`), { code: 'EACCES' });
    };
    const dup: Ingester = async () => ({
      source: 'cursor',
      status: 'ok',
      records: [
        {
          id: 'x:1',
          source: 'cursor',
          ts: NOW - 1000,
          model: 'm',
          tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
        },
        {
          id: 'x:1',
          source: 'cursor',
          ts: NOW - 1000,
          model: 'm',
          tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
        },
      ],
    });
    const result = await collect({ now: NOW, config: config(), home, env: {} }, [
      ['claude-code', boom],
      ['cursor', dup],
    ]);
    expect(result.sources[0]).toEqual({
      source: 'claude-code',
      records: 0,
      status: 'error',
      note: 'ingest failed (EACCES)',
    });
    expect(result.records).toHaveLength(1);
    expect(JSON.stringify(result.sources)).not.toContain(home);
  });

  it('passes since = month start minus 31 days by default', async () => {
    let seen = 0;
    const spy: Ingester = async (ctx) => {
      seen = ctx.since;
      return { source: 'codex', status: 'missing', records: [] };
    };
    await collect({ now: NOW, config: config(), home, env: {} }, [['codex', spy]]);
    expect(seen).toBe(new Date(2026, 9, 1).getTime() - 31 * 86_400_000);
  });

  it('summary JSON contains no fixture home path or prompt text', async () => {
    const { summary, brief } = await loadAll(
      { now: NOW, configPath: join(home, '.config/fleet/spend.json') },
      { home, env: {} },
    );
    expect(summary.monthToDateUsd).toBeGreaterThan(0);
    expect(summary.budget.monthlyUsd).toBe(100);
    expect(summary.breakdown.repo.map((b) => b.key)).toEqual(
      expect.arrayContaining(['alpha', 'beta', 'gamma']),
    );
    for (const text of [JSON.stringify(summary), JSON.stringify(brief)]) {
      expect(text).not.toContain(home);
      expect(text).not.toContain('SECRET PROMPT');
      expect(text).not.toContain('PRIVATE PROMPT');
    }
    expect(brief.monthToDateUsd).toBe(summary.monthToDateUsd);
    expect(analyze(await collect({ now: NOW, config: config(), home, env: {} }), config(), NOW)).toEqual(
      summary,
    );
  });
});
