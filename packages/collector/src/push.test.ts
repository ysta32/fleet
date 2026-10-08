import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import webPush from 'web-push';
import type { Alert, FleetConfig, FleetSnapshot } from '@fleet/shared';
import { PushManager, validatePushEndpoint, validatePushSubscription } from './push.js';
import { createServer } from './server.js';
import { runDaemon } from './daemon.js';

vi.mock('web-push', async (original) => {
  const real = await original<typeof import('web-push')>();
  return { default: { ...real.default, sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }) } };
});

const key = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
const sub = (id = 'one') => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  keys: { p256dh: key, auth: Buffer.alloc(16, 2).toString('base64url') },
});
const snapshot: FleetSnapshot = {
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
const alert: Alert = {
  id: '/Users/private/transcript-secret',
  kind: 'army.done',
  projectId: '-Users-private-secret',
  title: 'raw transcript secret',
  body: '/Users/private/repo secret transcript',
  at: 1000,
};
const config: FleetConfig = {
  port: 0,
  lan: true,
  token: 'test-token',
  claudeProjectsDir: '/unused',
  recentWindowMs: 86400000,
  shareContent: true,
  notify: { macos: false, ntfyUrl: '', kinds: ['army.done', 'spend.budget'] },
  github: false,
  githubPollMs: 60000,
};
let dir: string;
const servers: http.Server[] = [];
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'fleet-push-'));
  vi.mocked(webPush.sendNotification)
    .mockReset()
    .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
});
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await fs.rm(dir, { recursive: true, force: true });
});

describe('push storage and delivery', () => {
  it.each([
    'https://fcm.googleapis.com/send/a',
    'https://updates.push.services.mozilla.com/wpush/a',
    'https://web.push.apple.com/a',
    'https://wns.notify.windows.com/a',
  ])('accepts known service %s', (url) => expect(validatePushEndpoint(url)).toBe(url));

  it.each([
    'http://fcm.googleapis.com/a',
    'https://fcm.googleapis.com.evil.test/a',
    'https://evilpush.apple.com/a',
    'https://notify.windows.com/a',
    'https://localhost/a',
    'https://127.0.0.1/a',
    'https://user:pass@fcm.googleapis.com/a',
    'https://fcm.googleapis.com:8443/a',
    'https://fcm.googleapis.com/a#secret',
    'https://fcm.googleapis.com/' + 'a'.repeat(2048),
  ])('rejects unsafe endpoint %s', (url) => expect(() => validatePushEndpoint(url)).toThrow());

  it('rejects malformed subscriptions and keys', () => {
    for (const value of [
      null,
      [],
      {},
      { ...sub(), keys: {} },
      { ...sub(), keys: { p256dh: 'abc', auth: 'abc' } },
    ]) {
      expect(() => validatePushSubscription(value)).toThrow();
    }
  });

  it('persists private keys and subscriptions, dedupes and reloads', async () => {
    const push = new PushManager(dir);
    const [a, b] = await Promise.all([push.publicKey(), push.publicKey()]);
    expect(a).toBe(b);
    expect(a).toHaveLength(87);
    await Promise.all([push.subscribe(sub()), push.subscribe(sub())]);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'push/subs.json'), 'utf8'))).toEqual([sub()]);
    for (const [name, mode] of [
      ['push', 0o700],
      ['push/vapid.json', 0o600],
      ['push/subs.json', 0o600],
    ] as const) {
      expect((await fs.stat(path.join(dir, name))).mode & 0o777).toBe(mode);
    }
    const restored = new PushManager(dir);
    expect(await restored.publicKey()).toBe(a);
    await restored.send(alert, snapshot);
    expect(webPush.sendNotification).toHaveBeenCalledTimes(1);
    await restored.unsubscribe({ endpoint: sub().endpoint });
    expect(JSON.parse(await fs.readFile(path.join(dir, 'push/subs.json'), 'utf8'))).toEqual([]);
  });

  it('caps subscriptions at 20 but permits replacement at capacity', async () => {
    const push = new PushManager(dir);
    await Promise.all(Array.from({ length: 20 }, (_, i) => push.subscribe(sub(String(i)))));
    await expect(push.subscribe(sub('overflow'))).rejects.toThrow('limit');
    await expect(push.subscribe(sub('0'))).resolves.toBeUndefined();
  });

  it('redacts every alert kind and coalesces per tag for 30 seconds', async () => {
    let now = 1000;
    const push = new PushManager(dir, () => now);
    await push.subscribe(sub());
    await Promise.all([push.send(alert, snapshot), push.send({ ...alert, id: 'other' }, snapshot)]);
    expect(webPush.sendNotification).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(vi.mocked(webPush.sendNotification).mock.calls[0]![1] as string);
    expect(payload).toEqual({
      title: 'Army finished',
      body: '',
      tag: expect.stringMatching(/^army.done:p_[a-f0-9]{12}$/),
      url: '/',
    });
    for (const kind of [
      'army.blocked',
      'ci.failed',
      'session.waiting',
      'deploy.failed',
      'spend.budget',
    ] as const) {
      await push.send({ ...alert, kind }, snapshot);
    }
    expect(webPush.sendNotification).toHaveBeenCalledTimes(6);
    for (const call of vi.mocked(webPush.sendNotification).mock.calls) {
      expect(call[1]).not.toMatch(/secret|Users|private|transcript/);
    }
    now += 29999;
    await push.send(alert, snapshot);
    expect(webPush.sendNotification).toHaveBeenCalledTimes(6);
    now++;
    await push.send(alert, snapshot);
    expect(webPush.sendNotification).toHaveBeenCalledTimes(7);
  });

  it.each([403, 404, 410])('prunes expired subscriptions on %s', async (statusCode) => {
    const push = new PushManager(dir);
    await push.subscribe(sub('expired'));
    await push.subscribe(sub('good'));
    vi.mocked(webPush.sendNotification).mockRejectedValueOnce(
      new webPush.WebPushError(
        'invalid subscription or VAPID key mismatch',
        statusCode,
        {},
        '',
        sub('expired').endpoint,
      ),
    );
    await push.send(alert, snapshot);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'push/subs.json'), 'utf8'))).toEqual([sub('good')]);
  });

  it.each([429, 500, 503])(
    'retains subscriptions after %s and permits retry without exposing service errors',
    async (statusCode) => {
      const push = new PushManager(dir);
      await push.subscribe(sub());
      vi.mocked(webPush.sendNotification).mockRejectedValueOnce({
        statusCode,
        message: 'secret endpoint',
      });
      await expect(push.send(alert, snapshot)).rejects.toThrow(/^push delivery failed$/);
      expect(JSON.parse(await fs.readFile(path.join(dir, 'push/subs.json'), 'utf8'))).toEqual([sub()]);
      await push.send(alert, snapshot);
      expect(webPush.sendNotification).toHaveBeenCalledTimes(2);
    },
  );

  it('permits retry after setup fails', async () => {
    const push = new PushManager(dir, () => 1000);
    await fs.writeFile(path.join(dir, 'push'), 'not a directory');
    await expect(push.send(alert, snapshot)).rejects.toThrow();
    await fs.rm(path.join(dir, 'push'));
    await push.subscribe(sub());
    await push.send(alert, snapshot);
    expect(webPush.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('coalesces when there are no subscriptions', async () => {
    const push = new PushManager(dir, () => 1000);
    await push.send(alert, snapshot);
    await push.subscribe(sub());
    await push.send(alert, snapshot);
    expect(webPush.sendNotification).not.toHaveBeenCalled();
  });

  it('permits retry when every subscription is pruned', async () => {
    const push = new PushManager(dir, () => 1000);
    await push.subscribe(sub());
    vi.mocked(webPush.sendNotification).mockRejectedValueOnce({ statusCode: 403 });
    await push.send(alert, snapshot);
    await push.subscribe(sub('replacement'));
    await push.send(alert, snapshot);
    expect(webPush.sendNotification).toHaveBeenCalledTimes(2);
  });

  it('coalesces after partial success even when another delivery fails', async () => {
    const push = new PushManager(dir, () => 1000);
    await push.subscribe(sub('bad'));
    await push.subscribe(sub('good'));
    vi.mocked(webPush.sendNotification).mockRejectedValueOnce({ statusCode: 500 });
    await expect(push.send(alert, snapshot)).rejects.toThrow(/^push delivery failed$/);
    await push.send(alert, snapshot);
    expect(webPush.sendNotification).toHaveBeenCalledTimes(2);
  });

  it('does not prune a renewed subscription when an old delivery expires', async () => {
    const push = new PushManager(dir);
    await push.subscribe(sub());
    let reject!: (reason: unknown) => void;
    vi.mocked(webPush.sendNotification).mockImplementationOnce(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    const sending = push.send(alert, snapshot);
    await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
    await push.subscribe(sub());
    reject({ statusCode: 410 });
    await sending;
    expect(JSON.parse(await fs.readFile(path.join(dir, 'push/subs.json'), 'utf8'))).toEqual([sub()]);
  });

  it('does no disk or network work in demo mode', async () => {
    await new PushManager(dir).send(alert, { ...snapshot, demo: true });
    expect(await fs.readdir(dir)).toEqual([]);
    expect(webPush.sendNotification).not.toHaveBeenCalled();
  });
});

async function start(local = false, demo = false): Promise<number> {
  const store = Object.assign(new EventEmitter(), {
    snapshot: () => ({ ...snapshot, demo }),
    history: (from: number, to: number) => ({ from, to, frames: [], events: [] }),
  });
  const server = createServer({ store, config, push: new PushManager(dir), isLoopback: () => local });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}
async function request(
  port: number,
  method: string,
  route: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path: route,
        headers: {
          'Content-Type': 'application/json',
          ...(body === undefined
            ? {}
            : { 'Content-Length': String(Buffer.byteLength(JSON.stringify(body))) }),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode!, body: text }));
      },
    );
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const auth = { Authorization: 'Bearer test-token' };

describe('push routes', () => {
  it('requires remote authentication on every route and rejects invalid credentials', async () => {
    const port = await start();
    for (const [method, route] of [
      ['GET', '/api/push/key'],
      ['POST', '/api/push/subscribe'],
      ['DELETE', '/api/push/subscribe'],
    ]) {
      expect((await request(port, method!, route!, sub())).status).toBe(401);
      expect((await request(port, method!, route!, sub(), { Authorization: 'Bearer wrong' })).status).toBe(
        401,
      );
    }
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('serves only the public key and supports authenticated subscription CRUD', async () => {
    const port = await start();
    const keyResponse = await request(port, 'GET', '/api/push/key', undefined, auth);
    expect(keyResponse.status).toBe(200);
    expect(Object.keys(JSON.parse(keyResponse.body))).toEqual(['publicKey']);
    expect((await request(port, 'POST', '/api/push/subscribe', sub(), auth)).status).toBe(204);
    expect(
      (
        await request(
          port,
          'DELETE',
          '/api/push/subscribe',
          { endpoint: sub().endpoint },
          { Cookie: 'fleet_token=test-token' },
        )
      ).status,
    ).toBe(204);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'push/subs.json'), 'utf8'))).toEqual([]);
  });

  it('rejects CSRF, invalid hosts, invalid inputs and oversized bodies', async () => {
    const port = await start(true);
    for (const method of ['POST', 'DELETE']) {
      expect(
        (await request(port, method, '/api/push/subscribe', sub(), { Origin: 'https://evil.example' }))
          .status,
      ).toBe(403);
    }
    expect((await request(port, 'GET', '/api/push/key', undefined, { Host: 'evil.example' })).status).toBe(
      421,
    );
    expect(
      (await request(port, 'POST', '/api/push/subscribe', { endpoint: 'https://localhost' })).status,
    ).toBe(400);
    expect((await request(port, 'POST', '/api/push/subscribe', { data: 'a'.repeat(5000) })).status).toBe(413);
    expect(
      (await request(port, 'POST', '/api/push/subscribe', sub(), { 'Content-Type': 'text/plain' })).status,
    ).toBe(415);
    expect((await request(port, 'PUT', '/api/push/subscribe', sub())).status).toBe(405);
  });

  it('disables routes in demo mode', async () => {
    const daemon = await runDaemon({ ...config, lan: false }, { demo: true, dataDir: dir });
    try {
      expect((await request(daemon.port, 'GET', '/api/push/key')).status).toBe(404);
      expect((await request(daemon.port, 'POST', '/api/push/subscribe', sub())).status).toBe(404);
      expect(await fs.readdir(dir)).toEqual([]);
    } finally {
      await daemon.close();
    }
  });
});
