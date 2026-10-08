import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import type { IngestContext } from '../contracts.js';
import { ingestCursor } from './cursor.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

let dir: string;
let ctx: IngestContext;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spend-cursor-'));
  ctx = {
    config: {
      budget: { monthlyUsd: null, warnAt: [0.5, 0.8] },
      anthropicAdminKeyEnv: 'TEST_ANTHROPIC_KEY',
      openaiAdminKeyEnv: 'TEST_OPENAI_KEY',
      apiIngest: false,
      paths: { cursorExportPath: join(dir, 'usage.csv') },
      notify: { macos: false, fleet: false, ntfyUrl: '' },
      port: 4917,
    },
    home: dir,
    now: Date.parse('2026-10-07'),
    since: Date.parse('2026-10-01'),
    fetch,
    env: {},
  };
});
afterEach(async () => {
  vi.clearAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const fixture = (text: string) => writeFile(ctx.config.paths.cursorExportPath!, text);

describe('ingestCursor', () => {
  it('normalizes dashboard tokens, dates and numeric vendor cost', async () => {
    await fixture(
      'Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\r\n2026-10-02T12:00:00Z,Usage,claude-test,false,150,100,20,30,200,$0.25\r\n',
    );
    const result = await ingestCursor(ctx);
    expect(result.status).toBe('ok');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      source: 'cursor',
      ts: Date.parse('2026-10-02T12:00:00Z'),
      model: 'claude-test',
      tokens: { input: 100, output: 30, cacheRead: 20, cacheWrite5m: 50, cacheWrite1h: 0 },
      vendorCostUsd: 0.25,
    });
    expect(await ingestCursor(ctx)).toEqual(result);
  });
  it('tolerates missing columns, mixed case and nonnumeric costs, and filters dates', async () => {
    await fixture('dAtE,CoSt\n2026-10-01,Included\n2026-09-30,20\ninvalid,40\n2026-10-03,0');
    const { records } = await ingestCursor(ctx);
    expect(records).toHaveLength(2);
    expect(records[0].model).toBe('unknown');
    expect(records[0].tokens).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    });
    expect(records[0]).not.toHaveProperty('vendorCostUsd');
    expect(records[1].vendorCostUsd).toBe(0);
  });
  it('never opens a configured local database', async () => {
    ctx.config.paths.cursorDbPath = join(dir, 'state.vscdb');
    await writeFile(ctx.config.paths.cursorDbPath, 'synthetic database');
    delete ctx.config.paths.cursorExportPath;
    const read = vi.mocked(fs.readFile);
    expect(await ingestCursor(ctx)).toEqual({
      source: 'cursor',
      records: [],
      status: 'missing',
      note: 'export usage CSV from cursor.com/dashboard and set paths.cursorExportPath',
    });
    expect(read).not.toHaveBeenCalled();
  });
  it('reports missing files and malformed exports without exposing paths', async () => {
    expect((await ingestCursor(ctx)).status).toBe('missing');
    await fixture('Date,Model\n2026-10-01,"unterminated');
    const result = await ingestCursor(ctx);
    expect(result.status).toBe('error');
    expect(result.records).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(dir);
  });
  it('retains repeated usage rows with distinct stable ids', async () => {
    await fixture('Date,Model\n2026-10-01,test\n2026-10-01,test');
    const { records } = await ingestCursor(ctx);
    expect(new Set(records.map((record) => record.id)).size).toBe(2);
    expect((await ingestCursor(ctx)).records).toEqual(records);
  });
});
