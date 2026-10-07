import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, parseArgs, type CliIO } from '../src/cli.js';
import type { Digest, FetchLike } from '../src/types.js';
import pkg from '../package.json' with { type: 'json' };

let dir: string;

beforeEach(async () => {
  for (const name of ['OVERNIGHT_OWNER', 'OVERNIGHT_OUT', 'OVERNIGHT_STATE', 'OVERNIGHT_NTFY_TOPIC']) {
    vi.stubEnv(name, '');
  }
  dir = await mkdtemp(join(tmpdir(), 'overnight-cli-'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

function makeIO(extra: Partial<CliIO> = {}): CliIO & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    env: {},
    cwd: dir,
    ...extra,
  };
}

describe('parseArgs', () => {
  it('defaults to run and parses value and boolean flags', () => {
    const p = parseArgs([
      '--since',
      '48h',
      '--until=2026-10-07T06:00:00Z',
      '--no-llm',
      '--dry-run',
      '--json',
    ]);
    expect(p.command).toBe('run');
    expect(p.values).toEqual({ since: '48h', until: '2026-10-07T06:00:00Z' });
    expect([...p.flags].sort()).toEqual(['dry-run', 'json', 'no-llm']);
  });

  it('parses explicit commands', () => {
    expect(parseArgs(['run', '--out', 'x']).values).toEqual({ out: 'x' });
    const demo = parseArgs(['demo', '--days', '3', '--date', '2026-10-07']);
    expect(demo.command).toBe('demo');
    expect(demo.values).toEqual({ days: '3', date: '2026-10-07' });
    expect(parseArgs(['init']).command).toBe('init');
    expect(parseArgs(['demo', '--help']).command).toBe('help');
    expect(parseArgs(['--version']).command).toBe('version');
  });

  it('rejects bad usage', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown option --bogus/);
    expect(() => parseArgs(['--since'])).toThrow(/--since requires a value/);
    expect(() => parseArgs(['--since', '--json'])).toThrow(/--since requires a value/);
    expect(() => parseArgs(['demo', '--json'])).toThrow(/unknown option --json for "demo"/);
    expect(() => parseArgs(['run', 'extra'])).toThrow(/unexpected argument "extra"/);
    expect(() => parseArgs(['--out', 'a', 'demo'])).toThrow(/unexpected argument "demo"/);
    expect(() => parseArgs(['--json=1'])).toThrow(/does not take a value/);
    expect(() => parseArgs(['--out='])).toThrow(/--out requires a value/);
  });
});

describe('main', () => {
  it('prints help and version', async () => {
    const io = makeIO();
    expect(await main(['--help'], io)).toBe(0);
    expect(io.out.join('\n')).toContain('overnight demo');
    expect(await main(['--version'], io)).toBe(0);
    expect(io.out.at(-1)).toBe(pkg.version);
  });

  it('exits 2 on usage errors', async () => {
    const io = makeIO();
    expect(await main(['--nope'], io)).toBe(2);
    expect(io.err.join('\n')).toContain('unknown option --nope');
    expect(await main(['demo', '--days', 'zero'], io)).toBe(2);
    expect(await main(['demo', '--date', '2026-02-30'], io)).toBe(2);
  });

  it('demo writes a synthetic archive oldest-first plus demo-digest.json', async () => {
    const io = makeIO();
    expect(await main(['demo', '--out', 'public', '--days', '3', '--date', '2026-10-07'], io)).toBe(0);
    const out = join(dir, 'public');
    expect((await readdir(join(out, 'digests'))).sort()).toEqual([
      '2026-10-05.html',
      '2026-10-05.json',
      '2026-10-06.html',
      '2026-10-06.json',
      '2026-10-07.html',
      '2026-10-07.json',
    ]);
    const demo = JSON.parse(await readFile(join(out, 'demo-digest.json'), 'utf8')) as Digest;
    const latest = JSON.parse(await readFile(join(out, 'latest.json'), 'utf8')) as Digest;
    expect(demo.id).toBe('2026-10-07');
    expect(latest).toEqual(demo);
    const index = JSON.parse(await readFile(join(out, 'index.json'), 'utf8'));
    expect(index.digests).toHaveLength(3);
    expect(io.out.join('\n')).toContain('Wrote 3 synthetic digests');
  });

  it('init writes a config template once and refuses to overwrite', async () => {
    const io = makeIO({ env: { OVERNIGHT_OWNER: 'octo' } });
    expect(await main(['init'], io)).toBe(0);
    const path = join(dir, 'overnight.config.json');
    const config = JSON.parse(await readFile(path, 'utf8'));
    expect(config.owner).toBe('octo');
    expect(config.deliver.ntfy.enabled).toBe(false);
    expect(config).not.toHaveProperty('outDir');

    await writeFile(path, '{"owner":"keep"}');
    expect(await main(['init'], io)).toBe(1);
    expect(io.err.join('\n')).toContain('already exists');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ owner: 'keep' });

    const io2 = makeIO();
    expect(await main(['init', '--config', 'other.json'], io2)).toBe(0);
    expect(JSON.parse(await readFile(join(dir, 'other.json'), 'utf8')).owner).toBe('your-github-login');
  });

  it('run --dry-run --json prints the digest JSON and logs progress to stderr', async () => {
    await writeFile(
      join(dir, 'cfg.json'),
      JSON.stringify({ owner: 'acme', timezone: 'UTC', stateDir: join(dir, 'state') }),
    );
    const fetch: FetchLike = async (url) => {
      expect(url).toBe('https://api.github.com/graphql');
      const body = {
        data: { repositoryOwner: { repositories: { pageInfo: { hasNextPage: false }, nodes: [] } } },
      };
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    };
    const io = makeIO({
      env: { OVERNIGHT_GITHUB_TOKEN: 'fake-token-xyz' },
      fetch,
      now: new Date('2026-10-07T06:00:00Z'),
    });
    expect(
      await main(['--config', 'cfg.json', '--out', 'out', '--dry-run', '--json', '--since', '12h'], io),
    ).toBe(0);
    expect(io.out).toHaveLength(1);
    const digest = JSON.parse(io.out[0] ?? '') as Digest;
    expect(digest.owner).toBe('acme');
    expect(digest.window).toEqual({ since: '2026-10-06T18:00:00.000Z', until: '2026-10-07T06:00:00.000Z' });
    expect(digest.totals.projectsActive).toBe(0);
    expect(io.err.length).toBeGreaterThan(0);
    expect([...io.out, ...io.err].join('\n')).not.toContain('fake-token-xyz');
    await expect(readdir(join(dir, 'out'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('run prints a human summary', async () => {
    await writeFile(
      join(dir, 'cfg.json'),
      JSON.stringify({ owner: 'acme', timezone: 'UTC', stateDir: join(dir, 'state') }),
    );
    const fetch: FetchLike = async () => {
      const body = {
        data: { repositoryOwner: { repositories: { pageInfo: { hasNextPage: false }, nodes: [] } } },
      };
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    };
    const io = makeIO({ env: { OVERNIGHT_GITHUB_TOKEN: 't' }, fetch, now: new Date('2026-10-07T06:00:00Z') });
    expect(await main(['run', '--config', 'cfg.json', '--out', 'out', '--no-llm'], io)).toBe(0);
    const text = io.out.join('\n');
    expect(text).toContain('Window: 2026-10-06T06:00:00.000Z');
    expect(text).toContain(join(dir, 'out', 'latest.json'));
    expect(JSON.parse(await readFile(join(dir, 'state', 'state.json'), 'utf8')).lastRunAt).toBe(
      '2026-10-07T06:00:00.000Z',
    );
  });

  it('exits 1 with a clean message (no stack) on runtime errors', async () => {
    await writeFile(join(dir, 'cfg.json'), JSON.stringify({ owner: '', stateDir: join(dir, 'state') }));
    const io = makeIO();
    expect(await main(['--config', 'cfg.json'], io)).toBe(1);
    expect(io.err).toEqual(['overnight: set OVERNIGHT_OWNER or owner in overnight.config.json']);

    const debug = makeIO({ env: { OVERNIGHT_DEBUG: '1' } });
    expect(await main(['--config', 'cfg.json'], debug)).toBe(1);
    expect(debug.err.join('\n')).toMatch(/\n\s+at /);

    const missing = makeIO();
    expect(await main(['--config', 'nope.json'], missing)).toBe(1);
    expect(missing.err.join('\n')).toContain('ENOENT');
  });
});
