import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiUrl, connectLive, fetchHistory } from '../data/liveSource';

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

beforeEach(() => {
  vi.useFakeTimers();
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  vi.stubGlobal('window', {
    location: { origin: 'http://localhost:4501', search: '' },
    localStorage: { getItem: vi.fn(() => null) },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('live source', () => {
  it('encodes URL tokens and preserves history parameters', () => {
    window.location.search = '?token=a%26b';
    const url = new URL(apiUrl('/api/history?from=1&to=2'), window.location.origin);
    expect(url.searchParams.get('token')).toBe('a&b');
    expect(url.searchParams.get('from')).toBe('1');
    expect(url.searchParams.get('to')).toBe('2');
    expect(window.localStorage.getItem).not.toHaveBeenCalled();
  });
  it('uses stored authentication and tolerates unavailable storage', () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue('synthetic-token');
    expect(apiUrl('/api/events')).toBe('/api/events?token=synthetic-token');
    vi.mocked(window.localStorage.getItem).mockImplementation(() => {
      throw new Error('disabled');
    });
    expect(apiUrl('/api/events')).toBe('/api/events');
  });
  it('backs off, resets on connection, and cancels reconnection on teardown', () => {
    const handlers = { snapshot: vi.fn(), event: vi.fn(), connected: vi.fn() };
    const stop = connectLive(handlers);
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
    const stop = connectLive(handlers);
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
    await expect(fetchHistory(1, 2, controller.signal)).rejects.toThrow('History unavailable (401)');
    expect(fetch).toHaveBeenCalledWith('/api/history?from=1&to=2', { signal: controller.signal });
  });
});
