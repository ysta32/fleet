import { describe, expect, it } from 'vitest';
import type { IngestContext, SpendConfig } from '../contracts.js';
import { ingestAnthropicApi, ingestOpenAiApi } from './api.js';

const FAKE_ANTHROPIC_KEY = 'sk-ant-admin01-FAKEFAKEFAKE-test-only-0000';
const FAKE_OPENAI_KEY = 'sk-admin-FAKEFAKEFAKE-test-only-1111';

const config: SpendConfig = {
  budget: { monthlyUsd: null, warnAt: [0.5, 0.8] },
  anthropicAdminKeyEnv: 'TEST_ANTHROPIC_ADMIN',
  openaiAdminKeyEnv: 'TEST_OPENAI_ADMIN',
  apiIngest: true,
  paths: {},
  notify: { macos: false, fleet: false, ntfyUrl: '' },
  port: 4917,
};

interface Call {
  url: string;
  headers: Record<string, string>;
  hasSignal: boolean;
}

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      hasSignal: init?.signal instanceof AbortSignal,
    });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fn, calls };
}

const SINCE = Date.UTC(2026, 9, 1);

function ctx(over: Partial<IngestContext> & { fetch: typeof fetch }): IngestContext {
  return {
    config,
    home: '/nonexistent',
    now: Date.UTC(2026, 9, 7),
    since: SINCE,
    env: { TEST_ANTHROPIC_ADMIN: FAKE_ANTHROPIC_KEY, TEST_OPENAI_ADMIN: FAKE_OPENAI_KEY },
    ...over,
  };
}

describe('ingestAnthropicApi', () => {
  it('paginates and maps one record per bucket+model', async () => {
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        body: {
          data: [
            {
              starting_at: '2026-10-01T00:00:00Z',
              ending_at: '2026-10-02T00:00:00Z',
              results: [
                {
                  model: 'claude-sonnet-4-5-20250929',
                  uncached_input_tokens: 100,
                  cache_read_input_tokens: 50,
                  cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 5 },
                  output_tokens: 20,
                },
                { model: 'claude-opus-4-1', uncached_input_tokens: 0, output_tokens: 0 },
              ],
            },
          ],
          has_more: true,
          next_page: 'cursor-2',
        },
      },
      {
        status: 200,
        body: {
          data: [
            {
              starting_at: '2026-10-02T00:00:00Z',
              results: [{ model: 'claude-opus-4-1', uncached_input_tokens: 7, output_tokens: 3 }],
            },
          ],
          has_more: false,
          next_page: null,
        },
      },
    ]);
    const res = await ingestAnthropicApi(ctx({ fetch: fn }));
    expect(res.status).toBe('ok');
    expect(res.source).toBe('anthropic-api');
    expect(calls).toHaveLength(2);
    const u1 = new URL(calls[0]!.url);
    expect(u1.origin + u1.pathname).toBe('https://api.anthropic.com/v1/organizations/usage_report/messages');
    expect(u1.searchParams.get('starting_at')).toBe(new Date(SINCE).toISOString());
    expect(u1.searchParams.get('bucket_width')).toBe('1d');
    expect(u1.searchParams.getAll('group_by[]')).toEqual(['model']);
    expect(u1.searchParams.get('page')).toBeNull();
    expect(new URL(calls[1]!.url).searchParams.get('page')).toBe('cursor-2');
    expect(calls[0]!.headers['x-api-key']).toBe(FAKE_ANTHROPIC_KEY);
    expect(calls[0]!.headers['anthropic-version']).toBe('2023-06-01');
    expect(calls.every((c) => c.hasSignal)).toBe(true);
    expect(calls.every((c) => !c.url.includes(FAKE_ANTHROPIC_KEY))).toBe(true);

    expect(res.records).toEqual([
      {
        id: `anthropic-api:${Date.UTC(2026, 9, 1)}:claude-sonnet-4-5-20250929`,
        source: 'anthropic-api',
        ts: Date.UTC(2026, 9, 1),
        model: 'claude-sonnet-4-5-20250929',
        tokens: { input: 100, output: 20, cacheRead: 50, cacheWrite5m: 10, cacheWrite1h: 5 },
      },
      {
        id: `anthropic-api:${Date.UTC(2026, 9, 2)}:claude-opus-4-1`,
        source: 'anthropic-api',
        ts: Date.UTC(2026, 9, 2),
        model: 'claude-opus-4-1',
        tokens: { input: 7, output: 3, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
      },
    ]);
    expect(res.note).toMatch(/overlap/);
    expect(JSON.stringify(res)).not.toContain(FAKE_ANTHROPIC_KEY);
  });

  it('is missing (no fetch) when apiIngest is false', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { data: [] } }]);
    const res = await ingestAnthropicApi(ctx({ fetch: fn, config: { ...config, apiIngest: false } }));
    expect(res.status).toBe('missing');
    expect(res.records).toEqual([]);
    expect(res.note).toContain('apiIngest');
    expect(res.note).toContain('TEST_ANTHROPIC_ADMIN');
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(res)).not.toContain(FAKE_ANTHROPIC_KEY);
  });

  it('is missing (no fetch) when the key env var is unset', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { data: [] } }]);
    const res = await ingestAnthropicApi(ctx({ fetch: fn, env: {} }));
    expect(res.status).toBe('missing');
    expect(res.note).toContain('TEST_ANTHROPIC_ADMIN');
    expect(calls).toHaveLength(0);
  });

  it('maps HTTP 401 to an error without leaking the key or body', async () => {
    const { fn } = fakeFetch([
      { status: 401, body: { error: { message: `invalid x-api-key ${FAKE_ANTHROPIC_KEY}` } } },
    ]);
    const res = await ingestAnthropicApi(ctx({ fetch: fn }));
    expect(res.status).toBe('error');
    expect(res.note).toBe('HTTP 401');
    expect(res.records).toEqual([]);
    expect(JSON.stringify(res)).not.toContain(FAKE_ANTHROPIC_KEY);
  });

  it('reports a generic error when fetch rejects with a message containing the key', async () => {
    const fn = (async () => {
      throw new TypeError(`fetch failed for ${FAKE_ANTHROPIC_KEY}`);
    }) as typeof fetch;
    const res = await ingestAnthropicApi(ctx({ fetch: fn }));
    expect(res.status).toBe('error');
    expect(JSON.stringify(res)).not.toContain(FAKE_ANTHROPIC_KEY);
  });

  it('reports a timeout distinctly', async () => {
    const fn = (async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as typeof fetch;
    const res = await ingestAnthropicApi(ctx({ fetch: fn }));
    expect(res).toMatchObject({ status: 'error', note: 'request timed out' });
  });

  it('stops on a repeated pagination cursor instead of looping forever', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { data: [], has_more: true, next_page: 'same' } }]);
    const res = await ingestAnthropicApi(ctx({ fetch: fn }));
    expect(res.status).toBe('error');
    expect(calls.length).toBe(2);
  });
});

describe('ingestOpenAiApi', () => {
  it('paginates, splits cached input, and uses Bearer auth', async () => {
    const t1 = Date.UTC(2026, 9, 1) / 1000;
    const t2 = Date.UTC(2026, 9, 2) / 1000;
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        body: {
          object: 'page',
          data: [
            {
              object: 'bucket',
              start_time: t1,
              end_time: t2,
              results: [
                { model: 'gpt-5-codex', input_tokens: 1000, input_cached_tokens: 400, output_tokens: 50 },
              ],
            },
          ],
          has_more: true,
          next_page: 'page_2',
        },
      },
      {
        status: 200,
        body: {
          object: 'page',
          data: [
            {
              start_time: t2,
              results: [{ model: 'gpt-5', input_tokens: 10, input_cached_tokens: 0, output_tokens: 5 }],
            },
          ],
          has_more: false,
          next_page: null,
        },
      },
    ]);
    const res = await ingestOpenAiApi(ctx({ fetch: fn }));
    expect(res.status).toBe('ok');
    expect(calls).toHaveLength(2);
    const u1 = new URL(calls[0]!.url);
    expect(u1.origin + u1.pathname).toBe('https://api.openai.com/v1/organization/usage/completions');
    expect(u1.searchParams.get('start_time')).toBe(String(SINCE / 1000));
    expect(u1.searchParams.get('bucket_width')).toBe('1d');
    expect(u1.searchParams.get('group_by')).toBe('model');
    expect(new URL(calls[1]!.url).searchParams.get('page')).toBe('page_2');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${FAKE_OPENAI_KEY}`);
    expect(calls.every((c) => c.hasSignal)).toBe(true);
    expect(res.records).toEqual([
      {
        id: `openai-api:${t1 * 1000}:gpt-5-codex`,
        source: 'openai-api',
        ts: t1 * 1000,
        model: 'gpt-5-codex',
        tokens: { input: 600, output: 50, cacheRead: 400, cacheWrite5m: 0, cacheWrite1h: 0 },
      },
      {
        id: `openai-api:${t2 * 1000}:gpt-5`,
        source: 'openai-api',
        ts: t2 * 1000,
        model: 'gpt-5',
        tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
      },
    ]);
    expect(JSON.stringify(res)).not.toContain(FAKE_OPENAI_KEY);
  });

  it('is missing when the OpenAI key env var is unset', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: {} }]);
    const res = await ingestOpenAiApi(ctx({ fetch: fn, env: { TEST_ANTHROPIC_ADMIN: FAKE_ANTHROPIC_KEY } }));
    expect(res.status).toBe('missing');
    expect(res.note).toContain('TEST_OPENAI_ADMIN');
    expect(calls).toHaveLength(0);
  });

  it('maps HTTP 401 to an error without leaking the key', async () => {
    const { fn } = fakeFetch([{ status: 401, body: { error: { message: `bad key ${FAKE_OPENAI_KEY}` } } }]);
    const res = await ingestOpenAiApi(ctx({ fetch: fn }));
    expect(res).toMatchObject({ status: 'error', note: 'HTTP 401', records: [] });
    expect(JSON.stringify(res)).not.toContain(FAKE_OPENAI_KEY);
  });
});

describe('independent provider gating', () => {
  it('runs OpenAI without an Anthropic key and vice versa', async () => {
    const okBody = { status: 200, body: { data: [], has_more: false } };
    const onlyOpenAi = { TEST_OPENAI_ADMIN: FAKE_OPENAI_KEY };
    const a1 = fakeFetch([okBody]);
    const o1 = fakeFetch([okBody]);
    expect((await ingestAnthropicApi(ctx({ fetch: a1.fn, env: onlyOpenAi }))).status).toBe('missing');
    expect((await ingestOpenAiApi(ctx({ fetch: o1.fn, env: onlyOpenAi }))).status).toBe('ok');
    expect(a1.calls).toHaveLength(0);
    expect(o1.calls).toHaveLength(1);

    const onlyAnthropic = { TEST_ANTHROPIC_ADMIN: FAKE_ANTHROPIC_KEY };
    const a2 = fakeFetch([okBody]);
    const o2 = fakeFetch([okBody]);
    expect((await ingestAnthropicApi(ctx({ fetch: a2.fn, env: onlyAnthropic }))).status).toBe('ok');
    expect((await ingestOpenAiApi(ctx({ fetch: o2.fn, env: onlyAnthropic }))).status).toBe('missing');
    expect(a2.calls).toHaveLength(1);
    expect(o2.calls).toHaveLength(0);
  });
});
