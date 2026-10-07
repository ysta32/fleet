import { describe, it, expect, vi } from 'vitest';
import type { OvernightConfig, RawProject } from '../src/types.js';

vi.mock('../src/summarize/fallback.js', () => ({
  computeHealth: (p: RawProject) =>
    p.ciFailures.length > 0 ? 'red' : p.commits.length + p.mergedPRs.length > 0 ? 'green' : 'quiet',
  fallbackProjectSummary: (p: RawProject) => ({ summary: `fallback ${p.id}`, highlights: ['fb'] }),
  fallbackHeadline: () => 'fallback headline',
}));

const { createLlmSummarizer } = await import('../src/summarize/llm.js');

const actor = { login: 'bot[bot]', isBot: true };
function proj(id: string, commits: number, fails = 0): RawProject {
  return {
    id,
    name: id,
    url: `https://example.com/${id}`,
    mergedPRs: [],
    openPRs: [],
    commits: Array.from({ length: commits }, (_, i) => ({
      sha: String(i).padStart(40, '0'),
      message: `commit ${i}`,
      url: 'https://example.com/c',
      author: actor,
      at: '2026-10-07T01:00:00.000Z',
      branch: 'main',
    })),
    releases: [],
    ciFailures: Array.from({ length: fails }, (_, i) => ({
      workflow: 'ci',
      runId: i,
      url: 'https://example.com/r',
      branch: 'main',
      at: '2026-10-07T01:00:00.000Z',
      conclusion: 'failure' as const,
    })),
    issues: [],
    deployments: [],
  };
}

const config = { llm: { enabled: true, model: 'claude-sonnet-5-5', maxProjects: 2 } } as OvernightConfig;
const window = { since: '2026-10-06T00:00:00.000Z', until: '2026-10-07T00:00:00.000Z' };

function fake(result: unknown) {
  const parse = vi.fn(async (_p: Record<string, unknown>) => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { client: { messages: { parse } }, parse };
}

describe('createLlmSummarizer', () => {
  it('sends one request and merges LLM output, health stays deterministic', async () => {
    const { client, parse } = fake({
      stop_reason: 'end_turn',
      parsed_output: {
        headline: 'Quiet night, one failure.',
        projects: [
          { id: 'a/one', summary: 'Shipped things.', highlights: ['x'] },
          { id: 'a/two', summary: '  ', highlights: [] },
        ],
      },
    });
    const out = await createLlmSummarizer({ client }).summarize(
      [proj('a/one', 3), proj('a/two', 1, 1), proj('a/idle', 0)],
      window,
      config,
    );
    expect(parse).toHaveBeenCalledTimes(1);
    const req = parse.mock.calls[0]![0];
    expect(req.model).toBe('claude-sonnet-5-5');
    expect(req.output_config).toBeDefined();
    expect(req).not.toHaveProperty('thinking');
    expect(out.summarizer).toEqual({ kind: 'llm', model: 'claude-sonnet-5-5' });
    expect(out.headline).toBe('Quiet night, one failure.');
    const by = Object.fromEntries(out.projects.map((p) => [p.id, p]));
    expect(by['a/one']!.summary).toBe('Shipped things.');
    expect(by['a/one']!.health).toBe('green');
    expect(by['a/two']!.summary).toBe('fallback a/two');
    expect(by['a/two']!.health).toBe('red');
    expect(by['a/idle']!.summary).toBe('fallback a/idle');
    expect(by['a/idle']!.health).toBe('quiet');
  });

  it('skips quiet projects, respects maxProjects and caps commits at 20', async () => {
    const { client, parse } = fake({
      stop_reason: 'end_turn',
      parsed_output: { headline: 'h', projects: [] },
    });
    await createLlmSummarizer({ client }).summarize(
      [proj('a/big', 30), proj('a/mid', 5), proj('a/small', 1), proj('a/idle', 0)],
      window,
      config,
    );
    const content = JSON.parse(
      (parse.mock.calls[0]![0].messages as Array<{ content: string }>)[0]!.content,
    ) as { projects: Array<{ id: string; commits: unknown[] }> };
    expect(content.projects.map((p) => p.id)).toEqual(['a/big', 'a/mid']);
    expect(content.projects[0]!.commits).toHaveLength(20);
  });

  it('falls back on refusal', async () => {
    const { client } = fake({ stop_reason: 'refusal', parsed_output: null });
    const out = await createLlmSummarizer({ client }).summarize([proj('a/one', 1)], window, config);
    expect(out.summarizer).toEqual({ kind: 'fallback' });
    expect(out.projects[0]!.summary).toBe('fallback a/one');
    expect(out.headline).toBe('fallback headline');
  });

  it('falls back on null or malformed parsed_output', async () => {
    for (const parsed_output of [null, { nope: 1 }]) {
      const { client } = fake({ stop_reason: 'end_turn', parsed_output });
      const out = await createLlmSummarizer({ client }).summarize([proj('a/one', 1)], window, config);
      expect(out.summarizer).toEqual({ kind: 'fallback' });
    }
  });

  it('falls back when the client throws', async () => {
    const { client } = fake(new Error('boom'));
    const out = await createLlmSummarizer({ client }).summarize([proj('a/one', 1)], window, config);
    expect(out.summarizer).toEqual({ kind: 'fallback' });
    expect(out.projects[0]!.health).toBe('green');
  });

  it('falls back with no apiKey and no client', async () => {
    const out = await createLlmSummarizer({}).summarize([proj('a/one', 1)], window, config);
    expect(out.summarizer).toEqual({ kind: 'fallback' });
  });

  it('falls back without calling the API when every project is quiet', async () => {
    const { client, parse } = fake({ stop_reason: 'end_turn', parsed_output: null });
    const out = await createLlmSummarizer({ client }).summarize([proj('a/idle', 0)], window, config);
    expect(parse).not.toHaveBeenCalled();
    expect(out.summarizer).toEqual({ kind: 'fallback' });
  });
});
