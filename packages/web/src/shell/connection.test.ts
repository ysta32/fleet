import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLegacyToken, probeCollector } from './connection';

afterEach(() => vi.unstubAllGlobals());

describe('legacy token cleanup', () => {
  it('removes fleet.token from localStorage', () => {
    const removeItem = vi.fn();
    vi.stubGlobal('window', { localStorage: { removeItem } });
    clearLegacyToken();
    expect(removeItem).toHaveBeenCalledWith('fleet.token');
  });

  it('survives unavailable storage', () => {
    vi.stubGlobal('window', {
      localStorage: {
        removeItem: () => {
          throw new Error('denied');
        },
      },
    });
    expect(() => clearLegacyToken()).not.toThrow();
  });

  it('never sends a stored token as a bearer header', async () => {
    const getItem = vi.fn(() => 'stored-secret');
    vi.stubGlobal('window', { localStorage: { getItem, removeItem: vi.fn() } });
    const fetchMock = vi.fn(async () => ({ status: 200, ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(probeCollector()).resolves.toBe('ok');
    expect(getItem).not.toHaveBeenCalled();
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toBeUndefined();
  });
});
