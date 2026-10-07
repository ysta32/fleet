import { homedir } from 'node:os';
import { join } from 'node:path';
import { toBrief } from './analyze/summarize.js';
import { analyze, collect } from './collect.js';
import { loadConfig } from './config.js';
import type { SpendBrief, SpendConfig, SpendSummary, UsageRecord } from './contracts.js';
import { PRICE_TABLE } from './pricing/table.js';

export type * from './contracts.js';
export { summarize, toBrief } from './analyze/summarize.js';
export { savingsTips } from './analyze/tips.js';
export { priceRecord, findModel } from './pricing/engine.js';
export { PRICE_TABLE } from './pricing/table.js';
export { DEFAULT_CONFIG, loadConfig, saveBudget } from './config.js';
export { collect, analyze } from './collect.js';
export type { CollectOptions, CollectResult } from './collect.js';
export { dispatchAlerts } from './notify.js';

export interface LoadOptions {
  now?: number;
  configPath?: string;
}

/** Internal: also lets the CLI/server inject a home, env and fetch. */
export interface LoadDeps {
  home?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
}

export interface Loaded {
  config: SpendConfig;
  records: UsageRecord[];
  summary: SpendSummary;
  brief: SpendBrief;
}

export function defaultConfigPath(home: string = homedir()): string {
  return join(home, '.config/fleet/spend.json');
}

export async function loadAll(opts: LoadOptions = {}, deps: LoadDeps = {}): Promise<Loaded> {
  const now = opts.now ?? Date.now();
  const home = deps.home ?? homedir();
  const config = loadConfig(opts.configPath ?? defaultConfigPath(home), home);
  const collected = await collect({ now, config, home, env: deps.env, fetch: deps.fetch });
  const summary = analyze(collected, config, now);
  const brief = toBrief(collected.records, summary, { now, table: PRICE_TABLE });
  return { config, records: collected.records, summary, brief };
}

export async function loadSpendSummary(opts: LoadOptions = {}): Promise<SpendSummary> {
  return (await loadAll(opts)).summary;
}

export async function loadSpendBrief(opts: LoadOptions = {}): Promise<SpendBrief> {
  return (await loadAll(opts)).brief;
}
