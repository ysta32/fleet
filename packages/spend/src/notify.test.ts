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
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('posts the Fleet payload and deduplicates within and across dispatches', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const deps = { fetch, platform: 'linux' as const };
    expect(await dispatchAlerts([alert, alert], DEFAULT_CONFIG, path, deps)).toEqual([alert]);
    expect(await dispatchAlerts([alert], DEFAULT_CONFIG, path, deps)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:4747/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'spend.budget', title: alert.title, body: alert.body, id: alert.id }),
    });
    expect(JSON.parse(readFileSync(path, 'utf8')).sentIds).toEqual([alert.id]);
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
    const deps = { fetch, platform: 'linux' as const };
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
    expect(await dispatchAlerts([alert], cfg, path, { fetch, platform: 'linux' })).toEqual([alert]);
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

  it('surfaces HTTP errors and retries failed deliveries', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValue(new Response('ok'));
    const deps = { fetch, platform: 'linux' as const };
    await expect(dispatchAlerts([alert], DEFAULT_CONFIG, path, deps)).rejects.toThrow(
      'Fleet notification failed (500)',
    );
    expect(await dispatchAlerts([alert], DEFAULT_CONFIG, path, deps)).toEqual([alert]);
  });

  it('records a successful channel even if another channel fails', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('network failure'));
    const exec = vi.fn().mockResolvedValue(undefined);
    const deps = { fetch, exec, platform: 'darwin' as const };
    await expect(dispatchAlerts([alert], DEFAULT_CONFIG, path, deps)).rejects.toThrow('network failure');
    expect(await dispatchAlerts([alert], DEFAULT_CONFIG, path, deps)).toEqual([]);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('fails before delivery on corrupt state', async () => {
    path = join(dir, 'state.json');
    writeFileSync(path, '{bad');
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(dispatchAlerts([alert], DEFAULT_CONFIG, path, { fetch })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
