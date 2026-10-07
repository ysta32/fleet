import { collect } from './collect/index.js';
import { loadConfig, readSecrets, resolveWindow } from './config.js';
import { deliverAll } from './deliver/index.js';
import { buildDigest } from './digest.js';
import { writeArchive } from './render/html.js';
import { loadState, saveState } from './state.js';
import { fallbackSummarizer } from './summarize/fallback.js';
import { createLlmSummarizer } from './summarize/llm.js';
import type { DeliveryResult, Digest, FetchLike, Secrets, StateSnapshot, Summarizer } from './types.js';

const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]+/g,
  /\bgithub_pat_[A-Za-z0-9_]+/g,
  /\bsk-ant-[A-Za-z0-9_-]+/g,
  /\bBearer\s+\S+/gi,
];

/** Replaces every configured secret value and anything that looks like a token with "[redacted]". */
export function redactSecrets(text: string, secrets: Secrets): string {
  let out = text;
  const values = Object.values(secrets)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const value of values) out = out.split(value).join('[redacted]');
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, '[redacted]');
  return out;
}

export interface RunOptions {
  since?: string;
  until?: string;
  configPath?: string;
  outDir?: string;
  llm?: boolean;
  deliver?: boolean;
  dryRun?: boolean;
  fetch?: FetchLike;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  log?: (m: string) => void;
}

export interface RunResult {
  digest: Digest;
  paths: string[];
  deliveries: DeliveryResult[];
}

function defaultFetch(): FetchLike {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('global fetch is unavailable: Node.js >= 20 is required');
  }
  return (url, init) => globalThis.fetch(url, init);
}

export async function runDigest(opts: RunOptions = {}): Promise<RunResult> {
  const sink = opts.log;
  const now = opts.now ?? new Date();
  const config = await loadConfig(opts.configPath, opts.outDir !== undefined ? { outDir: opts.outDir } : {});
  if (!config.owner) throw new Error('set OVERNIGHT_OWNER or owner in overnight.config.json');
  const secrets = readSecrets(opts.env ?? process.env);
  const log = (m: string): void => sink?.(redactSecrets(m, secrets));
  const state = await loadState(config.stateDir);
  const window = resolveWindow({ since: opts.since, until: opts.until }, state, config, now);
  const fetch = opts.fetch ?? defaultFetch();

  log(`overnight: collecting ${config.owner} from ${window.since} to ${window.until}`);
  const collected = await collect({ config, secrets, window, state, fetch, log });
  log(`overnight: collected ${collected.projects.length} projects (${collected.warnings.length} warnings)`);

  const useLlm = opts.llm !== false && config.llm.enabled && Boolean(secrets.anthropicApiKey);
  const summarizer: Summarizer = useLlm
    ? createLlmSummarizer({ apiKey: secrets.anthropicApiKey })
    : fallbackSummarizer;
  log(`overnight: summarizing with ${useLlm ? `LLM (${config.llm.model})` : 'fallback summarizer'}`);
  const summarized = await summarizer.summarize(collected.projects, window, config);

  const digest = buildDigest({
    config,
    window,
    projects: summarized.projects,
    headline: summarized.headline,
    summarizer: summarized.summarizer,
    // Warnings can embed HTTP error bodies; they are published in the archive, so scrub them.
    warnings: collected.warnings.map((w) => redactSecrets(w, secrets)),
    now,
  });

  if (opts.dryRun) {
    log('overnight: dry run, nothing written or delivered');
    return { digest, paths: [], deliveries: [] };
  }

  const paths = await writeArchive(digest, config.outDir, {
    siteTitle: config.siteTitle,
    timezone: config.timezone,
  });
  log(`overnight: wrote ${paths.length} files to ${config.outDir}`);

  let deliveries: DeliveryResult[] = [];
  if (opts.deliver !== false) {
    deliveries = await deliverAll(digest, config, secrets, fetch);
    for (const d of deliveries) log(`overnight: deliver ${d.channel} ${d.ok ? 'ok' : 'FAILED'}: ${d.detail}`);
  }

  // Keep snapshots of repos not seen this run (e.g. transient errors) so their deltas stay meaningful.
  const repoStats: StateSnapshot['repoStats'] = { ...state.repoStats };
  for (const p of digest.projects) {
    if (p.stats) repoStats[p.id] = { stars: p.stats.stars, forks: p.stats.forks };
  }
  await saveState(config.stateDir, { lastRunAt: window.until, repoStats });
  log(`overnight: state saved to ${config.stateDir}`);

  return { digest, paths, deliveries };
}
