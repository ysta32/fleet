import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disablePush, enablePush } from './subscribe';

function setup(opts: { existing?: boolean; post?: () => Response | Promise<Response>; del?: Response }) {
  let current: { endpoint: string; toJSON(): unknown; unsubscribe: ReturnType<typeof vi.fn> } | null = null;
  const make = () => {
    const sub = {
      endpoint: 'https://push.example/e1',
      toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe: vi.fn(async () => {
        current = null;
        return true;
      }),
    };
    return sub;
  };
  if (opts.existing) current = make();
  const subscribe = vi.fn(async () => (current = make()));
  const pushManager = { getSubscription: vi.fn(async () => current), subscribe };
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve({ pushManager }) } });
  vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => 'granted') });
  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    if (url === '/api/push/key') return new Response(JSON.stringify({ publicKey: 'aGk' }), { status: 200 });
    if (init?.method === 'DELETE') return opts.del ?? new Response('{}', { status: 200 });
    return opts.post ? opts.post() : new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    subscribe,
    fetchMock,
    get current() {
      return current;
    },
  };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('enablePush', () => {
  it('subscribes and posts on success', async () => {
    const env = setup({});
    expect(await enablePush()).toEqual({ ok: true, subscribed: true });
    expect(env.subscribe).toHaveBeenCalledOnce();
  });
  it('rolls back the new subscription when POST is non-2xx', async () => {
    const env = setup({ post: () => new Response('no', { status: 500 }) });
    const result = await enablePush();
    expect(result).toMatchObject({ ok: false, subscribed: false });
    expect(env.current).toBeNull();
  });
  it('rolls back the new subscription when POST rejects', async () => {
    const env = setup({
      post: () => {
        throw new Error('network down');
      },
    });
    const result = await enablePush();
    expect(result).toMatchObject({ ok: false, error: 'network down', subscribed: false });
    expect(env.current).toBeNull();
  });
  it('does not unsubscribe a pre-existing subscription when POST fails', async () => {
    const env = setup({ existing: true, post: () => new Response('no', { status: 500 }) });
    const result = await enablePush();
    expect(result).toMatchObject({ ok: false, subscribed: true });
    expect(env.subscribe).not.toHaveBeenCalled();
    expect(env.current).not.toBeNull();
  });
});

describe('disablePush', () => {
  it('unsubscribes and deletes', async () => {
    const env = setup({ existing: true });
    expect(await disablePush()).toEqual({ ok: true, subscribed: false });
    expect(env.fetchMock).toHaveBeenCalledWith(
      '/api/push/subscribe',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
  it('surfaces a non-2xx DELETE and reports the real state', async () => {
    setup({ existing: true, del: new Response('x', { status: 503 }) });
    const result = await disablePush();
    expect(result).toMatchObject({ ok: false, subscribed: false });
    expect(result.ok === false && result.error).toContain('503');
  });
});
