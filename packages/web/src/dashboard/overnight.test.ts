import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../digest/fixtures/demo-digest.json';
import {
  fetchDigest,
  getDemoDigest,
  getDemoDigestHistory,
  parseDigest,
  safeDigestUrl,
  summarizeDigest,
  formatWindow,
} from './overnight';

describe('overnight digest', () => {
  it('maps the synthetic fixture without changing its project order', () => {
    const digest = parseDigest(fixture);
    const before = digest.projects.map((project) => project.id);
    const model = summarizeDigest(digest);
    expect(model.headline).toBe(fixture.headline);
    expect(model.metrics.map((metric) => metric.value)).toEqual([12, 23, 0, 3, 9, 19]);
    expect(model.needsAttention).toBe(5);
    expect(model.from).toBe(Date.parse(fixture.window.since));
    expect(model.to).toBe(Date.parse(fixture.window.until));
    expect(model.projects[0].health).toBe('red');
    expect(model.projects.at(-1)?.health).toBe('quiet');
    expect(digest.projects.map((project) => project.id)).toEqual(before);
    expect(getDemoDigest()).toEqual(digest);
  });

  it('keeps merged PRs and CI failures from the fixture', () => {
    const digest = parseDigest(fixture);
    expect(digest.projects.flatMap((project) => project.mergedPRs)).toHaveLength(12);
    expect(digest.projects.flatMap((project) => project.ciFailures)).toHaveLength(3);
    expect(digest.projects[0].mergedPRs[0]).toEqual({
      number: fixture.projects[0].mergedPRs[0].number,
      title: fixture.projects[0].mergedPRs[0].title,
      url: fixture.projects[0].mergedPRs[0].url,
      at: fixture.projects[0].mergedPRs[0].at,
    });
  });

  it('maps release fields without depending on unconsumed fields', () => {
    const pr = fixture.projects[0].mergedPRs[0];
    const release = { tag: String(pr.number), name: pr.title, url: pr.url, at: pr.at };
    const digest = parseDigest({ ...fixture, projects: [{ ...fixture.projects[0], releases: [release] }] });
    expect(digest.projects[0].releases).toEqual([release]);
  });

  it('builds synthetic replay in the exact fixture window without future merges', () => {
    const history = getDemoDigestHistory();
    expect(history.from).toBe(Date.parse(fixture.window.since));
    expect(history.to).toBe(Date.parse(fixture.window.until));
    expect(history.events).toHaveLength(15);
    expect(history.events.map((event) => event.ts)).toEqual(
      history.events.map((event) => event.ts).sort((a, b) => a - b),
    );
    expect(history.frames[0].prs).toHaveLength(0);
    expect(history.frames.at(-1)?.prs).toHaveLength(12);
    for (const frame of history.frames) {
      expect(frame.demo).toBe(true);
      expect(frame.projects.every((project) => project.path === '')).toBe(true);
      expect(frame.prs.every((pr) => pr.updatedAt <= frame.generatedAt)).toBe(true);
    }
  });

  it('supports a quiet digest and ignores additive fields', () => {
    const digest = parseDigest({ ...fixture, projects: [], futureField: true });
    expect(summarizeDigest(digest).needsAttention).toBe(0);
    expect(summarizeDigest(digest).projects).toEqual([]);
  });

  it.each([
    null,
    { ...fixture, schema: 'overnight.digest/v2' },
    { ...fixture, window: { since: 'invalid', until: fixture.window.until } },
    { ...fixture, window: { since: fixture.window.until, until: fixture.window.since } },
    { ...fixture, totals: { ...fixture.totals, mergedPRs: -1 } },
    { ...fixture, totals: { ...fixture.totals, commits: 1.5 } },
    { ...fixture, projects: [{ ...fixture.projects[0], health: 'unknown' }] },
    { ...fixture, projects: [{ ...fixture.projects[0], mergedPRs: [null] }] },
    { ...fixture, projects: [{ ...fixture.projects[0], ciFailures: 'invalid' }] },
    { ...fixture, headline: {} },
  ])('rejects malformed consumed fields', (value) => {
    expect(() => parseDigest(value)).toThrow('The overnight digest could not be read.');
  });

  it('accepts a negative star delta', () => {
    expect(parseDigest({ ...fixture, totals: { ...fixture.totals, starsDelta: -4 } }).totals.starsDelta).toBe(
      -4,
    );
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,test',
    '/local',
    'file:///private/example',
    'https://user:pass@example.com',
  ])('does not link unsafe URLs: %s', (url) => {
    expect(safeDigestUrl(url)).toBeUndefined();
  });
  it('links the fixture PR URL', () => {
    const url = fixture.projects[0].mergedPRs[0].url;
    expect(safeDigestUrl(url)).toBe(url);
  });

  it('fetches with same-origin credentials and passes the abort signal', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fixture)));
    const controller = new AbortController();
    expect(await fetchDigest(controller.signal, request)).toEqual(parseDigest(fixture));
    expect(request).toHaveBeenCalledWith('/api/digest/latest', {
      signal: controller.signal,
      credentials: 'same-origin',
    });
  });

  it('maps only 404 to the first-run state', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    expect(await fetchDigest(undefined, request)).toBeNull();
    request.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(fetchDigest(undefined, request)).rejects.toThrow('The overnight digest could not be read.');
  });

  it('returns a fixed path-free error for server, network and malformed JSON failures', async () => {
    const request = vi.fn<typeof fetch>();
    for (const response of [
      new Response('private server details', { status: 500 }),
      new Response('not JSON'),
      new Response('{}'),
    ]) {
      request.mockResolvedValue(response);
      await expect(fetchDigest(undefined, request)).rejects.toThrow(
        /^The overnight digest could not be read\.$/,
      );
    }
    request.mockRejectedValue(new Error('/private/example failed'));
    await expect(fetchDigest(undefined, request)).rejects.toThrow(
      /^The overnight digest could not be read\.$/,
    );
  });
});

describe('formatWindow', () => {
  it('formats a cross-midnight window with its span', () => {
    const from = new Date(2026, 9, 6, 22, 0).getTime();
    const to = new Date(2026, 9, 7, 7, 30).getTime();
    expect(formatWindow(from, to)).toBe('Oct 6, 22:00 → Oct 7, 07:30 · 9h 30m');
  });
  it('drops the repeated date for a same-day window', () => {
    const from = new Date(2026, 9, 7, 1, 0).getTime();
    const to = new Date(2026, 9, 7, 3, 0).getTime();
    expect(formatWindow(from, to)).toBe('Oct 7, 01:00 → 03:00 · 2h');
  });
  it('never shows a negative span', () => {
    const at = new Date(2026, 9, 7, 3, 0).getTime();
    expect(formatWindow(at, at - 1000)).toBe('Oct 7, 03:00 → 02:59 · 0m');
  });
});
