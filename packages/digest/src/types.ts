/**
 * Overnight — frozen data contracts.
 *
 * The `Digest` object is the public JSON output format (schema id "overnight.digest/v1").
 * It is written to `<out>/digests/YYYY-MM-DD.json` and `<out>/latest.json`, and is the
 * integration surface for embedders such as ysta32/fleet. Additive changes only within v1.
 * See docs/json-format.md and schema/digest.v1.json.
 */

export const DIGEST_SCHEMA = 'overnight.digest/v1' as const;

/** ISO-8601 UTC timestamp string, e.g. "2026-10-07T06:00:00.000Z". */
export type ISODate = string;

export interface TimeWindow {
  since: ISODate;
  until: ISODate;
}

export interface Actor {
  login: string;
  /** True when the login looks like a bot / AI agent (e.g. ends with "[bot]", or listed in config.agents). */
  isBot: boolean;
}

export interface PullRequestItem {
  number: number;
  title: string;
  url: string;
  author: Actor;
  /** For merged PRs: merge time. For open PRs: last update time. */
  at: ISODate;
  additions?: number;
  deletions?: number;
  labels: string[];
  draft?: boolean;
  /** Open PRs only: why it needs attention. */
  attention?: Array<'review_requested' | 'ci_failing' | 'stale' | 'conflicts' | 'approved_unmerged'>;
}

export interface CommitItem {
  sha: string; // full sha
  message: string; // first line only
  url: string;
  author: Actor;
  at: ISODate;
  branch: string;
}

export interface ReleaseItem {
  tag: string;
  name: string;
  url: string;
  at: ISODate;
  prerelease: boolean;
  /** Plain-text body, truncated to 2000 chars. */
  notes?: string;
}

export interface CIFailureItem {
  workflow: string;
  runId: number;
  url: string;
  branch: string;
  at: ISODate;
  conclusion: 'failure' | 'timed_out' | 'cancelled' | 'startup_failure';
  commitMessage?: string;
}

export interface IssueItem {
  number: number;
  title: string;
  url: string;
  author: Actor;
  at: ISODate;
  state: 'opened' | 'closed';
  labels: string[];
}

export interface DeploymentItem {
  id: string;
  project: string;
  url: string;
  target: 'production' | 'preview';
  state: 'READY' | 'ERROR' | 'CANCELED' | 'BUILDING' | 'QUEUED';
  at: ISODate;
  commitMessage?: string;
  branch?: string;
}

export interface TrafficStats {
  /** GitHub repo traffic (requires push access) or Vercel analytics; omitted if unavailable. */
  views?: number;
  uniqueVisitors?: number;
  source: 'github' | 'vercel';
}

export interface RepoStats {
  stars: number;
  forks: number;
  starsDelta: number; // vs previous digest snapshot; 0 when no snapshot
  forksDelta: number;
  openIssues: number;
}

export type ProjectHealth = 'green' | 'yellow' | 'red' | 'quiet';

export interface ProjectActivity {
  /** "owner/name" for GitHub repos; Vercel-only projects use "vercel:<project>". */
  id: string;
  name: string;
  url: string;
  description?: string;
  defaultBranch?: string;
  vercelProject?: string;
  siteUrl?: string;
  mergedPRs: PullRequestItem[];
  openPRs: PullRequestItem[]; // only those needing attention
  commits: CommitItem[]; // default-branch commits in window
  releases: ReleaseItem[];
  ciFailures: CIFailureItem[];
  issues: IssueItem[];
  deployments: DeploymentItem[];
  traffic?: TrafficStats;
  stats?: RepoStats;
  health: ProjectHealth;
  /** Plain-language summary (LLM or fallback). Markdown-free, 1–4 sentences. */
  summary: string;
  /** Up to 5 short bullet highlights. */
  highlights: string[];
}

export interface DigestTotals {
  projectsActive: number;
  mergedPRs: number;
  commits: number;
  releases: number;
  ciFailures: number;
  openPRsNeedingAttention: number;
  issuesOpened: number;
  issuesClosed: number;
  deployments: number;
  deploymentsFailed: number;
  starsDelta: number;
  /** Count of merged PRs + commits authored by bots/agents. */
  agentContributions: number;
}

export interface Digest {
  schema: typeof DIGEST_SCHEMA;
  /** YYYY-MM-DD (in config.timezone) of `window.until`; the archive key. */
  id: string;
  generatedAt: ISODate;
  window: TimeWindow;
  owner: string;
  /** Overall plain-language headline (1–2 sentences). */
  headline: string;
  summarizer: { kind: 'llm'; model: string } | { kind: 'fallback' };
  totals: DigestTotals;
  /** Sorted: red first, then by activity volume desc; quiet projects last. */
  projects: ProjectActivity[];
  /** Repos skipped due to errors (e.g. 403), with reason. */
  warnings: string[];
}

/** Archive index written to `<out>/index.json`. */
export interface DigestIndex {
  schema: 'overnight.index/v1';
  owner: string;
  updatedAt: ISODate;
  digests: Array<{ id: string; headline: string; window: TimeWindow; totals: DigestTotals; path: string }>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface OvernightConfig {
  /** GitHub user or org whose repos are scanned. */
  owner: string;
  /** Glob-ish patterns ("*" wildcard) matched against repo name (no owner). Empty = all. */
  include: string[];
  exclude: string[];
  includeForks: boolean;
  includeArchived: boolean;
  /** Extra logins treated as agents/bots (in addition to *[bot]). */
  agents: string[];
  /** IANA timezone for the digest date + rendering. */
  timezone: string;
  /** Default window when no previous digest exists, e.g. "24h". */
  defaultSince: string;
  /** Open PRs untouched for this many days are "stale". */
  staleDays: number;
  /** Map Vercel project name -> GitHub repo name, when auto-linking via git metadata fails. */
  vercelProjects: Record<string, string>;
  vercelTeamId?: string;
  llm: { enabled: boolean; model: string; maxProjects: number };
  /** Output directory for HTML/JSON archive. */
  outDir: string;
  /** Directory for state (last run, star snapshots). */
  stateDir: string;
  siteTitle: string;
  /** Public base URL of the deployed archive, used in links from Notion/email/ntfy. */
  siteUrl?: string;
  deliver: {
    notion: { enabled: boolean; databaseId?: string; pageId?: string };
    email: { enabled: boolean; to?: string; from?: string };
    ntfy: { enabled: boolean; topic?: string; server: string };
  };
}

/** Secrets come ONLY from environment variables; never from config files. */
export interface Secrets {
  githubToken?: string; // GITHUB_TOKEN or OVERNIGHT_GITHUB_TOKEN (preferred)
  vercelToken?: string; // VERCEL_TOKEN
  anthropicApiKey?: string; // ANTHROPIC_API_KEY
  notionToken?: string; // NOTION_TOKEN
  resendApiKey?: string; // RESEND_API_KEY
  ntfyToken?: string; // NTFY_TOKEN (optional, for protected topics)
}

// ---------------------------------------------------------------------------
// Module contracts (implementations must match these signatures)
// ---------------------------------------------------------------------------

/** Raw per-project data before summarization (summary/highlights/health filled later). */
export type RawProject = Omit<ProjectActivity, 'summary' | 'highlights' | 'health'>;

export interface StateSnapshot {
  lastRunAt?: ISODate;
  /** repo id -> {stars, forks} at last run. */
  repoStats: Record<string, { stars: number; forks: number }>;
}

/** Minimal fetch type so collectors are testable with a fake. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface CollectContext {
  config: OvernightConfig;
  secrets: Secrets;
  window: TimeWindow;
  state: StateSnapshot;
  fetch: FetchLike;
  log: (msg: string) => void;
}

export interface CollectResult {
  projects: RawProject[];
  warnings: string[];
}

export interface Summarizer {
  /** Fills summary/highlights/health; returns full projects + headline. Must never throw: degrade to fallback. */
  summarize(
    projects: RawProject[],
    window: TimeWindow,
    config: OvernightConfig,
  ): Promise<{
    projects: ProjectActivity[];
    headline: string;
    summarizer: Digest['summarizer'];
  }>;
}

export interface DeliveryResult {
  channel: 'notion' | 'email' | 'ntfy';
  ok: boolean;
  detail: string; // never include tokens
}
