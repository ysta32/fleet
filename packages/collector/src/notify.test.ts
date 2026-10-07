import { describe, expect, it, vi } from 'vitest';
import type { FleetConfig, FleetEvent, FleetSnapshot } from '@fleet/shared';
import { Notifier, appleScriptString } from './notify.js';

const ALL: FleetConfig['notify']['kinds'] = [
  'army.done',
  'army.blocked',
  'ci.failed',
  'session.waiting',
  'deploy.failed',
];
const cfg = (o: Partial<FleetConfig['notify']> = {}): FleetConfig['notify'] => ({
  macos: true,
  ntfyUrl: 'http://127.0.0.1:4599/topic',
  kinds: ALL,
  ...o,
});
const snap = (name = 'demo'): FleetSnapshot => ({
  version: 1,
  generatedAt: 0,
  projects: [{ id: 'p1', name, path: '/x/demo', lastActivity: 0 }],
  sessions: [],
  agents: [],
  prs: [],
  releases: [],
  deploys: [],
  alerts: [],
});
let n = 0;
const ev = (kind: FleetEvent['kind'], o: Partial<FleetEvent> = {}): FleetEvent => ({
  id: `${n}-${n++}`,
  ts: 1000,
  kind,
  projectId: 'p1',
  severity: 'info',
  label: 'x',
  ...o,
});
const setup = (c = cfg(), now = () => 1000) => {
  const exec = vi.fn(async () => '');
  const fetch = vi.fn(async () => ({}));
  return { exec, fetch, n: new Notifier(c, { exec, fetch, platform: 'darwin', now }) };
};

describe('Notifier', () => {
  it('maps events to alert kinds', () => {
    const { n: nt } = setup();
    expect(nt.handle(ev('army.done'), snap())?.kind).toBe('army.done');
    expect(nt.handle(ev('blocked'), snap())?.kind).toBe('army.blocked');
    expect(nt.handle(ev('ci', { severity: 'error' }), snap())?.kind).toBe('ci.failed');
    expect(nt.handle(ev('ci', { severity: 'success' }), snap())).toBeUndefined();
    expect(nt.handle(ev('session.waiting'), snap())?.kind).toBe('session.waiting');
    expect(nt.handle(ev('failure', { data: { source: 'deploy' } }), snap())?.kind).toBe('deploy.failed');
    expect(nt.handle(ev('failure', { data: { source: 'test' } }), snap())).toBeUndefined();
    expect(nt.handle(ev('agent.tool'), snap())).toBeUndefined();
  });

  it('skips kinds not enabled', () => {
    const { n: nt, exec, fetch } = setup(cfg({ kinds: ['army.done'] }));
    expect(nt.handle(ev('blocked'), snap())).toBeUndefined();
    expect(exec).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('dedupes same kind/project/ref within 10 minutes', () => {
    let t = 0;
    const { n: nt } = setup(cfg(), () => t);
    expect(nt.handle(ev('blocked', { taskId: '04' }), snap())).toBeDefined();
    t = 9 * 60_000;
    expect(nt.handle(ev('blocked', { taskId: '04' }), snap())).toBeUndefined();
    expect(nt.handle(ev('blocked', { taskId: '05' }), snap())).toBeDefined();
    t = 10 * 60_000 + 1;
    expect(nt.handle(ev('blocked', { taskId: '04' }), snap())).toBeDefined();
  });

  it('rate limits to 6 per minute', () => {
    let t = 0;
    const { n: nt } = setup(cfg(), () => t);
    const got = Array.from({ length: 8 }, (_, i) => nt.handle(ev('blocked', { taskId: `t${i}` }), snap()));
    expect(got.filter(Boolean)).toHaveLength(6);
    t = 61_000;
    expect(nt.handle(ev('blocked', { taskId: 'later' }), snap())).toBeDefined();
  });

  it('escapes AppleScript strings so quotes cannot break out', () => {
    expect(appleScriptString('a"b\\c\nd')).toBe('"a\\"b\\\\c d"');
    const { n: nt, exec } = setup();
    nt.handle(ev('army.done'), snap('evil" & (do shell script "x") & "'));
    const script = (exec.mock.calls[0] as unknown as [string, string[]])[1][1];
    expect(script).toContain('display notification "evil\\" & (do shell script \\"x\\") & \\""');
    expect(script.endsWith('sound name "Glass"')).toBe(true);
  });

  it('only uses osascript on darwin', () => {
    const exec = vi.fn(async () => '');
    const nt = new Notifier(cfg({ ntfyUrl: '' }), { exec, platform: 'linux', now: () => 1 });
    nt.handle(ev('army.done'), snap());
    expect(exec).not.toHaveBeenCalled();
  });

  it('posts to ntfy with headers and no paths', () => {
    const { n: nt, fetch } = setup();
    nt.handle(ev('ci', { severity: 'error', label: '/secret/path' }), snap());
    const [url, init] = fetch.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('http://127.0.0.1:4599/topic');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Title: 'CI failed', Tags: 'x', Priority: 'high' });
    expect(init.body).toBe('demo');
    expect(JSON.stringify(init)).not.toContain('/secret');
  });

  it('logs delivery errors without throwing', async () => {
    const log = vi.fn();
    const nt = new Notifier(cfg(), {
      exec: () => {
        throw new Error('boom');
      },
      fetch: async () => {
        throw new Error('net');
      },
      platform: 'darwin',
      now: () => 1,
      log,
    });
    expect(() => nt.handle(ev('army.done'), snap())).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('logs non-ok ntfy responses with status only', async () => {
    const log = vi.fn();
    const nt = new Notifier(cfg({ macos: false }), {
      fetch: async () => ({ ok: false, status: 429 }),
      platform: 'linux',
      now: () => 1,
      log,
    });
    nt.handle(ev('army.done'), snap());
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain('429');
    expect(String(log.mock.calls[0][0])).not.toContain('127.0.0.1');
  });
});
