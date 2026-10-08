import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeFixtureHome, NOW } from '../test/fixture-home.js';
import { errorText, main, type CliIo } from './cli.js';
import type { SpendBrief, SpendSummary } from './contracts.js';

let home: string;
beforeEach(async () => {
  home = await makeFixtureHome();
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function run(argv: string[], tty = false, env: Record<string, string> = {}) {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    stdout: { write: (s: string) => (stdout += s), isTTY: tty, columns: 100 },
    stderr: { write: (s: string) => (stderr += s) },
    env: { LANG: 'en_US.UTF-8', ...env },
    home,
    now: () => NOW,
    platform: 'linux',
    fetch: async () => {
      throw new Error('network disabled in tests');
    },
  };
  return main(argv, io).then((code) => ({ code, stdout, stderr }));
}

describe('fleet-spend cli', () => {
  it('prints the summary by default without ANSI when not a TTY', async () => {
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('Month to date');
    expect(r.stdout).toContain('alpha');
    expect(r.stdout).not.toContain('\x1b[');
    expect(r.stdout).not.toContain(home);
  });

  it('colors on a TTY unless NO_COLOR or --no-color', async () => {
    expect((await run([], true)).stdout).toContain('\x1b[');
    expect((await run([], true, { NO_COLOR: '1' })).stdout).not.toContain('\x1b[');
    expect((await run(['--no-color'], true)).stdout).not.toContain('\x1b[');
  });

  it('summary --json and json print the SpendSummary', async () => {
    const a = JSON.parse((await run(['--json'])).stdout) as SpendSummary;
    const b = JSON.parse((await run(['json'])).stdout) as SpendSummary;
    expect(a).toEqual(b);
    expect(a.generatedAt).toBe(NOW);
    expect(a.sources.find((s) => s.source === 'claude-code')?.records).toBe(4);
    const brief = JSON.parse((await run(['brief'])).stdout) as SpendBrief;
    expect(brief.monthToDateUsd).toBe(a.monthToDateUsd);
  });

  it('where: TSV when piped, table on a TTY, JSON with --json', async () => {
    const piped = await run(['where', '--by', 'model', '--limit', '2']);
    const rows = piped.stdout
      .trim()
      .split('\n')
      .map((l) => l.split('\t'));
    expect(rows[0]?.slice(0, 3)).toEqual(['model', 'costUsd', 'records']);
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map((r) => r[0])).toContain('claude-opus-4-1');
    const tty = await run(['where', '--by', 'repo'], true);
    expect(tty.stdout).toContain('gamma');
    const json = JSON.parse((await run(['where', '--by', 'source', '--json'])).stdout) as { key: string }[];
    expect(json.map((b) => b.key).sort()).toEqual(['claude-code', 'codex', 'copilot']);
  });

  it('check exits 3 on failure and errors never print the home path', async () => {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(join(home, '.config/fleet'), { recursive: true });
    writeFileSync(join(home, '.config/fleet/spend.json'), '{ not json');
    const r = await run(['check']);
    expect(r.code).toBe(3);
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
    expect(r.stderr).not.toContain(home);
    const other = await run(['json']);
    expect(other.code).toBe(1);
    expect(other.stderr).not.toContain(home);
  });

  it('errorText maps errno errors to fixed text and redacts home', () => {
    const e = Object.assign(new Error(`EACCES: permission denied, open '${home}/.config/fleet/spend.json'`), {
      code: 'EACCES',
      syscall: 'open',
    });
    expect(errorText(e, false, home)).toBe('open failed (EACCES); rerun with --debug for details');
    expect(errorText(new Error(`bad path ${home}/x`), false, home)).toBe('bad path ~/x');
    expect(errorText(e, true, home)).toContain('EACCES');
  });

  it('rejects bad flags with a one-line error and exit 1', async () => {
    for (const argv of [['where', '--by', 'planet'], ['where', '--limit', 'x'], ['frobnicate'], ['--nope']]) {
      const r = await run(argv);
      expect(r.code).toBe(1);
      expect(r.stderr.trim().split('\n')).toHaveLength(1);
      expect(r.stderr).toMatch(/^fleet-spend: /);
      expect(r.stderr).not.toContain('    at ');
    }
  });

  it('budget set/clear writes the config and check exits 0/1/2', async () => {
    expect((await run(['check'])).code).toBe(0);
    const mtd = (JSON.parse((await run(['json'])).stdout) as SpendSummary).monthToDateUsd;
    expect(mtd).toBeGreaterThan(0);

    const set = await run(['budget', 'set', String(Math.ceil(mtd * 1.5))]);
    expect(set.code).toBe(0);
    const cfg = JSON.parse(readFileSync(join(home, '.config/fleet/spend.json'), 'utf8'));
    expect(cfg.budget.monthlyUsd).toBe(Math.ceil(mtd * 1.5));
    expect(cfg.paths.copilotExportPath).toBe('~/exports/copilot.csv');
    const warn = await run(['check']);
    expect(warn.code).toBe(1);
    expect(warn.stdout).toMatch(/^warn: /);

    await run(['budget', 'set', (mtd / 2).toFixed(2)]);
    const over = await run(['check']);
    expect(over.code).toBe(2);
    expect(over.stdout).toMatch(/^over: /);
    expect((await run(['budget'])).stdout).toContain('Month to date');

    expect((await run(['budget', 'clear'])).code).toBe(0);
    expect((await run(['check'])).code).toBe(0);
    expect((await run(['budget', 'set', '-5'])).code).toBe(1);
    expect((await run(['budget', 'set'])).code).toBe(1);
  });

  it('tips, help and version', async () => {
    expect((await run(['tips'])).code).toBe(0);
    expect(Array.isArray(JSON.parse((await run(['tips', '--json'])).stdout))).toBe(true);
    expect((await run(['--help'])).stdout).toContain('fleet-spend where');
    expect((await run(['--version'])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('watch runs a cycle and stops cleanly on the stop signal', async () => {
    let stop!: () => void;
    const stopSignal = new Promise<void>((r) => (stop = r));
    let stdout = '';
    const done = main(['watch', '--interval', '5'], {
      stdout: { write: (s: string) => (stdout += s) },
      stderr: { write: () => true },
      env: {},
      home,
      now: () => NOW,
      platform: 'linux',
      stopSignal,
    });
    await expect.poll(() => stdout, { timeout: 5000 }).toContain('MTD $');
    stop();
    expect(await done).toBe(0);
  });

  it('serve rejects ports outside 4500-4999', async () => {
    const r = await run(['serve', '--port', '8080']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('4500');
  });
});
