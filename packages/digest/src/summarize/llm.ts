import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { OvernightConfig, ProjectActivity, RawProject, Summarizer, TimeWindow } from '../types.js';
import { computeHealth, fallbackHeadline, fallbackProjectSummary } from './fallback.js';

/** Minimal subset of the Anthropic client used by the summarizer (structurally compatible with the SDK). */
export interface AnthropicLike {
  messages: {
    parse(params: Record<string, unknown>): PromiseLike<unknown>;
  };
}

const OutputSchema = z.object({
  headline: z.string(),
  projects: z.array(z.object({ id: z.string(), summary: z.string(), highlights: z.array(z.string()) })),
});

const ResponseSchema = z.object({
  stop_reason: z.string().nullish(),
  parsed_output: z.unknown().nullish(),
});

const SYSTEM_PROMPT = [
  'You write a calm, plain-language morning digest for a solo developer whose AI agents ship code overnight.',
  'You receive JSON describing the most active projects in the last window.',
  'Reply with a headline (1-2 sentences covering the whole night) and, for each project id, a summary of 1-3 sentences and up to 5 short highlights.',
  'Mention what changed for users, risky failures, and anything that needs a human.',
  'Use plain text only, no markdown. Never invent facts that are not in the input.',
  'Use each project id exactly as given.',
].join(' ');

const MAX_COMMITS = 20;
const MAX_HIGHLIGHTS = 5;

function volume(p: RawProject): number {
  return (
    p.mergedPRs.length +
    p.commits.length +
    p.releases.length +
    p.ciFailures.length +
    p.issues.length +
    p.deployments.length +
    p.openPRs.length
  );
}

function compactProject(p: RawProject): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    mergedPRs: p.mergedPRs.map((x) => ({
      title: x.title,
      bot: x.author.isBot,
      additions: x.additions,
      deletions: x.deletions,
    })),
    openPRsNeedingAttention: p.openPRs.map((x) => ({
      title: x.title,
      bot: x.author.isBot,
      attention: x.attention,
    })),
    commitCount: p.commits.length,
    commits: p.commits.slice(0, MAX_COMMITS).map((c) => ({ message: c.message, bot: c.author.isBot })),
    releases: p.releases.map((r) => ({ tag: r.tag, prerelease: r.prerelease })),
    ciFailures: p.ciFailures.map((f) => ({
      workflow: f.workflow,
      conclusion: f.conclusion,
      branch: f.branch,
    })),
    issues: p.issues.map((i) => ({ title: i.title, state: i.state })),
    deployments: p.deployments.map((d) => ({ target: d.target, state: d.state })),
    starsDelta: p.stats?.starsDelta,
  };
}

function toActivity(p: RawProject, summary: string, highlights: string[]): ProjectActivity {
  return { ...p, health: computeHealth(p), summary, highlights };
}

function fallbackResult(projects: RawProject[]): {
  projects: ProjectActivity[];
  headline: string;
  summarizer: { kind: 'fallback' };
} {
  const out = projects.map((p) => {
    const f = fallbackProjectSummary(p);
    return toActivity(p, f.summary, f.highlights);
  });
  return { projects: out, headline: fallbackHeadline(out), summarizer: { kind: 'fallback' } };
}

export function createLlmSummarizer(opts: { apiKey?: string; client?: AnthropicLike }): Summarizer {
  return {
    async summarize(projects: RawProject[], _window: TimeWindow, config: OvernightConfig) {
      const client: AnthropicLike | undefined =
        opts.client ??
        (opts.apiKey ? (new Anthropic({ apiKey: opts.apiKey }) as unknown as AnthropicLike) : undefined);
      if (!client) return fallbackResult(projects);

      const candidates = projects
        .filter((p) => computeHealth(p) !== 'quiet')
        .sort((a, b) => volume(b) - volume(a))
        .slice(0, Math.max(0, config.llm.maxProjects));
      if (candidates.length === 0) return fallbackResult(projects);

      try {
        const response = ResponseSchema.parse(
          await client.messages.parse({
            model: config.llm.model,
            max_tokens: 8000,
            output_config: { effort: 'low', format: zodOutputFormat(OutputSchema) },
            system: SYSTEM_PROMPT,
            messages: [
              { role: 'user', content: JSON.stringify({ projects: candidates.map(compactProject) }) },
            ],
          }),
        );
        if (response.stop_reason === 'refusal') return fallbackResult(projects);
        const parsed = OutputSchema.safeParse(response.parsed_output);
        if (!parsed.success) return fallbackResult(projects);

        const byId = new Map(parsed.data.projects.map((p) => [p.id, p]));
        let used = false;
        const merged = projects.map((p) => {
          const llm = byId.get(p.id);
          const summary = llm?.summary.trim();
          if (llm && summary) {
            used = true;
            return toActivity(p, summary, llm.highlights.filter((h) => h.trim()).slice(0, MAX_HIGHLIGHTS));
          }
          const f = fallbackProjectSummary(p);
          return toActivity(p, f.summary, f.highlights);
        });
        if (!used) return fallbackResult(projects);
        const headline = parsed.data.headline.trim() || fallbackHeadline(merged);
        return { projects: merged, headline, summarizer: { kind: 'llm' as const, model: config.llm.model } };
      } catch {
        // Any API/validation error degrades to the deterministic fallback; the digest must never fail.
        return fallbackResult(projects);
      }
    },
  };
}
