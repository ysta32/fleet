import { randomBytes } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import webPush from 'web-push';
import type { Alert, FleetSnapshot } from '@fleet/shared';
import { redactSnapshot } from './server.js';

const MAX_SUBSCRIPTIONS = 20;
const COALESCE_MS = 30_000;

export class PushInputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function validatePushEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) {
    throw new PushInputError('invalid endpoint');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PushInputError('invalid endpoint');
  }
  const host = url.hostname;
  const allowed =
    host === 'fcm.googleapis.com' ||
    host === 'updates.push.services.mozilla.com' ||
    (host.endsWith('.push.apple.com') && host !== '.push.apple.com') ||
    (host.endsWith('.notify.windows.com') && host !== '.notify.windows.com');
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw new PushInputError('invalid endpoint');
  }
  return url.href;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PushInputError('invalid subscription');
  }
  return value as Record<string, unknown>;
}

function validKey(value: unknown, bytes: number): value is string {
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return (
    decoded.length === bytes &&
    decoded.toString('base64url') === value.replace(/=+$/, '') &&
    (bytes !== 65 || decoded[0] === 4)
  );
}

export function validatePushSubscription(value: unknown): webPush.PushSubscription {
  const input = record(value);
  const endpoint = validatePushEndpoint(input.endpoint);
  const keys = record(input.keys);
  if (!validKey(keys.p256dh, 65) || !validKey(keys.auth, 16)) {
    throw new PushInputError('invalid subscription keys');
  }
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export class PushManager {
  private readonly dir: string;
  private readonly salt = randomBytes(32);
  private queue: Promise<unknown> = Promise.resolve();
  private keys?: webPush.VapidKeys;
  private subscriptions?: webPush.PushSubscription[];
  private readonly sent = new Map<string, number>();

  constructor(
    dataDir: string,
    private readonly now: () => number = Date.now,
  ) {
    this.dir = path.join(dataDir, 'push');
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async read(name: string): Promise<unknown> {
    let file;
    try {
      file = await fs.open(path.join(this.dir, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
    try {
      await file.chmod(0o600);
      return JSON.parse(await file.readFile('utf8')) as unknown;
    } finally {
      await file.close();
    }
  }

  private async write(name: string, value: unknown): Promise<void> {
    const temp = path.join(this.dir, `.${name}-${randomBytes(8).toString('hex')}`);
    try {
      await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, path.join(this.dir, name));
    } finally {
      await fs.rm(temp, { force: true });
    }
  }

  private async init(): Promise<void> {
    if (this.keys && this.subscriptions) return;
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    if (!(await fs.lstat(this.dir)).isDirectory()) throw new Error('invalid push directory');
    await fs.chmod(this.dir, 0o700);
    const storedKeys = await this.read('vapid.json');
    if (storedKeys === undefined) {
      const keys = webPush.generateVAPIDKeys();
      await this.write('vapid.json', keys);
      this.keys = keys;
    } else {
      const keys = record(storedKeys);
      if (!validKey(keys.publicKey, 65) || !validKey(keys.privateKey, 32)) {
        throw new Error('invalid stored push keys');
      }
      this.keys = { publicKey: keys.publicKey, privateKey: keys.privateKey };
    }
    const storedSubs = await this.read('subs.json');
    if (storedSubs !== undefined && (!Array.isArray(storedSubs) || storedSubs.length > MAX_SUBSCRIPTIONS)) {
      throw new Error('invalid stored push subscriptions');
    }
    this.subscriptions = (storedSubs as unknown[] | undefined)?.map(validatePushSubscription) ?? [];
  }

  publicKey(): Promise<string> {
    return this.exclusive(async () => {
      await this.init();
      return this.keys!.publicKey;
    });
  }

  subscribe(input: unknown): Promise<void> {
    const sub = validatePushSubscription(input);
    return this.exclusive(async () => {
      await this.init();
      const next = this.subscriptions!.filter((s) => s.endpoint !== sub.endpoint);
      if (next.length >= MAX_SUBSCRIPTIONS) throw new PushInputError('subscription limit reached', 409);
      next.push(sub);
      await this.write('subs.json', next);
      this.subscriptions = next;
    });
  }

  unsubscribe(input: unknown): Promise<void> {
    const endpoint = validatePushEndpoint(record(input).endpoint);
    return this.exclusive(async () => {
      await this.init();
      const next = this.subscriptions!.filter((s) => s.endpoint !== endpoint);
      await this.write('subs.json', next);
      this.subscriptions = next;
    });
  }

  async send(alert: Alert, snapshot: FleetSnapshot): Promise<void> {
    if (snapshot.demo) return;
    const clean = redactSnapshot({ ...snapshot, alerts: [alert] }, this.salt).alerts[0]!;
    const tag = `${clean.kind}:${clean.projectId}`;
    const now = this.now();
    for (const [key, at] of this.sent) if (now - at >= COALESCE_MS) this.sent.delete(key);
    if (this.sent.has(tag)) return;
    this.sent.set(tag, now);
    const payload = JSON.stringify({ title: clean.title, body: clean.body, tag, url: '/' });
    const { subscriptions, keys } = await this.exclusive(async () => {
      await this.init();
      return { subscriptions: [...this.subscriptions!], keys: this.keys! };
    });
    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webPush.sendNotification(sub, payload, {
            vapidDetails: { subject: 'mailto:fleet@localhost', ...keys },
            TTL: 300,
            timeout: 10_000,
          });
        } catch (err) {
          const status = (err as { statusCode?: number } | null)?.statusCode;
          if (status !== 404 && status !== 410) throw new Error('push delivery failed');
          await this.exclusive(async () => {
            const next = this.subscriptions!.filter((s) => s !== sub);
            await this.write('subs.json', next);
            this.subscriptions = next;
          });
        }
      }),
    );
  }
}
