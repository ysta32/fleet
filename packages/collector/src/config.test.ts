import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configPath, dataDir, loadConfig } from './config.js';

let home: string;
const saved = { ...process.env };
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'fleet-cfg-'));
  process.env.HOME = home;
  delete process.env.FLEET_CONFIG;
  delete process.env.FLEET_DATA;
  delete process.env.FLEET_PORT;
  delete process.env.FLEET_LAN;
});
afterEach(() => {
  process.env.HOME = saved.HOME;
});

describe('config', () => {
  it('resolves paths from HOME and env', () => {
    expect(configPath()).toBe(join(home, '.config/fleet/config.json'));
    expect(dataDir()).toBe(join(home, '.local/share/fleet'));
    process.env.FLEET_CONFIG = '/x/c.json';
    process.env.FLEET_DATA = '/x/d';
    expect(configPath()).toBe('/x/c.json');
    expect(dataDir()).toBe('/x/d');
  });

  it('generates defaults and a token with 0600/0700 perms', () => {
    const cfg = loadConfig();
    expect(cfg).toMatchObject({
      port: 4747,
      lan: false,
      shareContent: false,
      github: true,
      githubPollMs: 60000,
      recentWindowMs: 86400000,
      claudeProjectsDir: join(home, '.claude/projects'),
    });
    expect(cfg.notify).toEqual({
      macos: true,
      ntfyUrl: '',
      kinds: ['army.done', 'army.blocked', 'ci.failed', 'session.waiting', 'deploy.failed'],
    });
    expect(cfg.token).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, '.config/fleet')).mode & 0o777).toBe(0o700);
    expect(loadConfig().token).toBe(cfg.token);
  });

  it('merges user values over defaults, including partial notify', () => {
    const p = join(home, 'c.json');
    writeFileSync(p, JSON.stringify({ port: 4510, token: 'abc', notify: { ntfyUrl: 'https://ntfy.sh/t' } }));
    const cfg = loadConfig(p);
    expect(cfg.port).toBe(4510);
    expect(cfg.token).toBe('abc');
    expect(cfg.notify.macos).toBe(true);
    expect(cfg.notify.ntfyUrl).toBe('https://ntfy.sh/t');
    expect(cfg.notify.kinds).toHaveLength(5);
    expect(JSON.parse(readFileSync(p, 'utf8')).token).toBe('abc');
  });

  it('adds a token to an existing file lacking one', () => {
    const p = join(home, 'sub', 'c.json');
    mkdirSync(join(home, 'sub'));
    writeFileSync(p, JSON.stringify({ port: 4511 }));
    const cfg = loadConfig(p);
    expect(cfg.token).toHaveLength(64);
    expect(JSON.parse(readFileSync(p, 'utf8')).port).toBe(4511);
  });

  it('applies env overrides without persisting them', () => {
    process.env.FLEET_PORT = '4520';
    process.env.FLEET_LAN = '1';
    const cfg = loadConfig();
    expect(cfg.port).toBe(4520);
    expect(cfg.lan).toBe(true);
    const saved = JSON.parse(readFileSync(configPath(), 'utf8'));
    expect(saved.port).toBe(4747);
    expect(saved.lan).toBe(false);
  });

  it('first-run creation is exclusive: adopts a token written by a racing process', () => {
    const p = join(home, 'race', 'c.json');
    const first = loadConfig(p);
    // simulate losing the race: file already exists with a different token
    writeFileSync(p, JSON.stringify({ token: 'other' }));
    expect(loadConfig(p).token).toBe('other');
    expect(first.token).not.toBe('other');
    expect(readdirSync(join(home, 'race'))).toEqual(['c.json']);
  });

  it('many concurrent first loads converge on one token', async () => {
    const p = join(home, 'conc', 'c.json');
    const toks = await Promise.all(Array.from({ length: 8 }, async () => loadConfig(p).token));
    expect(new Set(toks).size).toBe(1);
    expect(JSON.parse(readFileSync(p, 'utf8')).token).toBe(toks[0]);
  });
});
