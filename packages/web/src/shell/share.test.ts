import { describe, expect, it, vi } from 'vitest';
import { fetchShareUrl, parseShareUrl } from './share';

describe('parseShareUrl', () => {
  it('accepts a LAN or Tailscale http URL', () => {
    expect(parseShareUrl({ shareUrl: 'http://192.168.1.9:4747/' })).toBe('http://192.168.1.9:4747/');
    expect(parseShareUrl({ shareUrl: 'http://100.101.102.103:4747/' })).toBe('http://100.101.102.103:4747/');
  });
  it('never returns a token, credentials or loopback address', () => {
    expect(parseShareUrl({ shareUrl: 'http://192.168.1.9:4747/?token=secret#x' })).toBe(
      'http://192.168.1.9:4747/',
    );
    expect(parseShareUrl({ shareUrl: 'http://u:p@192.168.1.9:4747/' })).toBeNull();
    for (const host of ['localhost', '127.0.0.1', '[::1]'])
      expect(parseShareUrl({ shareUrl: `http://${host}:4747/` })).toBeNull();
  });
  it('rejects missing, malformed or non-http values', () => {
    for (const body of [
      null,
      'x',
      {},
      { shareUrl: 4 },
      { shareUrl: '' },
      { shareUrl: 'not a url' },
      { shareUrl: 'javascript:alert(1)' },
    ])
      expect(parseShareUrl(body)).toBeNull();
  });
});

describe('fetchShareUrl', () => {
  it('reads shareUrl from /api/health', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, shareUrl: 'http://10.0.0.2:4747/' })),
    );
    expect(await fetchShareUrl(fetcher as unknown as typeof fetch)).toBe('http://10.0.0.2:4747/');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });
  it('is null when absent, on errors, or when unreachable', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    expect(await fetchShareUrl(ok as unknown as typeof fetch)).toBeNull();
    const denied = vi.fn(async () => new Response('{}', { status: 401 }));
    expect(await fetchShareUrl(denied as unknown as typeof fetch)).toBeNull();
    const down = vi.fn(async () => {
      throw new TypeError('network');
    });
    expect(await fetchShareUrl(down as unknown as typeof fetch)).toBeNull();
  });
});
