import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { DEMO_SUMMARY } from './web/index.js';
import { loopbackHost, startServer, validPort, type RunningServer } from './serve.js';
import type { SpendBrief } from './contracts.js';

const brief: SpendBrief = {
  generatedAt: DEMO_SUMMARY.generatedAt,
  monthToDateUsd: DEMO_SUMMARY.monthToDateUsd,
  forecastMonthEndUsd: DEMO_SUMMARY.forecastMonthEndUsd,
  budgetUsd: DEMO_SUMMARY.budget.monthlyUsd,
  burnUsdPerHour: DEMO_SUMMARY.burnUsdPerHour,
  sessionBurn: {},
  projectBurn: {},
  alerts: [],
};

async function start(
  load: () => Promise<{ summary: typeof DEMO_SUMMARY; brief: SpendBrief }>,
  clock?: () => number,
) {
  let last: unknown;
  for (let i = 0; i < 20; i++) {
    try {
      return await startServer({ port: 4990 + Math.floor(Math.random() * 10), load, clock });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      last = error;
    }
  }
  throw last;
}

function get(s: RunningServer, path: string, host = `127.0.0.1:${s.port}`, method = 'GET') {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>(
    (resolve, reject) => {
      const req = request(
        // agent: false: no pooled keep-alive socket from an earlier test's (closed) server on the same port
        { host: '127.0.0.1', port: s.port, path, method, headers: { Host: host }, agent: false },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
        },
      );
      req.on('error', reject);
      req.end();
    },
  );
}

describe('serve', () => {
  it('validates loopback Host headers', () => {
    expect(loopbackHost('127.0.0.1:4917', 4917)).toBe(true);
    expect(loopbackHost('localhost:4917', 4917)).toBe(true);
    expect(loopbackHost('[::1]:4917', 4917)).toBe(true);
    expect(loopbackHost('localhost', 4917)).toBe(true);
    expect(loopbackHost('localhost:80', 4917)).toBe(false);
    expect(loopbackHost('evil.example:4917', 4917)).toBe(false);
    expect(loopbackHost('127.0.0.1.evil.example', 4917)).toBe(false);
    expect(loopbackHost(undefined, 4917)).toBe(false);
  });

  it('refuses ports outside 4500-4999', async () => {
    const load = async () => ({ summary: DEMO_SUMMARY, brief });
    await expect(startServer({ port: 0, load })).rejects.toThrow(RangeError);
    await expect(startServer({ port: 5000, load })).rejects.toThrow(RangeError);
  });

  it('accepts the whole 4500-4999 range', () => {
    expect([4499, 4500, 4585, 4917, 4999, 5000].map(validPort)).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it('serves JSON, the page, guards Host, and caches for 30s', async () => {
    let loads = 0;
    let t = 1_000;
    const s = await start(
      async () => {
        loads++;
        return { summary: DEMO_SUMMARY, brief };
      },
      () => t,
    );
    try {
      expect(s.server.address()).toMatchObject({ address: '127.0.0.1' });
      const spend = await get(s, '/api/spend');
      expect(spend.status).toBe(200);
      expect(JSON.parse(spend.body)).toEqual(DEMO_SUMMARY);
      expect(spend.headers['access-control-allow-origin']).toBeUndefined();
      expect(JSON.parse((await get(s, '/api/brief')).body)).toEqual(brief);
      expect(loads).toBe(1);
      t += 30_000;
      await get(s, '/api/spend');
      expect(loads).toBe(2);

      const html = await get(s, '/');
      expect(html.status).toBe(200);
      expect(html.headers['content-type']).toContain('text/html');
      expect(html.body).toMatch(/<div id="root"><div /);
      expect(html.body).not.toContain('Install react');
      expect(html.body).toContain('/api/spend');
      expect(String(html.headers['content-security-policy'])).toContain("frame-ancestors 'none'");

      expect((await get(s, '/api/spend', 'evil.example')).status).toBe(403);
      expect((await get(s, '/api/spend', `attacker.test:${s.port}`)).status).toBe(403);
      expect((await get(s, '/nope')).status).toBe(404);
      expect((await get(s, '/api/spend', undefined, 'POST')).status).toBe(405);
    } finally {
      await s.close();
    }
  });

  it('returns 500 without details when collection fails, then retries', async () => {
    let fail = true;
    const s = await start(async () => {
      if (fail) throw new Error('/Users/someone/secret broke');
      return { summary: DEMO_SUMMARY, brief };
    });
    try {
      const bad = await get(s, '/api/spend');
      expect(bad.status).toBe(500);
      expect(bad.body).not.toContain('/Users');
      fail = false;
      expect((await get(s, '/api/spend')).status).toBe(200);
    } finally {
      await s.close();
    }
  });
});
