import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IngestContext } from '../contracts.js';
import { ingestCopilot } from './copilot.js';

let dir: string;
let ctx: IngestContext;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spend-copilot-'));
  ctx = {
    config: {
      budget: { monthlyUsd: null, warnAt: [0.5, 0.8] },
      anthropicAdminKeyEnv: 'TEST_ANTHROPIC_KEY',
      openaiAdminKeyEnv: 'TEST_OPENAI_KEY',
      apiIngest: false,
      paths: { copilotExportPath: join(dir, 'usage.csv') },
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
  await rm(dir, { recursive: true, force: true });
});
const fixture = (text: string) => writeFile(ctx.config.paths.copilotExportPath!, text);

describe('ingestCopilot', () => {
  it('reads billing exports with net, gross and computed cost precedence', async () => {
    await fixture(
      'date,product,sku,model,quantity,unit_type,price_per_unit,applied_cost_per_quantity,gross_amount,discount_amount,net_amount,repository,organization\r\n2026-10-01,Copilot,premium,gpt-test,10,requests,0.5,,5,5,0,owner/repo,owner\r\n2026-10-02,Copilot,premium,claude-test,3,requests,0.5,,2,,,owner/repo,owner\r\n2026-10-03,Copilot,premium,other,2,requests,,0.25,,,,,owner\r\n',
    );
    const result = await ingestCopilot(ctx);
    expect(result.status).toBe('ok');
    expect(result.records.map((r) => r.vendorCostUsd)).toEqual([0, 2, 0.5]);
    expect(result.records.map((r) => r.requests)).toEqual([10, 3, 2]);
    expect(result.records.map((r) => r.model)).toEqual(['gpt-test', 'claude-test', 'other']);
    expect(result.records[0].repo).toBe('owner/repo');
    expect(result.records[2]).not.toHaveProperty('repo');
    expect(result.records[0].tokens).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    });
    expect(await ingestCopilot(ctx)).toEqual(result);
  });
  it('tolerates absent columns and rejects invalid dates and quantities', async () => {
    await fixture('DATE,Quantity\n2026-10-01,\n2026-10-02,Included\n2026-09-30,4\ninvalid,3');
    const { records } = await ingestCopilot(ctx);
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.model).toBe('unknown');
      expect(record).not.toHaveProperty('requests');
      expect(record).not.toHaveProperty('vendorCostUsd');
    }
  });
  it('keeps only repository display names and ignores text columns', async () => {
    await fixture(
      'date,repository,prompt\n2026-10-01,/private/synthetic/project,private text\n2026-10-02,C:\\synthetic\\project,private text',
    );
    const result = await ingestCopilot(ctx);
    expect(result.records.map((r) => r.repo)).toEqual(['project', 'project']);
    expect(JSON.stringify(result)).not.toMatch(/private text|synthetic/);
  });
  it('handles empty, missing and malformed exports', async () => {
    expect((await ingestCopilot(ctx)).status).toBe('missing');
    await fixture('');
    expect(await ingestCopilot(ctx)).toEqual({ source: 'copilot', records: [], status: 'ok' });
    await fixture('date\n"unfinished');
    const result = await ingestCopilot(ctx);
    expect(result.status).toBe('error');
    expect(JSON.stringify(result)).not.toContain(dir);
    delete ctx.config.paths.copilotExportPath;
    expect((await ingestCopilot(ctx)).status).toBe('missing');
  });
});
