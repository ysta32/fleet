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
const coder = (session: string, task: string): FleetSnapshot['agents'][number] => ({
  id: session,
  sessionId: session,
  projectId: 'p1',
  role: 'lead',
  model: 'opus',
  label: 'synthetic',
  status: 'waiting',
  currentTask: task,
  location: { kind: 'project', projectId: 'p1' },
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  startedAt: 0,
  lastActivity: 0,
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
    expect(nt.handle(ev('army.done'), snap())?.alert.kind).toBe('army.done');
    expect(nt.handle(ev('blocked'), snap())?.alert.kind).toBe('army.blocked');
    expect(nt.handle(ev('ci', { severity: 'error' }), snap())?.alert.kind).toBe('ci.failed');
    expect(nt.handle(ev('ci', { severity: 'success' }), snap())).toBeUndefined();
    expect(nt.handle(ev('session.waiting'), snap())?.alert.kind).toBe('session.waiting');
    expect(nt.handle(ev('failure', { data: { source: 'deploy' } }), snap())?.alert.kind).toBe(
      'deploy.failed',
    );
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

  it('notifies once per incident but stores every distinct alert, escalating waiting to blocked', () => {
    const s = snap();
    s.agents = [coder('sess', 't04')];
    const { n: nt, exec, fetch } = setup();
    const waiting = nt.handle(ev('session.waiting', { sessionId: 'sess', agentId: 'sess' }), s);
    expect(waiting).toMatchObject({
      notify: true,
      alert: { kind: 'session.waiting', taskId: 't04', sessionId: 'sess' },
    });
    // blocked is high priority: it escalates past the low-priority waiting notification once
    const blocked = nt.handle(ev('blocked', { taskId: '04' }), s);
    expect(blocked).toMatchObject({ notify: true, alert: { kind: 'army.blocked', taskId: '04' } });
    expect(exec).toHaveBeenCalledTimes(2);
    // a second blocked alert for the same task is a repeat: not stored, not notified
    expect(nt.handle(ev('blocked', { taskId: 't04' }), s)).toBeUndefined();
    // a different session waiting on the same blocked task is stored but not notified
    s.agents.push(coder('other', 't04'));
    expect(nt.handle(ev('session.waiting', { sessionId: 'other', agentId: 'other' }), s)).toMatchObject({
      notify: false,
      alert: { kind: 'session.waiting', sessionId: 'other' },
    });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    // a different task, another project, or a project-level event are separate incidents
    expect(nt.handle(ev('blocked', { taskId: '05' }), s)?.notify).toBe(true);
    expect(nt.handle(ev('blocked', { taskId: '04', projectId: 'p2' }), s)?.notify).toBe(true);
    expect(nt.handle(ev('army.done'), s)?.notify).toBe(true);
  });

  it('does not re-notify blocked after blocked, nor a low-priority wait after blocked', () => {
    const s = snap();
    s.agents = [coder('sess', 't04')];
    const { n: nt, exec } = setup();
    expect(nt.handle(ev('blocked', { taskId: '04' }), s)?.notify).toBe(true);
    expect(nt.handle(ev('session.waiting', { sessionId: 'sess', agentId: 'sess' }), s)?.notify).toBe(false);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('notifies again when a blocked task unblocks and blocks again', () => {
    const { n: nt } = setup();
    expect(nt.handle(ev('blocked', { taskId: 't04' }), snap())?.notify).toBe(true);
    nt.observe(ev('task.state', { taskId: '04', data: { state: 'blocked' } }));
    expect(nt.handle(ev('blocked', { taskId: '04' }), snap())).toBeUndefined();
    nt.observe(ev('task.state', { taskId: '04', projectId: 'p2', data: { state: 'running' } }));
    expect(nt.handle(ev('blocked', { taskId: '04' }), snap())).toBeUndefined();
    nt.observe(ev('task.state', { taskId: 't04', data: { state: 'running' } }));
    expect(nt.handle(ev('blocked', { taskId: '04' }), snap())?.notify).toBe(true);
  });

  it('closes a waiting incident when its session recovers or ends, so the next wait notifies', () => {
    const s = snap();
    s.agents = [coder('a', 't04'), coder('b', 't04')];
    const { n: nt, exec } = setup();
    expect(nt.handle(ev('session.waiting', { sessionId: 'a', agentId: 'a' }), s)?.notify).toBe(true);
    // a's own subagent working does not release a's wait
    nt.observe(ev('agent.tool', { sessionId: 'a', agentId: 'a:sub' }));
    expect(nt.handle(ev('session.waiting', { sessionId: 'b', agentId: 'b' }), s)?.notify).toBe(false);
    // both sessions recover: the incident is over
    nt.observe(ev('agent.tool', { sessionId: 'a', agentId: 'a' }));
    nt.observe(ev('session.end', { sessionId: 'b', agentId: 'b' }));
    // a different session waiting on the same task is a new transition
    s.agents.push(coder('c', 't04'));
    expect(nt.handle(ev('session.waiting', { sessionId: 'c', agentId: 'c' }), s)?.notify).toBe(true);
    nt.observe(ev('session.end', { sessionId: 'c' }));
    // the same session waiting again on a later turn is too
    expect(nt.handle(ev('session.waiting', { sessionId: 'a', agentId: 'a' }), s)?.notify).toBe(true);
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it('keeps a task incident open while the task is still blocked, even after the waiting session recovers', () => {
    const s = snap();
    s.agents = [coder('a', 't04'), coder('b', 't04')];
    const { n: nt } = setup();
    expect(nt.handle(ev('blocked', { taskId: '04' }), s)?.notify).toBe(true);
    expect(nt.handle(ev('session.waiting', { sessionId: 'a', agentId: 'a' }), s)?.notify).toBe(false);
    nt.observe(ev('agent.tool', { sessionId: 'a', agentId: 'a' }));
    expect(nt.handle(ev('session.waiting', { sessionId: 'b', agentId: 'b' }), s)?.notify).toBe(false);
    nt.observe(ev('task.state', { taskId: '04', data: { state: 'running' } }));
    expect(nt.handle(ev('session.waiting', { sessionId: 'b', agentId: 'b' }), s)?.notify).toBe(true);
  });

  it('rate limits notifications to 6 per minute but still stores the alerts', () => {
    let t = 0;
    const { n: nt, exec } = setup(cfg(), () => t);
    const got = Array.from({ length: 8 }, (_, i) => nt.handle(ev('blocked', { taskId: `t${i}` }), snap()));
    expect(got.every(Boolean)).toBe(true);
    expect(got.filter((r) => r?.notify)).toHaveLength(6);
    expect(exec).toHaveBeenCalledTimes(6);
    t = 61_000;
    expect(nt.handle(ev('blocked', { taskId: 'later' }), snap())?.notify).toBe(true);
  });

  it('notifies a rate-limited incident on its next event once the limit allows, without re-storing it', () => {
    let t = 0;
    const { n: nt, exec } = setup(cfg(), () => t);
    for (let i = 0; i < 6; i++)
      expect(nt.handle(ev('blocked', { taskId: `t${i}` }), snap())?.notify).toBe(true);
    const limited = nt.handle(ev('blocked', { taskId: 't9' }), snap());
    expect(limited).toMatchObject({ notify: false, isNew: true });
    // still limited: the repeat is neither stored again nor notified
    t = 30_000;
    expect(nt.handle(ev('blocked', { taskId: 't9' }), snap())).toBeUndefined();
    t = 61_000;
    const late = nt.handle(ev('blocked', { taskId: 't9' }), snap());
    expect(late).toMatchObject({ notify: true, isNew: false });
    expect(late!.alert.id).toBe(limited!.alert.id);
    expect(exec).toHaveBeenCalledTimes(7);
    // once notified it is an ordinary repeat again
    expect(nt.handle(ev('blocked', { taskId: 't9' }), snap())).toBeUndefined();
  });

  it('releases a waiting hold when the published session status leaves waiting (text-only reply)', () => {
    const s = snap();
    s.agents = [coder('a', 't04'), coder('b', 't04')];
    const { n: nt, exec } = setup();
    expect(nt.handle(ev('session.waiting', { sessionId: 'a', agentId: 'a' }), s)?.notify).toBe(true);
    nt.sessionStatus('p1', 'a', 'waiting');
    nt.sessionStatus('p2', 'a', 'active');
    expect(nt.handle(ev('session.waiting', { sessionId: 'b', agentId: 'b' }), s)?.notify).toBe(false);
    nt.sessionStatus('p1', 'a', 'active');
    nt.sessionStatus('p1', 'b', 'idle');
    s.agents.push(coder('c', 't04'));
    expect(nt.handle(ev('session.waiting', { sessionId: 'c', agentId: 'c' }), s)?.notify).toBe(true);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('treats a new waiting turn from the same session as a new transition', () => {
    const { n: nt, exec } = setup();
    expect(nt.handle(ev('session.waiting', { sessionId: 'a', agentId: 'a' }), snap())?.notify).toBe(true);
    expect(nt.handle(ev('session.waiting', { sessionId: 'a', agentId: 'a' }), snap())?.notify).toBe(true);
    expect(exec).toHaveBeenCalledTimes(2);
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
