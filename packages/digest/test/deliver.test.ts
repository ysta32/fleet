import { describe, it, expect, vi } from 'vitest';
import type { Digest, FetchLike, OvernightConfig, Secrets } from '../src/types.js';
import { deliverNotion } from '../src/deliver/notion.js';
import { deliverEmail } from '../src/deliver/email.js';
import { deliverNtfy } from '../src/deliver/ntfy.js';
import { deliverAll } from '../src/deliver/index.js';
import { renderEmailHtml, renderMarkdown, renderPlainText } from '../src/render/text.js';

function digest(): Digest {
  return {
    schema: 'overnight.digest/v1',
    id: '2026-10-07',
    owner: 'example',
    generatedAt: '2026-10-07T06:00:00Z',
    window: { since: '2026-10-06T06:00:00Z', until: '2026-10-07T06:00:00Z' },
    headline: 'Changes shipped.',
    summarizer: { kind: 'fallback' },
    totals: {
      projectsActive: 1,
      mergedPRs: 1,
      commits: 1,
      releases: 0,
      ciFailures: 1,
      openPRsNeedingAttention: 0,
      issuesOpened: 0,
      issuesClosed: 0,
      deployments: 0,
      deploymentsFailed: 0,
      starsDelta: 0,
      agentContributions: 1,
    },
    projects: [
      {
        id: 'example/app',
        name: 'app',
        url: 'https://example.test/app',
        mergedPRs: [],
        openPRs: [],
        commits: [],
        releases: [],
        ciFailures: [],
        issues: [],
        deployments: [],
        health: 'red',
        summary: 'A failed build.',
        highlights: ['Fix the build.'],
      },
    ],
    warnings: [],
  };
}

function config(): OvernightConfig {
  return {
    owner: 'example',
    include: [],
    exclude: [],
    includeForks: false,
    includeArchived: false,
    agents: [],
    timezone: 'UTC',
    defaultSince: '24h',
    staleDays: 7,
    vercelProjects: {},
    llm: { enabled: false, model: 'unused', maxProjects: 10 },
    outDir: 'out',
    stateDir: 'state',
    siteTitle: 'Overnight',
    siteUrl: 'https://example.test/archive/',
    deliver: {
      notion: { enabled: true, databaseId: 'database' },
      email: { enabled: true, from: 'digest@example.test', to: 'reader@example.test' },
      ntfy: { enabled: true, server: 'https://ntfy.example.test/', topic: 'overnight' },
    },
  };
}

const secrets: Secrets = {
  notionToken: 'fake-notion-secret',
  resendApiKey: 'fake-resend-secret',
  ntfyToken: 'fake-ntfy-secret',
  githubToken: 'fake-github-secret',
};
function response(status = 200, data: unknown = {}, text = ''): Awaited<ReturnType<FetchLike>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => data,
    text: async () => text,
  };
}
function fakeFetch() {
  return vi.fn<FetchLike>().mockResolvedValue(response());
}

describe('Notion delivery', () => {
  it('discovers the database title and Date properties before creating a page', async () => {
    const fetch = fakeFetch().mockResolvedValueOnce(
      response(200, { properties: { Title: { type: 'title' }, Date: { type: 'date' } } }),
    );
    expect(await deliverNotion(digest(), config(), secrets, fetch)).toMatchObject({
      channel: 'notion',
      ok: true,
    });
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://api.notion.com/v1/databases/database', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secrets.notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
    });
    expect(fetch.mock.calls[1]?.[0]).toBe('https://api.notion.com/v1/pages');
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('POST');
    const body = JSON.parse(fetch.mock.calls[1]![1]!.body!);
    expect(body.parent).toEqual({ database_id: 'database' });
    expect(body.properties.Title.title[0].text.content).toBe('2026-10-07 — Overnight');
    expect(body.properties.Date).toEqual({ date: { start: '2026-10-07' } });
    expect(body.children.map((block: { type: string }) => block.type)).toEqual([
      'heading_2',
      'paragraph',
      'heading_3',
      'paragraph',
      'bulleted_list_item',
      'paragraph',
    ]);
    expect(body.children[1].paragraph.rich_text[0].text.content).toBe('Changes shipped.');
    expect(body.children[3].paragraph.rich_text[0].text.content).toBe('A failed build.');
    expect(body.children[4].bulleted_list_item.rich_text[0].text.content).toBe('Fix the build.');
    expect(body.children[5].paragraph.rich_text[0].text.link.url).toBe(
      'https://example.test/archive/digests/2026-10-07.html',
    );
  });

  it('falls back to Name and omits Date if its type differs', async () => {
    const fetch = fakeFetch().mockResolvedValueOnce(
      response(200, { properties: { Date: { type: 'rich_text' } } }),
    );
    const c = config();
    delete c.siteUrl;
    expect((await deliverNotion(digest(), c, secrets, fetch)).ok).toBe(true);
    const body = JSON.parse(fetch.mock.calls[1]![1]!.body!);
    expect(Object.keys(body.properties)).toEqual(['Name']);
    expect(body.children).toHaveLength(5);
  });

  it('appends directly to a page and caps blocks and rich text while preserving the archive link', async () => {
    const c = config();
    c.deliver.notion = { enabled: true, pageId: 'page' };
    const d = digest();
    d.headline = 'a'.repeat(3000);
    d.projects = Array.from({ length: 60 }, () => ({
      ...d.projects[0]!,
      name: 'n'.repeat(3000),
      summary: 's'.repeat(3000),
      highlights: ['h'.repeat(3000)],
    }));
    const fetch = fakeFetch();
    expect((await deliverNotion(d, c, secrets, fetch)).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.notion.com/v1/blocks/page/children');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('PATCH');
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body!);
    expect(body.children).toHaveLength(100);
    expect(body.children[0].heading_2.rich_text[0].text.content).toBe('2026-10-07 — Overnight');
    for (const block of body.children)
      for (const rich of block[block.type].rich_text)
        expect(rich.text.content.length).toBeLessThanOrEqual(2000);
    expect(body.children[99].paragraph.rich_text[0].text.link.url).toContain('/digests/2026-10-07.html');
  });

  it('does not create a page after a failed database lookup', async () => {
    const fetch = fakeFetch().mockResolvedValue(response(403, {}, 'Forbidden'));
    expect(await deliverNotion(digest(), config(), secrets, fetch)).toMatchObject({
      ok: false,
      detail: 'HTTP 403: Forbidden',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports malformed database metadata', async () => {
    const fetch = fakeFetch().mockResolvedValue(response(200, null));
    expect(await deliverNotion(digest(), config(), secrets, fetch)).toMatchObject({
      ok: false,
      detail: 'invalid Notion database schema',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('email delivery', () => {
  it('sends both renderings and truncates the headline in the subject to 80 characters', async () => {
    const d = digest();
    d.headline = 'x'.repeat(100);
    const c = config();
    const fetch = fakeFetch();
    expect((await deliverEmail(d, c, secrets, fetch)).ok).toBe(true);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.resend.com/emails');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { Authorization: `Bearer ${secrets.resendApiKey}`, 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body!)).toEqual({
      from: c.deliver.email.from,
      to: c.deliver.email.to,
      subject: `Overnight — ${d.id}: ${'x'.repeat(80)}`,
      html: renderEmailHtml(d, { siteUrl: c.siteUrl }),
      text: renderMarkdown(d, { siteUrl: c.siteUrl }),
    });
  });
});

describe('ntfy delivery', () => {
  it('sends bounded plain text with red priority, optional auth and archive click headers', async () => {
    const d = digest();
    d.headline = 'x'.repeat(5000);
    const fetch = fakeFetch();
    expect((await deliverNtfy(d, config(), secrets, fetch)).ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('https://ntfy.example.test/overnight', {
      method: 'POST',
      headers: {
        Title: 'Overnight 2026-10-07',
        Tags: 'sunrise',
        Priority: '4',
        Markdown: 'yes',
        Click: 'https://example.test/archive/digests/2026-10-07.html',
        Authorization: `Bearer ${secrets.ntfyToken}`,
      },
      body: renderPlainText(d, 3500),
    });
    expect(fetch.mock.calls[0]![1]!.body!.length).toBeLessThanOrEqual(3500);
  });

  it('allows anonymous publishing without a site URL and uses normal priority', async () => {
    const d = digest();
    d.projects[0]!.health = 'green';
    const c = config();
    delete c.siteUrl;
    const fetch = fakeFetch();
    expect((await deliverNtfy(d, c, {}, fetch)).ok).toBe(true);
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({
      Title: 'Overnight 2026-10-07',
      Tags: 'sunrise',
      Priority: '3',
      Markdown: 'yes',
    });
  });
});

describe('delivery failures', () => {
  it('rejects missing required tokens without a request', async () => {
    const fetch = fakeFetch();
    expect((await deliverNotion(digest(), config(), {}, fetch)).detail).toBe('missing NOTION_TOKEN');
    expect((await deliverEmail(digest(), config(), {}, fetch)).detail).toBe('missing RESEND_API_KEY');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects missing channel configuration without a request', async () => {
    const fetch = fakeFetch();
    const c = config();
    delete c.deliver.notion.databaseId;
    expect((await deliverNotion(digest(), c, secrets, fetch)).ok).toBe(false);
    delete c.deliver.email.from;
    expect((await deliverEmail(digest(), c, secrets, fetch)).detail).toContain('from');
    c.deliver.email.from = 'digest@example.test';
    delete c.deliver.email.to;
    expect((await deliverEmail(digest(), c, secrets, fetch)).detail).toContain('to');
    delete c.deliver.ntfy.topic;
    expect((await deliverNtfy(digest(), c, secrets, fetch)).detail).toContain('topic');
    c.deliver.ntfy.topic = 'overnight';
    c.deliver.ntfy.server = '';
    expect((await deliverNtfy(digest(), c, secrets, fetch)).detail).toContain('server');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([deliverNotion, deliverEmail, deliverNtfy])(
    'bounds non-2xx bodies and redacts all provided secrets: %s',
    async (deliver) => {
      const c = config();
      c.deliver.notion = { enabled: true, pageId: 'page' };
      const fetch = fakeFetch().mockResolvedValue(
        response(429, {}, `${Object.values(secrets).join(' ')} ${'z'.repeat(500)}`),
      );
      const result = await deliver(digest(), c, secrets, fetch);
      expect(result.ok).toBe(false);
      expect(result.detail).toMatch(/^HTTP 429: /);
      expect(result.detail.length).toBeLessThanOrEqual('HTTP 429: '.length + 200);
      for (const secret of Object.values(secrets)) expect(result.detail).not.toContain(secret);
    },
  );

  it.each([deliverNotion, deliverEmail, deliverNtfy])(
    'contains fetch exceptions without leaking their messages: %s',
    async (deliver) => {
      const fetch = fakeFetch().mockRejectedValue(
        new Error(`failure ${secrets.notionToken} ${secrets.resendApiKey} ${secrets.ntfyToken}`),
      );
      const result = await deliver(digest(), config(), secrets, fetch);
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('failed');
      for (const secret of Object.values(secrets)) expect(result.detail).not.toContain(secret);
    },
  );
});

describe('deliverAll', () => {
  it('does no work for disabled channels', async () => {
    const c = config();
    for (const channel of Object.values(c.deliver)) channel.enabled = false;
    const fetch = fakeFetch();
    expect(await deliverAll(digest(), c, secrets, fetch)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('starts enabled channels concurrently and preserves successful deliveries when one fails', async () => {
    const c = config();
    c.deliver.notion = { enabled: true, pageId: 'page' };
    const pending: Array<(response: Awaited<ReturnType<FetchLike>>) => void> = [];
    const fetch = vi.fn<FetchLike>(() => new Promise((resolve) => pending.push(resolve)));
    const delivery = deliverAll(digest(), c, secrets, fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
    pending[2]!(response());
    pending[0]!(response(503, {}, 'Unavailable'));
    pending[1]!(response());
    expect(await delivery).toEqual([
      { channel: 'notion', ok: false, detail: 'HTTP 503: Unavailable' },
      { channel: 'email', ok: true, detail: 'email sent' },
      { channel: 'ntfy', ok: true, detail: 'notification sent' },
    ]);
  });

  it('only returns results for enabled channels even when requests throw', async () => {
    const c = config();
    c.deliver.notion.enabled = false;
    c.deliver.ntfy.enabled = false;
    const fetch = fakeFetch().mockRejectedValue(new Error('offline'));
    expect(await deliverAll(digest(), c, secrets, fetch)).toEqual([
      { channel: 'email', ok: false, detail: 'email delivery failed: request or response error' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
