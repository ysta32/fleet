import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FleetConfig, FleetEvent, FleetSnapshot, HistoryResponse } from '@fleet/shared';
import { createServer, opaqueProjectId, redactEvent, redactSnapshot, type StoreLike } from './server.js';

const TOKEN = 'a'.repeat(64);
const PID = '-synthetic-dev-alpha';

function makeSnapshot(now = 1_000_000): FleetSnapshot {
  return {
    version: 1,
    generatedAt: now,
    projects: [
      {
        id: PID,
        name: 'alpha',
        path: '/synthetic/dev/alpha',
        lastActivity: now,
        orch: {
          projectId: PID,
          phase: 'running',
          statusText: 'SYNTHETIC STATUS',
          handoffText: 'SYNTHETIC HANDOFF',
          tasks: [],
          inflight: [],
          worktrees: [],
          blocked: [],
          updatedAt: now,
        },
      },
    ],
    sessions: [
      {
        id: 's1',
        projectId: PID,
        model: 'opus',
        startedAt: now,
        lastActivity: now,
        status: 'active',
        tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0,
        toolCalls: 0,
        agentIds: ['s1', `${PID}:astra:t01`],
      },
    ],
    agents: [
      {
        id: `${PID}:astra:t01`,
        sessionId: 's1',
        projectId: PID,
        role: 'coder',
        model: 'astra',
        label: 'coder t01',
        status: 'working',
        location: { kind: 'project', projectId: PID },
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        startedAt: now,
        lastActivity: now,
      },
    ],
    prs: [],
    releases: [],
    deploys: [],
    alerts: [{ id: 'al1', kind: 'army.done', projectId: PID, title: 't', body: 'b', at: now }],
  };
}

const EVENT: FleetEvent = {
  id: '1-1',
  ts: 1,
  kind: 'agent.move',
  projectId: PID,
  agentId: `${PID}:astra:t01`,
  severity: 'info',
  label: 'move',
  to: { kind: 'task', projectId: PID, ref: 't01' },
};

class FakeStore extends EventEmitter implements StoreLike {
  snap = makeSnapshot();
  lastHistory: [number, number] | undefined;
  snapshot(): FleetSnapshot {
    return this.snap;
  }
  history(from: number, to: number): HistoryResponse {
    this.lastHistory = [from, to];
    return { from, to, frames: [this.snap], events: [EVENT] };
  }
}

function makeConfig(over: Partial<FleetConfig> = {}): FleetConfig {
  return {
    port: 0,
    lan: false,
    token: TOKEN,
    claudeProjectsDir: '/nonexistent',
    recentWindowMs: 1000,
    shareContent: false,
    notify: { macos: false, ntfyUrl: '', kinds: [] },
    github: false,
    githubPollMs: 60000,
    ...over,
  };
}

interface Resp {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server | undefined;
let port = 0;
let tmp: string;

async function start(opts: {
  store?: StoreLike;
  config?: FleetConfig;
  remote?: boolean;
  webDir?: string;
  digestDir?: string;
}): Promise<void> {
  server = createServer({
    store: opts.store ?? new FakeStore(),
    config: opts.config ?? makeConfig(),
    webDir: opts.webDir,
    digestDir: opts.digestDir,
    isLoopback: opts.remote ? () => false : undefined,
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
}

function get(p: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Opens an SSE stream and collects parsed frames. */
function openSse(p: string, headers: Record<string, string> = {}) {
  const frames: { event?: string; data?: string; comment?: string }[] = [];
  let status = 0;
  let req!: http.ClientRequest;
  const ready = new Promise<void>((resolve, reject) => {
    req = http.request(
      { host: '127.0.0.1', port, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        status = res.statusCode ?? 0;
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          buf += c;
          let i: number;
          while ((i = buf.indexOf('\n\n')) !== -1) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const f: { event?: string; data?: string; comment?: string } = {};
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) f.comment = line.slice(1).trim();
              else if (line.startsWith('event: ')) f.event = line.slice(7);
              else if (line.startsWith('data: ')) f.data = line.slice(6);
            }
            frames.push(f);
          }
        });
        resolve();
      },
    );
    req.on('error', reject);
    req.end();
  });
  return { frames, ready, close: () => req.destroy(), status: () => status };
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'fleet-srv-'));
});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server!.close(r));
    server = undefined;
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe('endpoints (loopback)', () => {
  it('health, snapshot unredacted, security headers, no CORS', async () => {
    await start({});
    const h = await get('/api/health');
    expect(h.status).toBe(200);
    expect(JSON.parse(h.body)).toMatchObject({ ok: true, protocol: 1 });
    expect(h.headers['x-content-type-options']).toBe('nosniff');
    expect(h.headers['referrer-policy']).toBe('no-referrer');
    expect(h.headers['content-security-policy']).toContain("default-src 'self'");
    expect(h.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h.headers['access-control-allow-origin']).toBeUndefined();
    const s = JSON.parse((await get('/api/snapshot')).body) as FleetSnapshot;
    expect(s.projects[0].path).toBe('/synthetic/dev/alpha');
    expect(s.projects[0].orch?.statusText).toBe('SYNTHETIC STATUS');
    expect((await get('/api/snapshot', {}, 'POST')).status).toBe(405);
    expect((await get('/api/nope')).status).toBe(404);
  });

  it('history defaults, clamps and validates', async () => {
    const store = new FakeStore();
    await start({ store });
    const r = await get('/api/history?from=0&to=100000000');
    expect(r.status).toBe(200);
    expect(store.lastHistory).toEqual([100000000 - 24 * 3600_000, 100000000]);
    await get('/api/history?to=50000000');
    expect(store.lastHistory).toEqual([50000000 - 6 * 3600_000, 50000000]);
    expect((await get('/api/history?from=abc')).status).toBe(400);
    expect((await get('/api/history?from=10&to=5')).status).toBe(400);
  });

  it('digest: 404 when missing, served when present', async () => {
    await start({ digestDir: tmp });
    expect((await get('/api/digest/latest')).status).toBe(404);
    writeFileSync(path.join(tmp, 'latest.json'), JSON.stringify({ synthetic: true }));
    const r = await get('/api/digest/latest');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ synthetic: true });
  });
});

describe('auth matrix', () => {
  it('remote without token -> 401 everywhere', async () => {
    await start({ remote: true, webDir: tmp });
    for (const p of ['/api/health', '/api/snapshot', '/api/events', '/api/history', '/']) {
      expect((await get(p)).status).toBe(401);
    }
    expect((await get('/api/snapshot', { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await get('/api/snapshot?token=wrong')).status).toBe(401);
    expect((await get('/api/snapshot', { authorization: `Basic ${TOKEN}` })).status).toBe(401);
  });

  it('remote with bearer, query token, or cookie -> 200', async () => {
    await start({ remote: true });
    expect((await get('/api/snapshot', { authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    const q = await get(`/api/snapshot?token=${TOKEN}`);
    expect(q.status).toBe(200);
    const cookie = String(q.headers['set-cookie']);
    expect(cookie).toContain(`fleet_token=${TOKEN}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=31536000');
    expect((await get('/api/snapshot', { cookie: `fleet_token=${TOKEN}` })).status).toBe(200);
    expect((await get('/api/snapshot', { cookie: 'fleet_token=nope' })).status).toBe(401);
  });

  it('empty configured token never authorizes remote', async () => {
    await start({ remote: true, config: makeConfig({ token: '' }) });
    expect((await get('/api/snapshot?token=')).status).toBe(401);
    expect((await get('/api/snapshot', { authorization: 'Bearer ' })).status).toBe(401);
  });

  it('DNS rebinding: foreign Host rejected even from loopback', async () => {
    await start({});
    expect((await get('/api/snapshot', { host: 'evil.example' })).status).toBe(421);
    expect((await get('/api/snapshot', { host: `localhost:${port}` })).status).toBe(200);
    expect((await get('/api/snapshot', { host: '192.168.1.5' })).status).toBe(421);
  });

  it('lan mode allows IP literals, .local, .ts.net, allowedHosts; loopback socket w/ LAN host needs token', async () => {
    await start({ config: { ...makeConfig({ lan: true }), allowedHosts: ['fleet.example'] } as FleetConfig });
    expect((await get('/api/health', { host: 'evil.example' })).status).toBe(421);
    for (const host of [
      '192.168.1.5:4747',
      '[fe80::1]:4747',
      'mac.local',
      'mac.tail1.ts.net',
      'fleet.example',
    ]) {
      expect((await get('/api/health', { host })).status).toBe(401);
      expect((await get('/api/health', { host, authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    }
  });
});

describe('redaction', () => {
  it('pure redactSnapshot/redactEvent hide paths, content and project ids', () => {
    const snap = makeSnapshot();
    const r = redactSnapshot(snap, TOKEN);
    const op = opaqueProjectId(PID, TOKEN);
    expect(op).toMatch(/^p_[0-9a-f]{12}$/);
    expect(r.projects[0]).toMatchObject({ id: op, path: '' });
    expect(r.projects[0].orch).toMatchObject({ projectId: op, statusText: '', handoffText: '' });
    expect(r.sessions[0].projectId).toBe(op);
    expect(r.agents[0]).toMatchObject({ projectId: op, id: `${op}:astra:t01` });
    expect(r.agents[0].location.projectId).toBe(op);
    expect(r.alerts[0].projectId).toBe(op);
    expect(JSON.stringify(r)).not.toContain(PID);
    expect(JSON.stringify(r)).not.toContain('SYNTHETIC');
    // input untouched
    expect(snap.projects[0].path).toBe('/synthetic/dev/alpha');
    const e = redactEvent(EVENT, TOKEN);
    expect(JSON.stringify(e)).not.toContain(PID);
    expect(e.to?.projectId).toBe(op);
    // stable, salt-dependent
    expect(opaqueProjectId(PID, TOKEN)).toBe(op);
    expect(opaqueProjectId(PID, 'other')).not.toBe(op);
    // shareContent: only path blanked
    const shared = redactSnapshot(snap, TOKEN, { shareContent: true });
    expect(shared.projects[0]).toMatchObject({ id: PID, path: '' });
    expect(shared.projects[0].orch?.statusText).toBe('SYNTHETIC STATUS');
  });

  it('remote snapshot/history are redacted; shareContent keeps text', async () => {
    await start({ remote: true });
    const auth = { authorization: `Bearer ${TOKEN}` };
    const s = (await get('/api/snapshot', auth)).body;
    expect(s).not.toContain('/synthetic/dev/alpha');
    expect(s).not.toContain('SYNTHETIC');
    expect(s).not.toContain(PID);
    const h = (await get('/api/history', auth)).body;
    expect(h).not.toContain(PID);
    expect(h).not.toContain('SYNTHETIC');
    expect((await get('/api/digest/latest', auth)).status).toBe(403);
  });

  it('remote with shareContent sees text but not paths', async () => {
    await start({ remote: true, config: makeConfig({ shareContent: true }) });
    const s = JSON.parse(
      (await get('/api/snapshot', { authorization: `Bearer ${TOKEN}` })).body,
    ) as FleetSnapshot;
    expect(s.projects[0].path).toBe('');
    expect(s.projects[0].orch?.statusText).toBe('SYNTHETIC STATUS');
  });
});

describe('SSE', () => {
  it('snapshot on connect, immediate fleet events, throttled snapshots, cleanup on close', async () => {
    const store = new FakeStore();
    await start({ store });
    const sse = openSse('/api/events');
    await sse.ready;
    expect(sse.status()).toBe(200);
    await waitFor(() => sse.frames.some((f) => f.event === 'snapshot'));
    expect(JSON.parse(sse.frames.find((f) => f.event === 'snapshot')!.data!).projects[0].path).toBe(
      '/synthetic/dev/alpha',
    );
    store.emit('event', EVENT);
    await waitFor(() => sse.frames.some((f) => f.event === 'fleet'));
    expect(JSON.parse(sse.frames.find((f) => f.event === 'fleet')!.data!)).toEqual(EVENT);

    // change right after connect is throttled (<=1 snapshot per 2s)
    const t0 = Date.now();
    store.emit('change');
    store.emit('change');
    store.emit('change');
    await waitFor(() => sse.frames.filter((f) => f.event === 'snapshot').length === 2, 4000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1500);
    await new Promise((r) => setTimeout(r, 200));
    expect(sse.frames.filter((f) => f.event === 'snapshot').length).toBe(2);

    expect(store.listenerCount('event')).toBe(1);
    sse.close();
    await waitFor(() => store.listenerCount('event') === 0 && store.listenerCount('change') === 0);
  }, 10000);

  it('remote SSE requires token and redacts events', async () => {
    const store = new FakeStore();
    await start({ store, remote: true });
    const denied = openSse('/api/events');
    await denied.ready;
    expect(denied.status()).toBe(401);
    denied.close();
    const sse = openSse(`/api/events?token=${TOKEN}`);
    await sse.ready;
    await waitFor(() => sse.frames.some((f) => f.event === 'snapshot'));
    store.emit('event', EVENT);
    await waitFor(() => sse.frames.some((f) => f.event === 'fleet'));
    for (const f of sse.frames) expect(f.data ?? '').not.toContain(PID);
    sse.close();
  });
});

describe('static files', () => {
  beforeEach(() => {
    const web = path.join(tmp, 'web');
    mkdirSync(path.join(web, 'assets'), { recursive: true });
    writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>fleet</title>');
    writeFileSync(path.join(web, 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(path.join(web, '.env'), 'SECRET_DOT');
    writeFileSync(path.join(tmp, 'secret.txt'), 'SECRET_OUTSIDE');
    symlinkSync(path.join(tmp, 'secret.txt'), path.join(web, 'link.txt'));
  });

  it('serves files with content types and SPA fallback', async () => {
    await start({ webDir: path.join(tmp, 'web') });
    const idx = await get('/');
    expect(idx.status).toBe(200);
    expect(idx.headers['content-type']).toContain('text/html');
    const js = await get('/assets/app.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toContain('text/javascript');
    const spa = await get('/dashboard/projects');
    expect(spa.status).toBe(200);
    expect(spa.body).toContain('<title>fleet</title>');
    expect((await get('/assets/missing.js')).status).toBe(404);
  });

  it('blocks traversal, encoded traversal, dotfiles and escaping symlinks', async () => {
    await start({ webDir: path.join(tmp, 'web') });
    for (const p of [
      '/../secret.txt',
      '/assets/../../secret.txt',
      '/%2e%2e/secret.txt',
      '/%2e%2e%2fsecret.txt',
      '/..%5csecret.txt',
      '/.env',
      '/link.txt',
      '/%00',
      '/%E0%A4%A',
    ]) {
      const r = await get(p);
      expect(r.status, p).not.toBe(200);
      expect(r.body).not.toContain('SECRET');
    }
  });
});
