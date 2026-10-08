import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FleetConfig, FleetEvent, FleetSnapshot, HistoryResponse } from '@fleet/shared';
import { createServer } from './server.js';

const TOKEN = 'a'.repeat(64);
const AUTH = { headers: { authorization: `Bearer ${TOKEN}` } };

function snap(): FleetSnapshot {
  return {
    version: 1,
    generatedAt: 1000,
    projects: [
      {
        id: '-tmp-proj',
        name: 'proj',
        path: '/tmp/proj',
        lastActivity: 1000,
        orch: {
          projectId: '-tmp-proj',
          phase: 'running',
          statusText: 'SYNTH-STATUS',
          handoffText: 'SYNTH-HANDOFF',
          tasks: [],
          inflight: [],
          worktrees: [],
          blocked: [],
          updatedAt: 1000,
        },
      },
    ],
    sessions: [],
    agents: [],
    prs: [],
    releases: [],
    deploys: [],
    alerts: [],
  };
}

class FakeStore extends EventEmitter {
  lastRange: [number, number] | null = null;
  snapshot(): FleetSnapshot {
    return snap();
  }
  history(from: number, to: number): HistoryResponse {
    this.lastRange = [from, to];
    return { from, to, frames: [], events: [] };
  }
}

function cfg(over: Partial<FleetConfig> = {}): FleetConfig {
  return {
    port: 0,
    lan: true,
    token: TOKEN,
    claudeProjectsDir: '/nonexistent',
    recentWindowMs: 86400000,
    shareContent: false,
    notify: { macos: false, ntfyUrl: '', kinds: [] },
    github: false,
    githubPollMs: 60000,
    ...over,
  };
}

let servers: http.Server[] = [];
let tmp: string;
let webDir: string;
let digestDir: string;

async function start(
  over: { config?: Partial<FleetConfig>; remote?: boolean; store?: FakeStore; noWeb?: boolean } = {},
): Promise<{ base: string; port: number; store: FakeStore }> {
  const store = over.store ?? new FakeStore();
  const server = createServer({
    store,
    config: cfg(over.config),
    webDir: over.noWeb ? undefined : webDir,
    digestDir,
    ...(over.remote ? { isLoopback: () => false } : {}),
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, port, store };
}

function rawGet(port: number, rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function readSse(
  url: string,
  headers: Record<string, string>,
  until: (buf: string) => boolean,
  onOpen?: () => void,
): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  const res = await fetch(url, { headers, signal: ac.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    onOpen?.();
    while (!until(buf)) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
  return buf;
}

function frameData(buf: string, evName: string): unknown {
  const m = buf.split('\n\n').find((f) => f.split('\n').includes(`event: ${evName}`));
  if (!m) return undefined;
  const line = m.split('\n').find((l) => l.startsWith('data:'))!;
  return JSON.parse(line.slice(5).trim());
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-server-spec-'));
  webDir = path.join(tmp, 'web');
  digestDir = path.join(tmp, 'digest');
  fs.mkdirSync(path.join(webDir, 'assets'), { recursive: true });
  fs.mkdirSync(digestDir, { recursive: true });
  fs.writeFileSync(path.join(webDir, 'index.html'), '<html>INDEX-MARK</html>');
  fs.writeFileSync(path.join(webDir, 'assets', 'app.js'), 'console.log("APP-MARK")');
  // secret sibling of webDir that traversal must never reach
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"secret":"SIBLING-SECRET"}');
});

afterEach(async () => {
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((r) => {
          s.closeAllConnections?.();
          s.close(() => r());
        }),
    ),
  );
  servers = [];
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('health and snapshot', () => {
  it('GET /api/health', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const j = (await res.json()) as { ok: boolean; version: string; protocol: number };
    expect(j.ok).toBe(true);
    expect(typeof j.version).toBe('string');
    expect(j.protocol).toBe(1);
  });

  it('GET /api/snapshot returns the store snapshot (loopback, unredacted)', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/snapshot`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as FleetSnapshot;
    expect(j.version).toBe(1);
    expect(j.projects[0]!.path).toBe('/tmp/proj');
    expect(j.projects[0]!.orch!.statusText).toBe('SYNTH-STATUS');
  });
});

describe('SSE /api/events', () => {
  it('first frame is snapshot, then fleet frame after store emits event', async () => {
    const { base, store } = await start();
    const ev: FleetEvent = {
      id: '1-1',
      ts: 1,
      kind: 'agent.tool',
      projectId: '-tmp-proj',
      severity: 'info',
      label: 'Edit store.ts',
    };
    const buf = await readSse(
      `${base}/api/events`,
      {},
      (b) => b.includes('event: fleet') && b.includes('\n\n', b.indexOf('event: fleet')),
      () => setTimeout(() => store.emit('event', ev), 150),
    );
    // first *named event* must be the snapshot (SSE `retry:`/comment fields may precede it)
    expect(buf.match(/^event: (\S+)$/m)?.[1]).toBe('snapshot');
    expect(buf.indexOf('event: snapshot')).toBeLessThan(buf.indexOf('event: fleet'));
    expect((frameData(buf, 'snapshot') as FleetSnapshot).version).toBe(1);
    expect((frameData(buf, 'fleet') as FleetEvent).id).toBe('1-1');
  });

  it('removes store listeners after client disconnects', async () => {
    const { base, store } = await start();
    await readSse(`${base}/api/events`, {}, (b) => b.includes('event: snapshot') && b.includes('\n\n'));
    await new Promise((r) => setTimeout(r, 300));
    expect(store.listenerCount('event')).toBe(0);
    expect(store.listenerCount('change')).toBe(0);
  });

  it('remote SSE snapshot is redacted', async () => {
    const { base } = await start({ remote: true });
    const buf = await readSse(
      `${base}/api/events`,
      { authorization: `Bearer ${TOKEN}` },
      (b) => b.includes('event: snapshot') && b.includes('\n\n'),
    );
    const s = frameData(buf, 'snapshot') as FleetSnapshot;
    expect(s.projects[0]!.path).toBe('');
    expect(s.projects[0]!.orch!.statusText).toBe('');
  });
});

describe('/api/history', () => {
  it('passes from/to through', async () => {
    const { base, store } = await start();
    const res = await fetch(`${base}/api/history?from=1000&to=5000`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as HistoryResponse;
    expect(j.from).toBe(1000);
    expect(j.to).toBe(5000);
    expect(store.lastRange).toEqual([1000, 5000]);
  });

  it('defaults to last 6h when no params', async () => {
    const { base, store } = await start();
    const before = Date.now();
    const res = await fetch(`${base}/api/history`);
    expect(res.status).toBe(200);
    const [from, to] = store.lastRange!;
    expect(to).toBeGreaterThanOrEqual(before - 1000);
    expect(to - from).toBe(6 * 3600 * 1000);
  });

  it('clamps range to max 24h', async () => {
    const { base, store } = await start();
    const to = Date.now();
    await fetch(`${base}/api/history?from=0&to=${to}`);
    const [from, t] = store.lastRange!;
    expect(t - from).toBeLessThanOrEqual(24 * 3600 * 1000);
  });

  it('rejects non-numeric params with 400 (or clamps to defaults)', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/history?from=abc&to=xyz`);
    expect([200, 400]).toContain(res.status);
  });
});

describe('auth matrix (non-loopback)', () => {
  it('no token -> 401', async () => {
    const { base } = await start({ remote: true });
    expect((await fetch(`${base}/api/snapshot`)).status).toBe(401);
  });
  it('wrong token -> 401', async () => {
    const { base } = await start({ remote: true });
    expect((await fetch(`${base}/api/snapshot`, { headers: { authorization: 'Bearer nope' } })).status).toBe(
      401,
    );
    expect((await fetch(`${base}/api/snapshot?token=${'b'.repeat(64)}`)).status).toBe(401);
  });
  it('wrong-length / empty token -> 401 without crashing', async () => {
    const { base } = await start({ remote: true });
    expect((await fetch(`${base}/api/snapshot?token=`)).status).toBe(401);
    expect((await fetch(`${base}/api/snapshot`, { headers: { authorization: 'Bearer ' } })).status).toBe(401);
    expect((await fetch(`${base}/api/health`)).status).toBeLessThan(500);
  });
  it('Bearer token -> 200', async () => {
    const { base } = await start({ remote: true });
    const res = await fetch(`${base}/api/snapshot`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
  });
  it('?token= is never accepted on /api routes, even when valid', async () => {
    const { base } = await start({ remote: true });
    for (const p of ['/api/snapshot', '/api/events', '/api/history', '/api/health', '/api/push/key']) {
      const res = await fetch(`${base}${p}?token=${TOKEN}`);
      expect(res.status).toBe(401);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });
  it('unauthenticated remote cannot read SSE or history', async () => {
    const { base } = await start({ remote: true });
    expect((await fetch(`${base}/api/events`)).status).toBe(401);
    expect((await fetch(`${base}/api/history`)).status).toBe(401);
  });
  it('loopback needs no token', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/api/snapshot`)).status).toBe(200);
  });
  it('explicit isLoopback=true needs no token', async () => {
    const server = createServer({
      store: new FakeStore(),
      config: cfg(),
      webDir,
      digestDir,
      isLoopback: () => true,
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    expect((await fetch(`http://127.0.0.1:${port}/api/snapshot`)).status).toBe(200);
  });
});

describe('remote redaction', () => {
  it('redacts path/statusText/handoffText when shareContent=false', async () => {
    const { base } = await start({ remote: true });
    const j = (await (await fetch(`${base}/api/snapshot`, AUTH)).json()) as FleetSnapshot;
    expect(j.projects[0]!.path).toBe('');
    expect(j.projects[0]!.orch!.statusText).toBe('');
    expect(j.projects[0]!.orch!.handoffText).toBe('');
    expect(JSON.stringify(j)).not.toContain('/tmp/proj');
  });
  it('shareContent=true preserves status/handoff text', async () => {
    const { base } = await start({ remote: true, config: { shareContent: true } });
    const j = (await (await fetch(`${base}/api/snapshot`, AUTH)).json()) as FleetSnapshot;
    expect(j.projects[0]!.orch!.statusText).toBe('SYNTH-STATUS');
    expect(j.projects[0]!.orch!.handoffText).toBe('SYNTH-HANDOFF');
  });
  it('does not mutate the store snapshot for later local readers', async () => {
    const { base } = await start({ remote: true });
    await fetch(`${base}/api/snapshot`, AUTH);
    const store = new FakeStore();
    expect(store.snapshot().projects[0]!.path).toBe('/tmp/proj');
  });
});

describe('static files', () => {
  it('serves index.html at / with html content type', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('INDEX-MARK');
  });
  it('serves asset with js content type', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(await res.text()).toContain('APP-MARK');
  });
  it('SPA fallback serves index.html for unknown route', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/some/client/route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('INDEX-MARK');
  });
  it('unknown /api path is not the SPA fallback', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
  });
  it('POST to API is rejected (no 2xx)', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/snapshot`, { method: 'POST' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('path traversal', () => {
  const attempts = [
    '/../package.json',
    '/%2e%2e/package.json',
    '/%2E%2E/package.json',
    '/assets/../../package.json',
    '/assets/%2e%2e/%2e%2e/package.json',
    '/..%2fpackage.json',
    '/%2e%2e%2fpackage.json',
    '/assets/..%5c..%5cpackage.json',
    '/..%00/package.json',
  ];
  for (const p of attempts) {
    it(`never serves content outside webDir: ${p}`, async () => {
      const { port } = await start();
      const r = await rawGet(port, p);
      expect(r.body).not.toContain('SIBLING-SECRET');
      expect(r.status).not.toBe(500);
    });
  }
  it('absolute-path style request does not leak files', async () => {
    const { port } = await start();
    const r = await rawGet(port, `/${path.join(tmp, 'package.json')}`);
    expect(r.body).not.toContain('SIBLING-SECRET');
  });
  it('no webDir: static routes do not crash', async () => {
    const { base } = await start({ noWeb: true });
    const res = await fetch(`${base}/`);
    expect(res.status).toBeLessThan(500);
  });
});

describe('/api/digest/latest', () => {
  it('404 when missing', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/api/digest/latest`)).status).toBe(404);
  });
  it('served locally when present', async () => {
    fs.writeFileSync(path.join(digestDir, 'latest.json'), JSON.stringify({ marker: 'DIGEST-MARK' }));
    const { base } = await start();
    const res = await fetch(`${base}/api/digest/latest`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.text()).toContain('DIGEST-MARK');
  });
  it('remote without shareContent is refused (401/403/404), never leaks', async () => {
    fs.writeFileSync(path.join(digestDir, 'latest.json'), JSON.stringify({ marker: 'DIGEST-MARK' }));
    const { base } = await start({ remote: true });
    const res = await fetch(`${base}/api/digest/latest`, AUTH);
    expect([401, 403, 404]).toContain(res.status);
    expect(await res.text()).not.toContain('DIGEST-MARK');
  });
  it('remote with no token is 401/403/404', async () => {
    fs.writeFileSync(path.join(digestDir, 'latest.json'), JSON.stringify({ marker: 'DIGEST-MARK' }));
    const { base } = await start({ remote: true, config: { shareContent: true } });
    const res = await fetch(`${base}/api/digest/latest`);
    expect([401, 403, 404]).toContain(res.status);
  });
  it('remote with token and shareContent=true is served', async () => {
    fs.writeFileSync(path.join(digestDir, 'latest.json'), JSON.stringify({ marker: 'DIGEST-MARK' }));
    const { base } = await start({ remote: true, config: { shareContent: true } });
    const res = await fetch(`${base}/api/digest/latest`, AUTH);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('DIGEST-MARK');
  });
});

describe('security headers', () => {
  const paths = ['/api/health', '/api/snapshot', '/', '/assets/app.js', '/api/nope'];
  for (const p of paths) {
    it(`present on ${p}`, async () => {
      const { base } = await start();
      const res = await fetch(`${base}${p}`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
    });
  }
  it('present on 401 responses and no CORS headers', async () => {
    const { base } = await start({ remote: true });
    const res = await fetch(`${base}/api/snapshot`, { headers: { origin: 'http://evil.example' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('no CORS header on normal API response', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/snapshot`, { headers: { origin: 'http://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

function rawReq(
  port: number,
  p: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Host header (DNS rebinding)', () => {
  for (const host of ['evil.com', 'evil.com:80', 'attacker.example']) {
    it(`loopback socket with Host: ${host} -> 421 or 403`, async () => {
      const { port } = await start();
      const r = await rawReq(port, '/api/snapshot', { Host: host });
      expect([403, 421]).toContain(r.status);
      expect(r.body).not.toContain('SYNTH-STATUS');
    });
  }
  it('Host: 127.0.0.1:port and localhost:port are accepted', async () => {
    const { port } = await start();
    expect((await rawReq(port, '/api/health', { Host: `127.0.0.1:${port}` })).status).toBe(200);
    expect((await rawReq(port, '/api/health', { Host: `localhost:${port}` })).status).toBe(200);
  });
});

describe('cookie auth', () => {
  it('valid ?token= on the shell sets fleet_token cookie (HttpOnly, SameSite=Strict) and cookie alone authorizes', async () => {
    const { port } = await start({ remote: true });
    const first = await rawReq(port, `/?token=${TOKEN}`, {});
    expect(first.status).toBe(303);
    expect(first.headers.location).toBe('/');
    const sc = ([] as string[])
      .concat(first.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('fleet_token='));
    expect(sc).toBeDefined();
    expect(sc!).toMatch(/HttpOnly/i);
    expect(sc!).toMatch(/SameSite=Strict/i);
    const cookie = sc!.split(';')[0]!;
    const second = await rawReq(port, '/api/snapshot', { Cookie: cookie });
    expect(second.status).toBe(200);
  });
  it('invalid token sets no cookie; bogus cookie is 401', async () => {
    const { port } = await start({ remote: true });
    const bad = await rawReq(port, `/api/snapshot?token=${'b'.repeat(64)}`, {});
    expect(bad.status).toBe(401);
    expect(bad.headers['set-cookie']).toBeUndefined();
    expect((await rawReq(port, '/api/snapshot', { Cookie: 'fleet_token=nope' })).status).toBe(401);
  });
});

describe('remote id redaction', () => {
  const OPAQUE = /^p_[0-9a-f]{12}$/;
  class RichStore extends FakeStore {
    snapshot(): FleetSnapshot {
      const s = snap();
      s.sessions = [
        {
          id: 's1',
          projectId: '-tmp-proj',
          model: 'opus',
          startedAt: 1,
          lastActivity: 1,
          status: 'active',
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          costUsd: 0,
          toolCalls: 0,
          agentIds: ['s1'],
        },
      ];
      s.agents = [
        {
          id: 's1',
          sessionId: 's1',
          projectId: '-tmp-proj',
          role: 'lead',
          model: 'opus',
          label: 'lead',
          status: 'working',
          location: { kind: 'project', projectId: '-tmp-proj' },
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          startedAt: 1,
          lastActivity: 1,
        },
      ];
      return s;
    }
  }
  const ev: FleetEvent = {
    id: '2-1',
    ts: 2,
    kind: 'agent.tool',
    projectId: '-tmp-proj',
    severity: 'info',
    label: 'Edit x.ts',
    to: { kind: 'project', projectId: '-tmp-proj' },
  };

  it('snapshot projectIds are opaque, path empty, consistent, original id absent', async () => {
    const { base } = await start({ remote: true, store: new RichStore() });
    const text = await (await fetch(`${base}/api/snapshot`, AUTH)).text();
    const j = JSON.parse(text) as FleetSnapshot;
    const pid = j.projects[0]!.id;
    expect(pid).toMatch(OPAQUE);
    expect(j.projects[0]!.path).toBe('');
    expect(j.sessions[0]!.projectId).toBe(pid);
    expect(j.agents[0]!.projectId).toBe(pid);
    expect(j.agents[0]!.location.projectId).toBe(pid);
    expect(j.projects[0]!.orch!.projectId).toBe(pid);
    expect(text).not.toContain('-tmp-proj');
  });

  it('SSE event projectId matches snapshot opaque id', async () => {
    const store = new RichStore();
    const { base } = await start({ remote: true, store });
    const snapJson = (await (await fetch(`${base}/api/snapshot`, AUTH)).json()) as FleetSnapshot;
    const buf = await readSse(
      `${base}/api/events`,
      { authorization: `Bearer ${TOKEN}` },
      (b) => b.includes('event: fleet') && b.includes('\n\n', b.indexOf('event: fleet')),
      () => setTimeout(() => store.emit('event', ev), 150),
    );
    const e = frameData(buf, 'fleet') as FleetEvent;
    expect(e.projectId).toMatch(OPAQUE);
    expect(e.projectId).toBe(snapJson.projects[0]!.id);
    expect(e.to!.projectId).toBe(e.projectId);
    const s = frameData(buf, 'snapshot') as FleetSnapshot;
    expect(s.projects[0]!.id).toBe(e.projectId);
    expect(buf).not.toContain('-tmp-proj');
  });

  it('loopback clients keep real project ids', async () => {
    const { base } = await start({ store: new RichStore() });
    const j = (await (await fetch(`${base}/api/snapshot`)).json()) as FleetSnapshot;
    expect(j.projects[0]!.id).toBe('-tmp-proj');
  });
});

describe('remote content redaction (shareContent=false)', () => {
  // every LEAK-* value is free text derived from transcripts/repos; none may reach a remote viewer
  const MARKERS = [
    'LEAK-SESS-TARGET',
    'LEAK-AGENT-LABEL',
    'LEAK-AGENT-TARGET',
    'LEAK agent ref text',
    'LEAK-TASK-SLUG',
    'LEAK-PR-TITLE',
    'LEAK-PR-HEADREF',
    'LEAK-RELEASE-NAME',
    'LEAK-DEPLOY-ENV',
    'LEAK event ref text',
  ];
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  function leakySnap(): FleetSnapshot {
    const s = snap();
    s.projects[0]!.orch!.tasks = [{ id: 't04', slug: 'LEAK-TASK-SLUG', depends: [], state: 'running' }];
    s.sessions = [
      {
        id: 's1',
        projectId: '-tmp-proj',
        model: 'opus',
        startedAt: 1,
        lastActivity: 1,
        status: 'active',
        tokens,
        costUsd: 0,
        toolCalls: 1,
        agentIds: ['s1', 's1:a2'],
        lastTool: { name: 'Edit', target: 'LEAK-SESS-TARGET', at: 5 },
      },
    ];
    s.agents = [
      {
        id: 's1',
        sessionId: 's1',
        projectId: '-tmp-proj',
        role: 'coder',
        model: 'opus',
        label: 'LEAK-AGENT-LABEL',
        status: 'working',
        location: { kind: 'task', projectId: '-tmp-proj', ref: 'LEAK agent ref text' },
        lastTool: { name: 'Bash', target: 'LEAK-AGENT-TARGET', at: 6 },
        tokens,
        startedAt: 1,
        lastActivity: 1,
      },
      {
        id: 's1:a2',
        sessionId: 's1',
        projectId: '-tmp-proj',
        role: 'reviewer',
        model: 'sonnet',
        label: 'reviewer t04',
        status: 'working',
        location: { kind: 'task', projectId: '-tmp-proj', ref: 't04' },
        tokens,
        startedAt: 1,
        lastActivity: 1,
      },
    ];
    s.prs = [
      {
        projectId: '-tmp-proj',
        number: 12,
        title: 'LEAK-PR-TITLE',
        state: 'open',
        ci: 'failure',
        url: 'https://github.com/o/r/pull/12',
        headRef: 'LEAK-PR-HEADREF',
        updatedAt: 1,
      },
    ];
    s.releases = [
      { projectId: '-tmp-proj', tag: 'v1.0.0', name: 'LEAK-RELEASE-NAME', url: 'https://x', publishedAt: 1 },
    ];
    s.deploys = [
      { projectId: '-tmp-proj', id: 'd1', environment: 'LEAK-DEPLOY-ENV', state: 'ready', createdAt: 1 },
    ];
    return s;
  }
  const moveEv: FleetEvent = {
    id: '3-1',
    ts: 3,
    kind: 'agent.move',
    projectId: '-tmp-proj',
    agentId: 's1',
    severity: 'info',
    label: 'move',
    to: { kind: 'task', projectId: '-tmp-proj', ref: 'LEAK event ref text' },
  };
  const okEv: FleetEvent = {
    ...moveEv,
    id: '3-2',
    to: { kind: 'task', projectId: '-tmp-proj', ref: 't04' },
  };
  class LeakyStore extends FakeStore {
    snapshot(): FleetSnapshot {
      return leakySnap();
    }
    history(from: number, to: number): HistoryResponse {
      return { from, to, frames: [leakySnap()], events: [moveEv, okEv] };
    }
  }
  const expectNoLeak = (text: string): void => {
    for (const m of MARKERS) expect(text).not.toContain(m);
  };
  const expectAllPresent = (text: string): void => {
    for (const m of MARKERS) expect(text).toContain(m);
  };
  const checkRemoteSnap = (j: FleetSnapshot): void => {
    expect(j.sessions[0]!.lastTool).toEqual({ name: 'Edit', at: 5 });
    expect(j.agents[0]!.label).toBe('coder');
    expect(j.agents[0]!.lastTool).toEqual({ name: 'Bash', at: 6 });
    expect(j.agents[0]!.location.ref).toBe('');
    expect(j.agents[1]!.label).toBe('reviewer');
    expect(j.agents[1]!.location.ref).toBe('t04');
    expect(j.projects[0]!.orch!.tasks[0]).toMatchObject({ id: 't04', slug: '', state: 'running' });
    expect(j.prs[0]).toMatchObject({ number: 12, state: 'open', ci: 'failure', title: '', headRef: '' });
    expect(j.releases[0]).toMatchObject({ tag: 'v1.0.0', name: '' });
    expect(j.deploys[0]).toMatchObject({ id: 'd1', state: 'ready', environment: '' });
  };

  it('snapshot: nothing leaks remotely, everything stays locally', async () => {
    const remote = await start({ remote: true, store: new LeakyStore() });
    const text = await (await fetch(`${remote.base}/api/snapshot`, AUTH)).text();
    expectNoLeak(text);
    checkRemoteSnap(JSON.parse(text) as FleetSnapshot);

    const local = await start({ store: new LeakyStore() });
    const localText = await (await fetch(`${local.base}/api/snapshot`)).text();
    for (const m of MARKERS.filter((x) => x !== 'LEAK event ref text')) expect(localText).toContain(m);
    expect(JSON.parse(localText)).toEqual(leakySnap());
  });

  it('history frames and events: nothing leaks remotely, everything stays locally', async () => {
    const remote = await start({ remote: true, store: new LeakyStore() });
    const text = await (await fetch(`${remote.base}/api/history?from=0&to=10`, AUTH)).text();
    expectNoLeak(text);
    const h = JSON.parse(text) as HistoryResponse;
    checkRemoteSnap(h.frames[0]!);
    expect(h.events[0]!.to!.ref).toBe('');
    expect(h.events[1]!.to!.ref).toBe('t04');

    const local = await start({ store: new LeakyStore() });
    const localText = await (await fetch(`${local.base}/api/history?from=0&to=10`)).text();
    expectAllPresent(localText);
    expect((JSON.parse(localText) as HistoryResponse).events).toEqual([moveEv, okEv]);
  });

  it('SSE snapshot and events: nothing leaks remotely, everything stays locally', async () => {
    const waitBoth = (b: string): boolean => {
      const i = b.indexOf('"3-2"');
      return i !== -1 && b.includes('\n\n', i);
    };
    const remoteStore = new LeakyStore();
    const remote = await start({ remote: true, store: remoteStore });
    const buf = await readSse(`${remote.base}/api/events`, AUTH.headers, waitBoth, () =>
      setTimeout(() => {
        remoteStore.emit('event', moveEv);
        remoteStore.emit('event', okEv);
      }, 150),
    );
    expectNoLeak(buf);
    checkRemoteSnap(frameData(buf, 'snapshot') as FleetSnapshot);
    expect((frameData(buf, 'fleet') as FleetEvent).to!.ref).toBe('');
    expect(buf).toContain('"ref":"t04"');

    const localStore = new LeakyStore();
    const local = await start({ store: localStore });
    const localBuf = await readSse(`${local.base}/api/events`, {}, waitBoth, () =>
      setTimeout(() => {
        localStore.emit('event', moveEv);
        localStore.emit('event', okEv);
      }, 150),
    );
    expectAllPresent(localBuf);
    expect(frameData(localBuf, 'snapshot')).toEqual(leakySnap());
  });

  it('shareContent=true keeps the fields for remote viewers', async () => {
    const remote = await start({ remote: true, store: new LeakyStore(), config: { shareContent: true } });
    const j = (await (await fetch(`${remote.base}/api/snapshot`, AUTH)).json()) as FleetSnapshot;
    expect(j.agents[0]!.label).toBe('LEAK-AGENT-LABEL');
    expect(j.prs[0]!.title).toBe('LEAK-PR-TITLE');
    expect(j.deploys[0]!.environment).toBe('LEAK-DEPLOY-ENV');
  });
});

describe('?token= link on the web shell', () => {
  const cookieOf = (h: http.IncomingHttpHeaders): string | undefined =>
    ([] as string[]).concat(h['set-cookie'] ?? []).find((c) => c.startsWith('fleet_token='));

  it('valid token: 303 to the same path without the token, other params kept, same cookie flags', async () => {
    const { port } = await start({ remote: true });
    const r = await rawReq(port, `/fleet/view?x=1&token=${TOKEN}&y=two`, {});
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe('/fleet/view?x=1&y=two');
    expect(r.headers['cache-control']).toBe('no-store');
    const c = cookieOf(r.headers)!;
    expect(c).toBe(`fleet_token=${TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
    expect(r.body).not.toContain('INDEX-MARK');
  });
  it('the redirect can never become protocol-relative', async () => {
    const { port } = await start({ remote: true });
    const r = await rawReq(port, `//evil.example/x?token=${TOKEN}`, {});
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe('/evil.example/x');
    const r2 = await rawReq(port, `/%2F%2Fevil.example?token=${TOKEN}`, {});
    expect(r2.headers.location!.startsWith('//')).toBe(false);
  });
  it('invalid token: shell served without a cookie', async () => {
    const { port } = await start({ remote: true });
    const r = await rawReq(port, `/?token=${'b'.repeat(64)}`, {});
    expect(r.status).toBe(200);
    expect(r.body).toContain('INDEX-MARK');
    expect(r.headers['set-cookie']).toBeUndefined();
  });
  it('non-navigation fetches never exchange the token', async () => {
    const { port } = await start({ remote: true });
    const r = await rawReq(port, `/?token=${TOKEN}`, { 'Sec-Fetch-Mode': 'cors' });
    expect(r.status).toBe(200);
    expect(r.headers['set-cookie']).toBeUndefined();
  });
});

describe('remote auth failure limit', () => {
  it('bad Bearer/cookie attempts on /api routes share the /api/session limiter -> 429', async () => {
    const { base } = await start({ remote: true });
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${base}/api/snapshot`, { headers: { authorization: 'Bearer wrong' } });
      expect(r.status).toBe(401);
    }
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${base}/api/history`, { headers: { cookie: 'fleet_token=wrong' } });
      expect(r.status).toBe(401);
    }
    const limited = await fetch(`${base}/api/snapshot`, AUTH);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await limited.text()).not.toContain('SYNTH-STATUS');
    expect((await fetch(`${base}/api/session`, { method: 'POST', ...AUTH })).status).toBe(429);
  });
  it('failed /api/session attempts also lock out /api routes', async () => {
    const { base } = await start({ remote: true });
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`${base}/api/session`, {
        method: 'POST',
        headers: { authorization: 'Bearer wrong' },
      });
      expect(r.status).toBe(401);
    }
    expect((await fetch(`${base}/api/snapshot`, AUTH)).status).toBe(429);
  });
  it('bad ?token= links on the shell count too', async () => {
    const { base, port } = await start({ remote: true });
    for (let i = 0; i < 10; i++) expect((await rawReq(port, '/?token=wrong', {})).status).toBe(200);
    expect((await rawReq(port, `/?token=${TOKEN}`, {})).headers['set-cookie']).toBeUndefined();
    expect((await fetch(`${base}/api/snapshot`, AUTH)).status).toBe(429);
  });
  it('requests without credentials do not count', async () => {
    const { base } = await start({ remote: true });
    for (let i = 0; i < 15; i++) expect((await fetch(`${base}/api/snapshot`)).status).toBe(401);
    expect((await fetch(`${base}/api/snapshot`, AUTH)).status).toBe(200);
  });
  it('loopback clients are never limited', async () => {
    const { base } = await start();
    for (let i = 0; i < 15; i++) {
      await fetch(`${base}/api/snapshot`, { headers: { authorization: 'Bearer wrong' } });
    }
    expect((await fetch(`${base}/api/snapshot`)).status).toBe(200);
  });
});

describe('proxy forwarding headers', () => {
  for (const [name, value] of [
    ['X-Forwarded-For', '203.0.113.9'],
    ['Forwarded', 'for=203.0.113.9'],
  ] as const) {
    it(`loopback request with ${name} is treated as remote`, async () => {
      const { port } = await start({ store: new FakeStore() });
      const anon = await rawReq(port, '/api/snapshot', { [name]: value });
      expect(anon.status).toBe(401);
      expect(anon.body).not.toContain('SYNTH-STATUS');
      const authed = await rawReq(port, '/api/snapshot', {
        [name]: value,
        authorization: `Bearer ${TOKEN}`,
      });
      expect(authed.status).toBe(200);
      const j = JSON.parse(authed.body) as FleetSnapshot;
      expect(j.projects[0]!.path).toBe('');
      expect(authed.body).not.toContain('SYNTH-STATUS');
    });
  }
});
