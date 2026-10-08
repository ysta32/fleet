import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { FleetConfig, FleetSnapshot, HistoryResponse } from '@fleet/shared';
import { createServer, type CreateServerOptions } from './server.js';

const TOKEN = 'd'.repeat(64);
const SENTINEL = 'SYNTHETIC_PROJECT_SENTINEL';

class FakeStore extends EventEmitter {
  snapshot(): FleetSnapshot {
    return {
      version: 1,
      generatedAt: 1000,
      projects: [{ id: 'p', name: SENTINEL, path: `/synthetic/${SENTINEL}`, lastActivity: 1 }],
      sessions: [],
      agents: [],
      prs: [],
      releases: [],
      deploys: [],
      alerts: [],
    } as FleetSnapshot;
  }
  history(from: number, to: number): HistoryResponse {
    return { from, to, frames: [], events: [] };
  }
}

const baseConfig: FleetConfig = {
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

let tmp: string;
let web: string;
const servers: http.Server[] = [];
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'fleet-shell-'));
  web = path.join(tmp, 'web');
  mkdirSync(path.join(web, 'assets'), { recursive: true });
  writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>fleet</title>');
  writeFileSync(path.join(web, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(path.join(web, 'sw.js'), 'self.x=1');
  writeFileSync(path.join(web, 'manifest.webmanifest'), '{}');
  writeFileSync(path.join(web, '.env'), 'SECRET_DOT');
  writeFileSync(path.join(tmp, 'secret.txt'), 'SECRET_OUTSIDE');
  symlinkSync(path.join(tmp, 'secret.txt'), path.join(web, 'link.txt'));
  mkdirSync(path.join(web, '.git'));
  writeFileSync(path.join(web, '.git', 'config.txt'), 'SECRET_GIT');
  symlinkSync('.env', path.join(web, 'public.txt'));
  symlinkSync(path.join(web, '.env'), path.join(web, 'abs.txt'));
  symlinkSync('.git', path.join(web, 'gitdir'));
  symlinkSync('index.html', path.join(web, 'alias.html'));
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  rmSync(tmp, { recursive: true, force: true });
});

async function start(
  extra: Partial<CreateServerOptions> & { remote?: boolean; config?: Partial<FleetConfig> } = {},
): Promise<number> {
  const { remote = true, config, ...rest } = extra;
  const server = createServer({
    store: new FakeStore(),
    config: { ...baseConfig, ...config },
    webDir: web,
    isLoopback: remote ? () => false : () => true,
    ...rest,
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
}

function get(
  port: number,
  p: string,
  headers: Record<string, string> = {},
  method = 'GET',
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        path: p,
        method,
        agent: false,
        headers: { host: '192.168.1.5:4747', ...headers },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    r.on('error', reject);
    r.end();
  });
}

describe('remote web shell without a token', () => {
  it('serves index.html, hashed assets, sw.js and the manifest with no token and no fleet data', async () => {
    const port = await start();
    for (const p of [
      '/',
      '/index.html',
      '/assets/index-abc123.js',
      '/sw.js',
      '/manifest.webmanifest',
      '/sessions',
    ]) {
      const r = await get(port, p);
      expect(r.status, p).toBe(200);
      expect(r.body, p).not.toContain(SENTINEL);
      expect(r.headers['set-cookie'], p).toBeUndefined();
    }
    expect((await get(port, '/')).body).toContain('<title>fleet</title>');
    expect((await get(port, '/', {}, 'HEAD')).status).toBe(200);
  });

  it('keeps every /api route behind the token', async () => {
    const port = await start({ extraGet: { '/api/spend': () => ({ spend: SENTINEL }) } });
    for (const p of [
      '/api',
      '/api/',
      '/api/health',
      '/api/snapshot',
      '/api/events',
      '/api/history',
      '/api/digest/latest',
      '/api/spend',
      '/api/nope',
    ]) {
      const r = await get(port, p);
      expect(r.status, p).toBe(401);
      expect(r.body, p).not.toContain(SENTINEL);
    }
    expect((await get(port, '/api/snapshot', { authorization: `Bearer ${TOKEN}` })).status).toBe(200);
  });

  it('a valid ?token= link on the shell still sets the session cookie; a bad one does not', async () => {
    const port = await start();
    const ok = await get(port, `/?token=${TOKEN}`);
    expect(ok.status).toBe(200);
    expect(String(ok.headers['set-cookie'])).toContain(`fleet_token=${TOKEN}`);
    const bad = await get(port, '/?token=wrong');
    expect(bad.status).toBe(200);
    expect(bad.headers['set-cookie']).toBeUndefined();
  });

  it('asset paths cannot traverse, reach dotfiles or follow escaping symlinks', async () => {
    const port = await start();
    for (const p of [
      '/../secret.txt',
      '/assets/../../secret.txt',
      '/%2e%2e/secret.txt',
      '/%2e%2e%2fsecret.txt',
      '/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
      '/..%5csecret.txt',
      '/.env',
      '/link.txt',
      '/%00',
    ]) {
      const r = await get(port, p);
      expect(r.status, p).not.toBe(200);
      expect(r.body, p).not.toContain('SECRET');
    }
  });

  it('never serves a dotfile through an in-root symlink alias (public.txt -> .env)', async () => {
    for (const remote of [true, false]) {
      const port = await start({ remote });
      const headers: Record<string, string> = remote ? {} : { host: '127.0.0.1' };
      for (const p of ['/public.txt', '/abs.txt', '/gitdir/config.txt', '/alias.html']) {
        const r = await get(port, p, headers);
        expect(r.status, p).not.toBe(200);
        expect(r.body, p).not.toContain('SECRET');
        expect(r.body, p).not.toContain('<title>fleet</title>');
      }
      expect((await get(port, '/index.html', headers)).status).toBe(200);
    }
  });

  it('is still subject to the Host allowlist', async () => {
    const port = await start();
    expect((await get(port, '/', { host: 'evil.example' })).status).toBe(421);
    const offLan = await start({ config: { lan: false } });
    expect((await get(offLan, '/', { host: '192.168.1.5:4747' })).status).toBe(421);
  });
});

describe('GET /api/health shareUrl', () => {
  const local = { host: '127.0.0.1' };
  it('gives loopback callers the LAN/Tailscale URL when remote access is on, never with the token', async () => {
    const port = await start({ remote: false, shareHost: () => '100.101.102.103' });
    const body = JSON.parse((await get(port, '/api/health', local)).body) as { shareUrl?: string };
    expect(body.shareUrl).toBe(`http://100.101.102.103:${port}/`);
    expect(body.shareUrl).not.toContain(TOKEN);
    expect(body.shareUrl).not.toContain('token');
  });

  it('brackets IPv6 hosts', async () => {
    const port = await start({ remote: false, shareHost: () => 'fd7a:115c::1' });
    const body = JSON.parse((await get(port, '/api/health', local)).body) as { shareUrl?: string };
    expect(body.shareUrl).toBe(`http://[fd7a:115c::1]:${port}/`);
  });

  it('is omitted for remote callers, when remote access is off, or when no address is found', async () => {
    const remote = await start({ shareHost: () => '192.168.1.9' });
    const r = JSON.parse(
      (await get(remote, '/api/health', { authorization: `Bearer ${TOKEN}` })).body,
    ) as object;
    expect(r).not.toHaveProperty('shareUrl');
    const off = await start({ remote: false, config: { lan: false }, shareHost: () => '192.168.1.9' });
    expect(JSON.parse((await get(off, '/api/health', local)).body)).not.toHaveProperty('shareUrl');
    const none = await start({ remote: false, shareHost: () => undefined });
    expect(JSON.parse((await get(none, '/api/health', local)).body)).not.toHaveProperty('shareUrl');
  });
});
