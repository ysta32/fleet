import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SpendConfig } from './contracts.js';

export const DEFAULT_CONFIG: SpendConfig = {
  budget: { monthlyUsd: null, warnAt: [0.5, 0.8] },
  anthropicAdminKeyEnv: 'ANTHROPIC_ADMIN_KEY',
  openaiAdminKeyEnv: 'OPENAI_ADMIN_KEY',
  apiIngest: false,
  paths: {},
  notify: { macos: true, fleet: true, ntfyUrl: '' },
  port: 4917,
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readConfig(path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Spend config must be a JSON object');
    }
    return object(value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function validBudget(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Expand a leading `~` or `~/` (not `~user`) against `home`; other values are returned unchanged. */
export function expandHome(value: string, home: string): string {
  if (value === '~') return home;
  if (value.startsWith('~/')) return join(home, value.slice(2));
  return value;
}

export function loadConfig(
  path = join(homedir(), '.config/fleet/spend.json'),
  home: string = homedir(),
): SpendConfig {
  const raw = readConfig(path);
  const config = structuredClone(DEFAULT_CONFIG);
  const budget = object(raw.budget);
  if (budget.monthlyUsd === null || validBudget(budget.monthlyUsd)) {
    config.budget.monthlyUsd = budget.monthlyUsd;
  }
  if (
    Array.isArray(budget.warnAt) &&
    budget.warnAt.every((value: unknown) => validBudget(value) && value > 0 && value < 1)
  ) {
    config.budget.warnAt = [...budget.warnAt];
  }
  for (const key of ['anthropicAdminKeyEnv', 'openaiAdminKeyEnv'] as const) {
    if (typeof raw[key] === 'string') config[key] = raw[key];
  }
  if (typeof raw.apiIngest === 'boolean') config.apiIngest = raw.apiIngest;
  const paths = object(raw.paths);
  for (const key of [
    'claudeProjectsDir',
    'codexSessionsDir',
    'cursorDbPath',
    'cursorExportPath',
    'copilotExportPath',
  ] as const) {
    const value = paths[key];
    if (typeof value === 'string') config.paths[key] = expandHome(value, home);
  }
  const notify = object(raw.notify);
  for (const key of ['macos', 'fleet'] as const) {
    if (typeof notify[key] === 'boolean') config.notify[key] = notify[key];
  }
  if (typeof notify.ntfyUrl === 'string') config.notify.ntfyUrl = notify.ntfyUrl;
  if (typeof raw.port === 'number' && Number.isInteger(raw.port) && raw.port >= 4500 && raw.port <= 4999) {
    config.port = raw.port;
  }
  return config;
}

export function saveBudget(
  monthlyUsd: number | null,
  path = join(homedir(), '.config/fleet/spend.json'),
): void {
  if (monthlyUsd !== null && !validBudget(monthlyUsd)) {
    throw new RangeError('Monthly budget must be a finite nonnegative number or null');
  }
  const raw = readConfig(path);
  raw.budget = { ...object(raw.budget), monthlyUsd };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
