import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultConfig,
  digestDateKey,
  loadConfig,
  matchRepo,
  parseDuration,
  readSecrets,
  resolveWindow,
} from '../src/config.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'overnight-config-'));
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('OVERNIGHT_') || key === 'TZ') vi.stubEnv(key, undefined);
  }
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('configuration', () => {
  it('provides independent defaults without a hardcoded owner', () => {
    const config = defaultConfig();
    expect(config).toEqual({
      owner: '',
      include: [],
      exclude: [],
      includeForks: false,
      includeArchived: false,
      agents: [],
      timezone: 'UTC',
      defaultSince: '24h',
      staleDays: 3,
      vercelProjects: {},
      llm: { enabled: true, model: 'claude-sonnet-5-5', maxProjects: 25 },
      outDir: join(homedir(), '.overnight/archive'),
      stateDir: join(homedir(), '.overnight/state'),
      siteTitle: 'Overnight',
      deliver: {
        notion: { enabled: false },
        email: { enabled: false },
        ntfy: { enabled: false, server: 'https://ntfy.sh' },
      },
    });
    config.include.push('changed');
    expect(defaultConfig('someone').owner).toBe('someone');
    expect(defaultConfig().include).toEqual([]);
  });

  it('uses environment defaults', () => {
    vi.stubEnv('OVERNIGHT_OWNER', 'env-owner');
    vi.stubEnv('OVERNIGHT_OUT', '/tmp/archive');
    vi.stubEnv('OVERNIGHT_STATE', '/tmp/state');
    vi.stubEnv('TZ', 'America/New_York');
    expect(defaultConfig()).toMatchObject({
      owner: 'env-owner',
      outDir: '/tmp/archive',
      stateDir: '/tmp/state',
      timezone: 'America/New_York',
    });
  });

  it('tolerates an absent optional default config', async () => {
    expect((await loadConfig()).siteTitle).toBe('Overnight');
  });

  it('deep merges objects, replaces arrays, and preserves sibling delivery settings', async () => {
    const path = join(dir, 'config.json');
    await writeFile(
      path,
      JSON.stringify({
        owner: 'file-owner',
        include: ['app*'],
        llm: { enabled: false },
        deliver: { ntfy: { topic: 'updates' } },
        vercelProjects: { one: 'repo-one' },
      }),
    );
    const config = await loadConfig(path, { include: ['other'], vercelProjects: { two: 'repo-two' } });
    expect(config.owner).toBe('file-owner');
    expect(config.include).toEqual(['other']);
    expect(config.llm).toEqual({ enabled: false, model: 'claude-sonnet-5-5', maxProjects: 25 });
    expect(config.vercelProjects).toEqual({ one: 'repo-one', two: 'repo-two' });
    expect(config.deliver).toEqual({
      notion: { enabled: false },
      email: { enabled: false },
      ntfy: { enabled: false, topic: 'updates', server: 'https://ntfy.sh' },
    });
  });

  it('applies environment settings over the file and explicit overrides over environment', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ owner: 'file-owner', outDir: 'file-out' }));
    const env = {
      OVERNIGHT_OWNER: 'env-owner',
      OVERNIGHT_OUT: 'env-out',
      OVERNIGHT_STATE: 'env-state',
      OVERNIGHT_INCLUDE: ' app*, , LIB ',
      OVERNIGHT_EXCLUDE: 'app-secret',
      OVERNIGHT_NTFY_TOPIC: 'topic',
      OVERNIGHT_NOTION_DATABASE_ID: 'database',
      OVERNIGHT_NOTION_PAGE_ID: 'page',
      OVERNIGHT_EMAIL_TO: 'to@example.test',
      OVERNIGHT_EMAIL_FROM: 'from@example.test',
      OVERNIGHT_SITE_URL: 'https://example.test',
    };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    expect(await loadConfig(path)).toMatchObject({
      owner: 'env-owner',
      outDir: 'env-out',
      stateDir: 'env-state',
      include: ['app*', 'LIB'],
      exclude: ['app-secret'],
      siteUrl: 'https://example.test',
      deliver: {
        ntfy: { enabled: true, topic: 'topic' },
        notion: { enabled: true, databaseId: 'database', pageId: 'page' },
        email: { enabled: true, to: 'to@example.test', from: 'from@example.test' },
      },
    });
    expect(
      await loadConfig(path, {
        owner: 'override-owner',
        outDir: 'override-out',
        stateDir: 'override-state',
        include: ['override-*'],
        exclude: [],
        siteUrl: 'https://override.example.test',
        deliver: {
          ntfy: { enabled: false, server: 'https://ntfy.example.test' },
          notion: { enabled: false },
          email: { enabled: false },
        },
      }),
    ).toMatchObject({
      owner: 'override-owner',
      outDir: 'override-out',
      stateDir: 'override-state',
      include: ['override-*'],
      exclude: [],
      siteUrl: 'https://override.example.test',
      deliver: {
        ntfy: { enabled: false, topic: 'topic', server: 'https://ntfy.example.test' },
        notion: { enabled: false, databaseId: 'database', pageId: 'page' },
        email: { enabled: false, to: 'to@example.test', from: 'from@example.test' },
      },
    });
  });

  it('rejects missing explicit files, malformed JSON, and invalid config types', async () => {
    const path = join(dir, 'config.json');
    await expect(loadConfig(path)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const content of ['{', 'null', '[]', '{"llm":{"enabled":"false"}}']) {
      await writeFile(path, content);
      await expect(loadConfig(path)).rejects.toThrow();
    }
  });

  it('does not propagate unknown secrets or mutate prototypes while merging', async () => {
    const path = join(dir, 'config.json');
    await writeFile(
      path,
      '{"githubToken":"fake-only","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
    );
    expect(await loadConfig(path)).not.toHaveProperty('githubToken');
    expect({}).not.toHaveProperty('polluted');
  });
});

describe('secrets', () => {
  it('uses token precedence and treats empty values as absent', () => {
    expect(
      readSecrets({ OVERNIGHT_GITHUB_TOKEN: 'preferred', GH_TOKEN: 'gh', GITHUB_TOKEN: 'github' })
        .githubToken,
    ).toBe('preferred');
    expect(
      readSecrets({ OVERNIGHT_GITHUB_TOKEN: '', GH_TOKEN: 'gh', GITHUB_TOKEN: 'github' }).githubToken,
    ).toBe('gh');
    expect(readSecrets({ GH_TOKEN: '', GITHUB_TOKEN: 'github' }).githubToken).toBe('github');
    expect(readSecrets({ VERCEL_TOKEN: '', NTFY_TOKEN: '' })).toEqual({
      githubToken: undefined,
      vercelToken: undefined,
      anthropicApiKey: undefined,
      notionToken: undefined,
      resendApiKey: undefined,
      ntfyToken: undefined,
    });
    expect(
      readSecrets({
        VERCEL_TOKEN: 'v',
        ANTHROPIC_API_KEY: 'a',
        NOTION_TOKEN: 'n',
        RESEND_API_KEY: 'r',
        NTFY_TOKEN: 't',
      }),
    ).toMatchObject({
      vercelToken: 'v',
      anthropicApiKey: 'a',
      notionToken: 'n',
      resendApiKey: 'r',
      ntfyToken: 't',
    });
  });
});

describe('time windows', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  it.each([
    ['90m', 5_400_000],
    ['24h', 86_400_000],
    ['7d', 604_800_000],
    ['2w', 1_209_600_000],
  ])('parses %s', (value, expected) => {
    expect(parseDuration(value)).toBe(expected);
  });
  it.each(['', '-1h', '0h', '24', '1y', 'NaNh', '24hours'])('rejects %s', (value) => {
    expect(() => parseDuration(value)).toThrow();
  });
  it('uses explicit since, then state, then the configured default', () => {
    const config = defaultConfig();
    const state = { lastRunAt: '2026-10-06T20:00:00Z', repoStats: {} };
    expect(resolveWindow({}, { repoStats: {} }, config, now)).toEqual({
      since: '2026-10-06T12:00:00.000Z',
      until: now.toISOString(),
    });
    expect(resolveWindow({}, state, config, now).since).toBe('2026-10-06T20:00:00.000Z');
    expect(resolveWindow({ since: '90m' }, state, config, now).since).toBe('2026-10-07T10:30:00.000Z');
    expect(
      resolveWindow({ since: '2026-10-05', until: '2026-10-06T23:00:00-04:00' }, state, config, now),
    ).toEqual({ since: '2026-10-05T00:00:00.000Z', until: '2026-10-07T03:00:00.000Z' });
  });
  it('clamps explicit, saved, and default windows to fourteen days', () => {
    const config = { ...defaultConfig(), defaultSince: '4w' };
    for (const [opts, state] of [
      [{ since: '8w' }, { repoStats: {} }],
      [{}, { lastRunAt: '2020-01-01T00:00:00Z', repoStats: {} }],
      [{}, { repoStats: {} }],
    ] as const) {
      expect(resolveWindow(opts, state, config, now).since).toBe('2026-09-23T12:00:00.000Z');
    }
  });
  it('rejects invalid dates and reversed windows', () => {
    for (const opts of [
      { since: 'yesterday' },
      { until: 'bad' },
      { since: '2026-99-99' },
      { since: '2027-01-01' },
    ]) {
      expect(() => resolveWindow(opts, { repoStats: {} }, defaultConfig(), now)).toThrow();
    }
  });
  it.each(['2026-10-07T12:00:00Z', '2026-10-08T12:00:00Z'])(
    'falls back to defaultSince when saved run %s is at or after until',
    (lastRunAt) => {
      expect(
        resolveWindow({}, { lastRunAt, repoStats: {} }, { ...defaultConfig(), defaultSince: '48h' }, now),
      ).toEqual({ since: '2026-10-05T12:00:00.000Z', until: now.toISOString() });
    },
  );
  it('clamps historical windows relative to until', () => {
    const config = { ...defaultConfig(), defaultSince: '4w' };
    for (const [opts, state] of [
      [{ since: '2020-01-01' }, { repoStats: {} }],
      [{}, { lastRunAt: '2020-01-01', repoStats: {} }],
      [{}, { lastRunAt: now.toISOString(), repoStats: {} }],
      [{}, { repoStats: {} }],
    ] as const) {
      expect(resolveWindow({ ...opts, until: '2026-08-01' }, state, config, now)).toEqual({
        since: '2026-07-18T00:00:00.000Z',
        until: '2026-08-01T00:00:00.000Z',
      });
    }
  });
  it('uses the default duration before a historical until when saved state is unusable', () => {
    expect(
      resolveWindow(
        { until: '2026-08-01' },
        { lastRunAt: now.toISOString(), repoStats: {} },
        defaultConfig(),
        now,
      ),
    ).toEqual({ since: '2026-07-31T00:00:00.000Z', until: '2026-08-01T00:00:00.000Z' });
  });
  it.each(['2026-08-02', '24h'])('reports reversed explicit since %s as a usage error', (since) => {
    expect(() =>
      resolveWindow({ since, until: '2026-08-01' }, { repoStats: {} }, defaultConfig(), now),
    ).toThrow('Invalid --since: must not be after --until');
  });
  it('computes date keys across timezone and DST boundaries', () => {
    expect(digestDateKey('2026-10-07T02:00:00Z', 'America/New_York')).toBe('2026-10-06');
    expect(digestDateKey('2026-10-07T23:00:00Z', 'Asia/Tokyo')).toBe('2026-10-08');
    expect(digestDateKey('2026-03-08T07:00:00Z', 'America/New_York')).toBe('2026-03-08');
    expect(() => digestDateKey('bad', 'UTC')).toThrow();
    expect(() => digestDateKey(now.toISOString(), 'Not/AZone')).toThrow();
  });
});

describe('repository matching', () => {
  it('matches case-insensitively with anchored wildcards and exclusion priority', () => {
    const config = defaultConfig();
    expect(matchRepo('anything', config)).toBe(true);
    config.include = ['APP*', 'a.b', '*lib*'];
    config.exclude = ['app-secret*'];
    expect(matchRepo('app-web', config)).toBe(true);
    expect(matchRepo('my-library', config)).toBe(true);
    expect(matchRepo('APP-SECRET-key', config)).toBe(false);
    expect(matchRepo('my-app', config)).toBe(false);
    expect(matchRepo('a.b', config)).toBe(true);
    expect(matchRepo('axb', config)).toBe(false);
    config.include = ['repo[bot]', 'x+y'];
    expect(matchRepo('repo[bot]', config)).toBe(true);
    expect(matchRepo('x+y', config)).toBe(true);
  });
});
