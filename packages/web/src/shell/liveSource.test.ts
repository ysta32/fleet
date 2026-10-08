import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let liveSource: typeof import('../data/liveSource');
const handlers = () => ({ snapshot: vi.fn(), event: vi.fn(), connected: vi.fn() });

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  listeners = new Map<string, (event: { data: string }) => void>();
  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }
  addEventListener(name: string, callback: (event: { data: string }) => void) {
    this.listeners.set(name, callback);
  }
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  vi.stubGlobal('window', {
    location: new URL('http://localhost:4501/'),
    history: { state: { route: 'fleet' }, replaceState: vi.fn() },
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
  });
  liveSource = await import('../data/liveSource');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('live source', () => {
  it('strips shell bootstrap tokens and uses the cookie for every connection', async () => {
    window.location.href = 'http://localhost:4501/?demo=0&token=a%26b#fleet';
    vi.resetModules();
    liveSource = await import('../data/liveSource');
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    expect(window.history.replaceState).toHaveBeenCalledWith({ route: 'fleet' }, '', '/?demo=0#fleet');
    expect(window.localStorage.getItem).not.toHaveBeenCalled();
    expect(liveSource.apiUrl('/api/history?from=1&to=2')).toBe('/api/history?from=1&to=2');
    const stop = liveSource.connectLive(handlers());
    expect(MockEventSource.instances[0].url).toBe('/api/events');
    MockEventSource.instances[0].onerror?.();
    vi.advanceTimersByTime(1000);
    expect(MockEventSource.instances[1].url).toBe('/api/events');
    MockEventSource.instances[1].onopen?.();
    MockEventSource.instances[1].onerror?.();
    vi.advanceTimersByTime(1000);
    expect(MockEventSource.instances[2].url).toBe('/api/events');
    stop();
    const stopAgain = liveSource.connectLive(handlers());
    expect(MockEventSource.instances[3].url).toBe('/api/events');
    stopAgain();
  });
  it('never appends stored tokens on reconnect', () => {
    const stop = liveSource.connectLive(handlers());
    expect(MockEventSource.instances[0].url).toBe('/api/events');
    vi.mocked(window.localStorage.getItem).mockReturnValue('stored-token');
    MockEventSource.instances[0].onerror?.();
    vi.advanceTimersByTime(1000);
    expect(MockEventSource.instances[1].url).toBe('/api/events');
    expect(window.localStorage.getItem).not.toHaveBeenCalled();
    MockEventSource.instances[1].onopen?.();
    MockEventSource.instances[1].onerror?.();
    vi.advanceTimersByTime(1000);
    expect(MockEventSource.instances[2].url).toBe('/api/events');
    stop();
  });
  it('ignores legacy stored tokens on the first connection', async () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue('synthetic-token');
    vi.resetModules();
    liveSource = await import('../data/liveSource');
    expect(window.localStorage.getItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem).not.toHaveBeenCalledWith('token');
    const stop = liveSource.connectLive(handlers());
    expect(MockEventSource.instances[0].url).toBe('/api/events');
    stop();
  });
  it('strips bootstrap links without depending on storage', async () => {
    window.location.href = 'http://localhost:4501/?token=synthetic';
    vi.mocked(window.localStorage.setItem).mockImplementation(() => {
      throw new Error('disabled');
    });
    vi.resetModules();
    liveSource = await import('../data/liveSource');
    expect(window.history.replaceState).toHaveBeenCalledWith({ route: 'fleet' }, '', '/');
    const stop = liveSource.connectLive(handlers());
    expect(MockEventSource.instances[0].url).toBe('/api/events');
    MockEventSource.instances[0].onerror?.();
    vi.advanceTimersByTime(1000);
    expect(MockEventSource.instances[1].url).toBe('/api/events');
    stop();
  });
  it('tolerates unavailable storage without a URL token', async () => {
    vi.mocked(window.localStorage.getItem).mockImplementation(() => {
      throw new Error('disabled');
    });
    vi.resetModules();
    liveSource = await import('../data/liveSource');
    const stop = liveSource.connectLive(handlers());
    expect(MockEventSource.instances[0].url).toBe('/api/events');
    stop();
  });
  it('backs off, resets on connection, and cancels reconnection on teardown', () => {
    const handlers = { snapshot: vi.fn(), event: vi.fn(), connected: vi.fn() };
    const stop = liveSource.connectLive(handlers);
    const first = MockEventSource.instances[0];
    expect(first.url).toBe('/api/events');
    first.onerror?.();
    expect(first.close).toHaveBeenCalled();
    expect(handlers.connected).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(999);
    expect(MockEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    MockEventSource.instances[1].onerror?.();
    vi.advanceTimersByTime(1999);
    expect(MockEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    const third = MockEventSource.instances[2];
    third.onopen?.();
    expect(handlers.connected).toHaveBeenLastCalledWith(true);
    third.onerror?.();
    vi.advanceTimersByTime(1000);
    expect(MockEventSource.instances).toHaveLength(4);
    MockEventSource.instances[3].onerror?.();
    stop();
    vi.advanceTimersByTime(60000);
    expect(MockEventSource.instances).toHaveLength(4);
  });
  it('routes named events and reconnects after malformed JSON', () => {
    const handlers = { snapshot: vi.fn(), event: vi.fn(), connected: vi.fn() };
    const stop = liveSource.connectLive(handlers);
    const source = MockEventSource.instances[0];
    source.listeners.get('snapshot')?.({ data: '{"version":1}' });
    source.listeners.get('fleet')?.({ data: '{"id":"synthetic"}' });
    expect(handlers.snapshot).toHaveBeenCalledWith({ version: 1 });
    expect(handlers.event).toHaveBeenCalledWith({ id: 'synthetic' });
    source.listeners.get('fleet')?.({ data: '{' });
    expect(handlers.event).toHaveBeenCalledTimes(1);
    expect(source.close).toHaveBeenCalled();
    stop();
  });
  it('rejects failed history requests and forwards cancellation', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    await expect(liveSource.fetchHistory(1, 2, controller.signal)).rejects.toThrow(
      'History unavailable (401)',
    );
    expect(fetch).toHaveBeenCalledWith('/api/history?from=1&to=2', {
      signal: controller.signal,
      credentials: 'same-origin',
    });
  });
});
