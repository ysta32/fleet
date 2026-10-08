import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpendAlert } from '@fleet/shared';
import { DEFAULT_CONFIG } from './config.js';
import { dispatchAlerts } from './notify.js';

describe('spend notifications', () => {
  let dir: string;
  let path: string;
  const env = { FLEET_TOKEN: 'synthetic-fleet-token' };
  const alert: SpendAlert = {
    id: 'budget:2026-10:0.8',
    level: 'warn',
    title: 'Budget warning',
    body: '80% used',
    at: 1,
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spend-notify-'));
    path = join(dir, 'nested', 'state.json');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('posts the Fleet payload and deduplicates within and across dispatches', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const deps = { fetch, env, platform: 'linux' as const };
    expect(await dispatchAlerts([alert, alert], DEFAULT_CONFIG, path, deps)).toEqual([alert]);
    expect(await dispatchAlerts([alert], DEFAULT_CONFIG, path, deps)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:4747/api/alerts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.FLEET_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'spend.budget', title: alert.title, body: alert.body, id: alert.id }),
    });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ [alert.id]: ['fleet'] });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('passes escaped AppleScript as one argument without a shell', async () => {
    const exec = vi.fn().mockResolvedValue(undefined);
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.notify.fleet = false;
    const hostile = { ...alert, title: 'a"b\\c', body: 'line\nnext\r" & do shell script "touch /tmp/no"\\' };
    expect(await dispatchAlerts([hostile], cfg, path, { exec, platform: 'darwin' })).toEqual([hostile]);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('osascript', [
      '-e',
      'display notification "line\\nnext\\r\\" & do shell script \\"touch /tmp/no\\"\\\\" with title "Fleet Spend" subtitle "a\\"b\\\\c"',
    ]);
  });

  it('posts directly to ntfy with a Title header and body', async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.notify = { macos: false, fleet: false, ntfyUrl: 'https://ntfy.example/test' };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('ok'));
    expect(await dispatchAlerts([alert], cfg, path, { fetch })).toEqual([alert]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(cfg.notify.ntfyUrl, {
      method: 'POST',
      headers: { Title: alert.title },
      body: alert.body,
    });
  });

  it('ignores refused Fleet connections without recording a delivery', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
      }),
    );
    const deps = { fetch, env, platform: 'linux' as const };
    expect(await dispatchAlerts([alert], DEFAULT_CONFIG, path, deps)).toEqual([]);
    fetch.mockResolvedValue(new Response('ok'));
    expect(await dispatchAlerts([alert], DEFAULT_CONFIG, path, deps)).toEqual([alert]);
  });

  it('continues to ntfy when Fleet is unavailable', async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.notify.ntfyUrl = 'https://ntfy.example/test';
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))
      .mockResolvedValue(new Response('ok'));
    expect(await dispatchAlerts([alert], cfg, path, { fetch, env, platform: 'linux' })).toEqual([alert]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not mark alerts sent when every channel is disabled', async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.notify = { macos: false, fleet: false, ntfyUrl: '' };
    const fetch = vi.fn<typeof globalThis.fetch>();
    const exec = vi.fn();
    expect(await dispatchAlerts([alert], cfg, path, { fetch, exec })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it('retries HTTP failures on the next call and continues remaining alerts', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValue(new Response('ok'));
    const deps = { fetch, env, platform: 'linux' as const };
    const second = { ...alert, id: 'second' };
    expect(await dispatchAlerts([alert, alert, second], DEFAULT_CONFIG, path, deps)).toEqual([second]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await dispatchAlerts([alert], DEFAULT_CONFIG, path, deps)).toEqual([alert]);
    expect(await dispatchAlerts([alert, second], DEFAULT_CONFIG, path, deps)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('records a successful channel even if another channel fails', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('network failure'));
    const exec = vi.fn().mockResolvedValue(undefined);
    const deps = { fetch, exec, env, platform: 'darwin' as const };
    expect(await dispatchAlerts([alert], DEFAULT_CONFIG, path, deps)).toEqual([alert]);
    expect(await dispatchAlerts([alert], DEFAULT_CONFIG, path, deps)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await dispatchAlerts([alert], DEFAULT_CONFIG, path, deps)).toEqual([alert]);
    expect(await dispatchAlerts([alert], DEFAULT_CONFIG, path, deps)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ [alert.id]: ['macos', 'fleet'] });
  });

  it.each([
    '{bad',
    'null',
    '[]',
    'true',
    '42',
    '"bad"',
    '{"sentIds":["old"]}',
    '{"a":["bad"]}',
    '{"a":null}',
  ])('recovers and rewrites invalid state: %s', async (state) => {
    path = join(dir, 'state.json');
    writeFileSync(path, state);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    expect(await dispatchAlerts([alert], DEFAULT_CONFIG, path, { fetch, env, platform: 'linux' })).toEqual([
      alert,
    ]);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ [alert.id]: ['fleet'] });
  });

  it('resolves port and token from FLEET_PORT and FLEET_CONFIG', async () => {
    const configPath = join(dir, 'custom.json');
    writeFileSync(configPath, JSON.stringify({ token: 'custom-token', port: 5000 }));
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('ok'));
    await dispatchAlerts([alert], DEFAULT_CONFIG, path, {
      fetch,
      env: { FLEET_CONFIG: configPath },
      platform: 'linux',
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:5000/api/alerts');
    expect((fetch.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer custom-token',
    );
    const second = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('ok'));
    await dispatchAlerts([{ ...alert, id: 'other' }], DEFAULT_CONFIG, path, {
      fetch: second,
      env: { FLEET_CONFIG: configPath, FLEET_PORT: '4900' },
      platform: 'linux',
    });
    expect(second.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4900/api/alerts');
  });

  it('uses only the config token and truncates the Fleet payload', async () => {
    const fleetConfigPath = join(dir, 'config.json');
    writeFileSync(fleetConfigPath, JSON.stringify({ token: 'file-token', unrelated: 'private' }));
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('ok'));
    const long = { ...alert, title: 't'.repeat(100), body: 'b'.repeat(250) };
    expect(
      await dispatchAlerts([long], DEFAULT_CONFIG, path, {
        fetch,
        env: {},
        fleetConfigPath,
        platform: 'linux',
      }),
    ).toEqual([long]);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:4747/api/alerts', {
      method: 'POST',
      headers: { Authorization: 'Bearer file-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'spend.budget',
        title: 't'.repeat(80),
        body: 'b'.repeat(200),
        id: alert.id,
      }),
    });
    expect(readFileSync(path, 'utf8')).not.toContain('file-token');
  });

  it('prefers the injected env token over the Fleet config token', async () => {
    const readFile = vi.fn<typeof readFileSync>().mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('ok'));
    await dispatchAlerts([alert], DEFAULT_CONFIG, path, { fetch, readFile, env, platform: 'linux' });
    expect(readFile).toHaveBeenCalledWith(path, 'utf8');
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:4747/api/alerts');
    expect(fetch.mock.calls[0][1]?.headers).toEqual({
      Authorization: `Bearer ${env.FLEET_TOKEN}`,
      'Content-Type': 'application/json',
    });
  });

  it('defaults to process.env when env is not injected', async () => {
    vi.stubEnv('FLEET_TOKEN', 'process-token');
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('ok'));
    await dispatchAlerts([alert], DEFAULT_CONFIG, path, { fetch, platform: 'linux' });
    expect(fetch.mock.calls[0][1]?.headers).toEqual({
      Authorization: 'Bearer process-token',
      'Content-Type': 'application/json',
    });
  });

  it.each([undefined, '{bad', '{}', '{"token":42}', '{"token":""}'])(
    'silently skips Fleet without a token: %s',
    async (config) => {
      vi.stubEnv('FLEET_TOKEN', 'must-not-use-process-token');
      const fleetConfigPath = join(dir, 'config.json');
      if (config !== undefined) writeFileSync(fleetConfigPath, config);
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('ok'));
      const deps = { fetch, env: {}, fleetConfigPath, platform: 'linux' as const };
      expect(await dispatchAlerts([alert], DEFAULT_CONFIG, path, deps)).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
      const cfg = structuredClone(DEFAULT_CONFIG);
      cfg.notify.ntfyUrl = 'https://ntfy.example/test';
      expect(await dispatchAlerts([alert], cfg, path, deps)).toEqual([alert]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe(cfg.notify.ntfyUrl);
    },
  );

  it('does not expose token-bearing fetch or config errors in thrown errors or logs', async () => {
    const logs = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'debug'),
    ];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error(`Authorization: Bearer ${env.FLEET_TOKEN}`));
    await expect(
      dispatchAlerts([alert], DEFAULT_CONFIG, path, { fetch, env, platform: 'linux' }),
    ).resolves.toEqual([]);
    const fleetConfigPath = join(dir, 'config.json');
    writeFileSync(fleetConfigPath, `{"token":"${env.FLEET_TOKEN}" broken`);
    await expect(
      dispatchAlerts([alert], DEFAULT_CONFIG, path, { fetch, env: {}, fleetConfigPath, platform: 'linux' }),
    ).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it('retries failed macOS and ntfy channels without repeating successful Fleet pushes', async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.notify.ntfyUrl = 'https://ntfy.example/test';
    const exec = vi.fn().mockRejectedValueOnce(new Error('osascript failed')).mockResolvedValue(undefined);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('ok'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValue(new Response('ok'));
    const deps = { exec, fetch, env, platform: 'darwin' as const };
    expect(await dispatchAlerts([alert], cfg, path, deps)).toEqual([alert]);
    expect(await dispatchAlerts([alert], cfg, path, deps)).toEqual([alert]);
    expect(await dispatchAlerts([alert], cfg, path, deps)).toEqual([]);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:4747/api/alerts',
      cfg.notify.ntfyUrl,
      cfg.notify.ntfyUrl,
    ]);
  });

  it('safely persists alert ids that match object prototype keys', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('ok'));
    const unusual = { ...alert, id: '__proto__' };
    const deps = { fetch, env, platform: 'linux' as const };
    expect(await dispatchAlerts([unusual], DEFAULT_CONFIG, path, deps)).toEqual([unusual]);
    expect(await dispatchAlerts([unusual], DEFAULT_CONFIG, path, deps)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
