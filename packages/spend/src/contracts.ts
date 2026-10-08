/**
 * FROZEN internal contracts for packages/spend. Tasks build against these; change only via DECISIONS.md.
 * Privacy: ingesters read local files READ-ONLY and keep only metadata (model, token counts, timestamps,
 * repo display name, branch, ids). Never retain or emit prompt/response text, tool inputs, or absolute paths.
 */
import type {
  SpendBudget,
  SpendSource,
  SpendSummary,
  SpendBrief,
  UsageRecord,
  SpendTokens,
} from '@fleet/shared';

export type { SpendBudget, SpendSource, SpendSummary, SpendBrief, UsageRecord, SpendTokens };

/* ---------------- config: ~/.config/fleet/spend.json (all fields optional on disk) ---------------- */
export interface SpendConfig {
  budget: SpendBudget; // default { monthlyUsd: null, warnAt: [0.5, 0.8] }
  /** Name of an environment variable holding an Anthropic Admin API key (sk-ant-admin...). Never a key itself.
   *  Only process.env[name] is read; .env files are never read. Default "ANTHROPIC_ADMIN_KEY". */
  anthropicAdminKeyEnv: string;
  /** Same for OpenAI admin key. Default "OPENAI_ADMIN_KEY". */
  openaiAdminKeyEnv: string;
  /** API ingestion is opt-in: only runs when true AND the env var is set. Default false. */
  apiIngest: boolean;
  /** Optional overrides of default local locations (tests point these at fixtures). */
  paths: {
    claudeProjectsDir?: string; // default ~/.claude/projects
    codexSessionsDir?: string; // default ~/.codex/sessions
    cursorDbPath?: string; // default ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
    cursorExportPath?: string; // user-downloaded usage CSV from cursor.com dashboard
    copilotExportPath?: string; // user-downloaded Copilot premium-request usage CSV
  };
  notify: {
    macos: boolean; // default true
    /** POST alerts to a running Fleet collector (http://127.0.0.1:4747) — Fleet itself pushes to ntfy. default true */
    fleet: boolean;
    /** optional direct ntfy topic URL for standalone use; default "" (disabled) */
    ntfyUrl: string;
  };
  /** standalone `fleet-spend serve` port, must be within 4500-4999. default 4917 */
  port: number;
}

/* ---------------- ingestion ---------------- */
export interface IngestContext {
  config: SpendConfig;
  /** home dir (tests pass a fixture dir) */
  home: string;
  now: number;
  /** only records with ts >= since are needed (ingesters may skip older files by mtime) */
  since: number;
  /** injected for API ingesters (tests pass a fake) */
  fetch: typeof fetch;
  /** injected env (tests pass {}); ingesters must not read process.env directly */
  env: Record<string, string | undefined>;
}

export interface IngestResult {
  source: SpendSource;
  records: UsageRecord[];
  status: 'ok' | 'missing' | 'error';
  /** short, path-free message */
  note?: string;
}

export type Ingester = (ctx: IngestContext) => Promise<IngestResult>;

/* ---------------- pricing ---------------- */
/** USD per million tokens. */
export interface ModelPrice {
  /** canonical id, e.g. "claude-sonnet-4-5" */
  id: string;
  provider: 'anthropic' | 'openai' | 'google' | 'other';
  /** lowercase substrings/prefixes that identify this model in raw ids; longest match wins */
  match: string[];
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  /** optional long-context tier: when input+cache tokens of a call exceed thresholdTokens, use these rates */
  longContext?: {
    thresholdTokens: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite5m: number;
    cacheWrite1h: number;
  };
  /** relative capability tier used by savings tips: 3 = top (opus-class), 2 = mid, 1 = small */
  tier: 1 | 2 | 3;
}

export interface PriceTable {
  /** e.g. "2026-10-01"; bump on any price change */
  version: string;
  models: ModelPrice[];
}

export interface PricedCost {
  costUsd: number;
  /** false when no table entry matched and no vendorCostUsd was present */
  priced: boolean;
  modelId?: string;
}

/* ---------------- analysis ---------------- */
export interface AnalyzeOptions {
  now: number;
  budget: SpendBudget;
  table: PriceTable;
  sources: SpendSummary['sources'];
}

/* Module map (who implements what):
 *  src/pricing/table.ts      export const PRICE_TABLE: PriceTable
 *  src/pricing/engine.ts     export function priceRecord(r: UsageRecord, table?: PriceTable): PricedCost
 *                            export function findModel(model: string, table?: PriceTable): ModelPrice | undefined
 *  src/ingest/claude.ts      export const ingestClaudeCode: Ingester
 *  src/ingest/codex.ts       export const ingestCodex: Ingester
 *  src/ingest/cursor.ts      export const ingestCursor: Ingester
 *  src/ingest/copilot.ts     export const ingestCopilot: Ingester
 *  src/ingest/api.ts         export const ingestAnthropicApi: Ingester; export const ingestOpenAiApi: Ingester
 *  src/analyze/summarize.ts  export function summarize(records: UsageRecord[], opts: AnalyzeOptions): SpendSummary
 *                            export function toBrief(records: UsageRecord[], summary: SpendSummary, opts: { now: number; table: PriceTable }): SpendBrief
 *  src/analyze/tips.ts       export function savingsTips(records: UsageRecord[], table: PriceTable, now: number): SavingsTip[]
 *  src/config.ts             export function loadConfig(path?: string): SpendConfig ; export const DEFAULT_CONFIG: SpendConfig
 *  src/index.ts              export function loadSpendSummary(opts?: {now?: number; configPath?: string}): Promise<SpendSummary>
 *                            export function loadSpendBrief(opts?: {now?: number; configPath?: string}): Promise<SpendBrief>
 *  src/notify.ts             export function dispatchAlerts(alerts: SpendAlert[], cfg: SpendConfig, statePath?: string): Promise<SpendAlert[]>
 *  src/cli.ts                bin: fleet-spend [summary|where|tips|budget set <usd>|watch|serve|json]
 *  src/web/index.ts          export { SpendTab, SpendSiteSection, DEMO_SUMMARY }
 */
