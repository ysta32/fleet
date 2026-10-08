import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FleetConfig, FleetSnapshot, HistoryResponse } from '@fleet/shared';
import { createServer } from './server.js';

const TOKEN = 'c'.repeat(64);

class FakeStore extends EventEmitter {
  snapshot(): FleetSnapshot {
    return {
      version: 1,
      generatedAt: 1000,
      projects: [],
      sessions: [],
      agents: [],
      prs: [],
      releases: [],
      deploys: [],
      alerts: [],
    };
  }
  history(from: number, to: number): HistoryResponse {
    return { from, to, frames: [], events: [] };
  }
}

const config: FleetConfig = {
  port: 0,
  lan: true,
  token: TOKEN,
  claudeProjectsDir: '/nonexistent',
  recentWindowMs: 86400000,
  shareContent: false,
  notify: { macos: false, ntfyUrl: '', kinds: [] },
  github: false,
  githubPollMs: 60000,
};

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function start(): Promise<number> {
  const server = createServer({ store: new FakeStore(), config, isLoopback: () => false });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
}

function req(
  port: number,
  method: string,
  p: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    r.on('error', reject);
    r.end();
  });
}

const cookieOf = (h: http.IncomingHttpHeaders) =>
  ([] as string[]).concat(h['set-cookie'] ?? []).find((c) => c.startsWith('fleet_token='));

describe('POST /api/session', () => {
  it('exchanges a valid Bearer token for the HttpOnly session cookie, which then authorizes', async () => {
    const port = await start();
    const r = await req(port, 'POST', '/api/session', {
      Authorization: `Bearer ${TOKEN}`,
      Origin: `http://127.0.0.1:${port}`,
    });
    expect(r.status).toBe(204);
    const sc = cookieOf(r.headers);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Strict/i);
    expect(sc).not.toMatch(/Secure/i);
    const after = await req(port, 'GET', '/api/snapshot', { Cookie: sc!.split(';')[0]! });
    expect(after.status).toBe(200);
  });
  it('marks the cookie Secure behind https', async () => {
    const port = await start();
    const r = await req(port, 'POST', '/api/session', {
      Authorization: `Bearer ${TOKEN}`,
      'X-Forwarded-Proto': 'https',
    });
    expect(r.status).toBe(204);
    expect(cookieOf(r.headers)).toMatch(/Secure/);
  });
  it('rejects a bad or missing token with 401 and no cookie', async () => {
    const port = await start();
    const bad = await req(port, 'POST', '/api/session', { Authorization: `Bearer ${'d'.repeat(64)}` });
    expect(bad.status).toBe(401);
    expect(cookieOf(bad.headers)).toBeUndefined();
    expect((await req(port, 'POST', '/api/session')).status).toBe(401);
    // the token in a query string is not accepted here
    expect((await req(port, 'POST', `/api/session?token=${TOKEN}`)).status).toBe(401);
  });
  it('rejects cross-site requests even with a valid token', async () => {
    const port = await start();
    const evil = await req(port, 'POST', '/api/session', {
      Authorization: `Bearer ${TOKEN}`,
      Origin: 'https://evil.example',
    });
    expect(evil.status).toBe(403);
    expect(cookieOf(evil.headers)).toBeUndefined();
    const site = await req(port, 'POST', '/api/session', {
      Authorization: `Bearer ${TOKEN}`,
      'Sec-Fetch-Site': 'cross-site',
    });
    expect(site.status).toBe(403);
  });
  it('allows only POST', async () => {
    const port = await start();
    const r = await req(port, 'GET', '/api/session', { Authorization: `Bearer ${TOKEN}` });
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe('POST');
  });
  it('respects the Host allowlist', async () => {
    const port = await start();
    const r = await req(port, 'POST', '/api/session', { Authorization: `Bearer ${TOKEN}`, Host: 'evil.com' });
    expect([403, 421]).toContain(r.status);
  });
  it('rate limits repeated failures with 429 and Retry-After, even for a later good token', async () => {
    const port = await start();
    for (let i = 0; i < 10; i++)
      expect((await req(port, 'POST', '/api/session', { Authorization: 'Bearer wrong' })).status).toBe(401);
    const limited = await req(port, 'POST', '/api/session', { Authorization: `Bearer ${TOKEN}` });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
  it('keeps the ?token= link flow working on the shell, never on /api', async () => {
    const port = await start();
    const r = await req(port, 'GET', `/?token=${TOKEN}`);
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe('/');
    expect(cookieOf(r.headers)).toBeDefined();
    const api = await req(port, 'GET', `/api/health?token=${TOKEN}`);
    expect(api.status).toBe(401);
    expect(cookieOf(api.headers)).toBeUndefined();
  });
});
