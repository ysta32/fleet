/**
 * FROZEN Fleet Spend contract (agreed with the Fleet lead).
 * Produced by the `fleet-spend` package; consumed by the collector (snapshot.spend, GET /api/spend),
 * the web Spend tab and the visualizer tint.
 *
 * Privacy: nothing in these types may carry prompt/response text or filesystem paths.
 * Repos are identified by a display name (basename or "owner/name"), never an absolute path.
 */

export type SpendSource = 'claude-code' | 'codex' | 'cursor' | 'copilot' | 'anthropic-api' | 'openai-api';

/** Token counts for one model call (or an aggregate). */
export interface SpendTokens {
  input: number;
  output: number;
  cacheRead: number;
  /** cache writes with 5-minute TTL (Anthropic) or generic cache writes */
  cacheWrite5m: number;
  /** cache writes with 1-hour TTL (Anthropic) */
  cacheWrite1h: number;
}

/** One normalized usage record. Ingesters emit these; never contains prompt text. */
export interface UsageRecord {
  /** stable dedupe key, e.g. `${source}:${requestId}` */
  id: string;
  source: SpendSource;
  /** epoch ms */
  ts: number;
  /** raw model id as reported, e.g. "claude-sonnet-4-5-20250929", "gpt-5-codex" */
  model: string;
  tokens: SpendTokens;
  /** display name only, never a path */
  repo?: string;
  branch?: string;
  sessionId?: string;
  /** orch army (project/run id) and task id, when detectable */
  army?: string;
  task?: string;
  /** cost already computed by the vendor (e.g. Copilot export, API cost report); overrides engine pricing */
  vendorCostUsd?: number;
  /** premium requests (Copilot) */
  requests?: number;
}

export interface SpendBucket {
  key: string;
  costUsd: number;
  tokens: SpendTokens;
  records: number;
}

export type SpendDimension = 'repo' | 'branch' | 'session' | 'army' | 'task' | 'day' | 'model' | 'source';

export interface SavingsTip {
  id: string;
  title: string;
  detail: string;
  /** estimated monthly saving in USD */
  estMonthlySavingsUsd: number;
}

export interface SpendAlert {
  id: string;
  level: 'warn' | 'over';
  title: string;
  body: string;
  at: number;
}

export interface SpendBudget {
  /** monthly budget in USD; null = none */
  monthlyUsd: number | null;
  /** fraction thresholds that trigger 'warn' alerts, default [0.5, 0.8] ; 1.0 triggers 'over' */
  warnAt: number[];
}

export interface SpendSummary {
  generatedAt: number;
  /** price table version used, e.g. "2026-10-01" */
  priceTableVersion: string;
  /** start of the current calendar month (local time), epoch ms */
  monthStart: number;
  monthToDateUsd: number;
  todayUsd: number;
  forecastMonthEndUsd: number;
  burnUsdPerHour: number;
  budget: SpendBudget;
  /** breakdowns for the current month, sorted by costUsd desc, at most 50 per dimension */
  breakdown: Record<SpendDimension, SpendBucket[]>;
  /** daily totals for the last 31 days, oldest first; key = YYYY-MM-DD */
  daily: SpendBucket[];
  tips: SavingsTip[];
  alerts: SpendAlert[];
  /** which sources produced data and any non-fatal problems (no paths) */
  sources: { source: SpendSource; records: number; status: 'ok' | 'missing' | 'error'; note?: string }[];
  /** models seen with no price entry (cost counted as 0) */
  unpricedModels: string[];
}

/** Compact form embedded in FleetSnapshot.spend. */
export interface SpendBrief {
  generatedAt: number;
  monthToDateUsd: number;
  forecastMonthEndUsd: number;
  budgetUsd: number | null;
  burnUsdPerHour: number;
  /** keyed by Claude Code session id; USD/hour over the last hour */
  sessionBurn: Record<string, number>;
  /** keyed by repo display name; USD/hour over the last hour */
  projectBurn: Record<string, number>;
  alerts: SpendAlert[];
}

export type BurnTint = 'idle' | 'cool' | 'warm' | 'hot';

/** Shared thresholds so visualizer and CLI agree: 0 idle, <2 cool, <10 warm, >=10 hot (USD/hour). */
export function burnTint(usdPerHour: number): BurnTint {
  if (!(usdPerHour > 0)) return 'idle';
  if (usdPerHour < 2) return 'cool';
  if (usdPerHour < 10) return 'warm';
  return 'hot';
}
