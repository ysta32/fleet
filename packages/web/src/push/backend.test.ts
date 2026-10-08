import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoPushBackend, pushBackend } from './backend';
import { disablePush, enablePush, isSubscribed } from './subscribe';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pushBackend', () => {
  it('uses real Web Push outside demo', () => {
    const real = pushBackend(false);
    expect(real.needsSupport).toBe(true);
    expect(real.enable).toBe(enablePush);
    expect(real.disable).toBe(disablePush);
    expect(real.isSubscribed).toBe(isSubscribed);
  });

  it('simulates demo alerts without permission prompts, push subscriptions or network calls', async () => {
    const requestPermission = vi.fn(async () => 'granted');
    const subscribe = vi.fn();
    const getSubscription = vi.fn(async () => null);
    const fetchMock = vi.fn();
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    vi.stubGlobal('navigator', {
      serviceWorker: { ready: Promise.resolve({ pushManager: { subscribe, getSubscription } }) },
    });
    vi.stubGlobal('fetch', fetchMock);

    const demo = pushBackend(true);
    expect(demo.needsSupport).toBe(false);
    expect(await demo.isSubscribed()).toBe(false);
    expect(await demo.enable()).toEqual({ ok: true, subscribed: true });
    expect(await demo.isSubscribed()).toBe(true);
    expect(await demo.disable()).toEqual({ ok: true, subscribed: false });
    expect(await demo.isSubscribed()).toBe(false);

    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(getSubscription).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps each demo backend state separate', async () => {
    const a = demoPushBackend();
    const b = demoPushBackend();
    await a.enable();
    expect(await b.isSubscribed()).toBe(false);
  });
});
