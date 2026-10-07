import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Fixed clock inside October 2026 (local time) so fixtures land in the current month. */
export const NOW = new Date(2026, 9, 7, 15, 0, 0).getTime();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

export interface FixtureOptions {
  monthlyUsd?: number | null;
}

/** Synthetic home with Claude Code + Codex logs and a Copilot CSV. Never touches real user data. */
export async function makeFixtureHome(opts: FixtureOptions = {}): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'fleet-spend-home-'));
  const claude = join(home, '.claude', 'projects', 'proj');
  await mkdir(claude, { recursive: true });
  const lines = [0, 1, 2, 3].map((i) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: iso(i * 5 * 3_600_000 + 60_000),
      sessionId: `sess-${i % 2}`,
      cwd: join(home, 'code', i % 2 ? 'alpha' : 'beta'),
      gitBranch: 'main',
      requestId: `req-${i}`,
      message: {
        id: `msg-${i}`,
        model: i === 0 ? 'claude-opus-4-1' : 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'SECRET PROMPT TEXT' }],
        usage: { input_tokens: 10_000, output_tokens: 4_000, cache_read_input_tokens: 200_000 },
      },
    }),
  );
  // a duplicated line (same message id + request id) must not be double counted
  lines.push(lines[1]!);
  await writeFile(join(claude, 'session.jsonl'), `${lines.join('\n')}\n`);

  const codex = join(home, '.codex', 'sessions', '2026', '10', '07');
  await mkdir(codex, { recursive: true });
  const usage = {
    input_tokens: 50_000,
    cached_input_tokens: 10_000,
    output_tokens: 5_000,
    total_tokens: 55_000,
  };
  await writeFile(
    join(codex, 'rollout-fixture.jsonl'),
    [
      {
        type: 'session_meta',
        payload: { id: 'codex-1', cwd: join(home, 'code', 'gamma'), git: { branch: 'dev' } },
      },
      { type: 'turn_context', payload: { model: 'gpt-5-codex' } },
      { type: 'response_item', payload: { text: 'PRIVATE PROMPT' } },
      {
        timestamp: iso(30 * 60_000),
        type: 'event_msg',
        payload: { type: 'token_count', info: { last_token_usage: usage } },
      },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n'),
  );

  const csv = join(home, 'exports', 'copilot.csv');
  await mkdir(join(home, 'exports'), { recursive: true });
  await writeFile(
    csv,
    'date,product,sku,model,quantity,unit_type,price_per_unit,applied_cost_per_quantity,gross_amount,discount_amount,net_amount,repository,organization\n' +
      '2026-10-03,Copilot,premium,claude-sonnet-4,10,requests,0.04,,0.4,,0.4,owner/repo,owner\n',
  );

  await mkdir(join(home, '.config', 'fleet'), { recursive: true });
  await writeFile(
    join(home, '.config', 'fleet', 'spend.json'),
    JSON.stringify({
      budget: { monthlyUsd: opts.monthlyUsd ?? null },
      paths: { copilotExportPath: '~/exports/copilot.csv' },
      notify: { macos: false, fleet: false, ntfyUrl: '' },
    }),
  );
  return home;
}
