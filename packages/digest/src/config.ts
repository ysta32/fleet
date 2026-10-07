import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ISODate, OvernightConfig, Secrets, StateSnapshot, TimeWindow } from './types.js';

const configSchema = z.object({
  owner: z.string(),
  include: z.array(z.string()),
  exclude: z.array(z.string()),
  includeForks: z.boolean(),
  includeArchived: z.boolean(),
  agents: z.array(z.string()),
  timezone: z.string(),
  defaultSince: z.string(),
  staleDays: z.number().nonnegative(),
  vercelProjects: z.record(z.string(), z.string()),
  vercelTeamId: z.string().optional(),
  llm: z.object({ enabled: z.boolean(), model: z.string(), maxProjects: z.number().int().nonnegative() }),
  outDir: z.string(),
  stateDir: z.string(),
  siteTitle: z.string(),
  siteUrl: z.string().optional(),
  deliver: z.object({
    notion: z.object({
      enabled: z.boolean(),
      databaseId: z.string().optional(),
      pageId: z.string().optional(),
    }),
    email: z.object({ enabled: z.boolean(), to: z.string().optional(), from: z.string().optional() }),
    ntfy: z.object({ enabled: z.boolean(), topic: z.string().optional(), server: z.string() }),
  }),
});

export function defaultConfig(owner?: string): OvernightConfig {
  return {
    owner: owner ?? (process.env.OVERNIGHT_OWNER || ''),
    include: [],
    exclude: [],
    includeForks: false,
    includeArchived: false,
    agents: [],
    timezone: process.env.TZ || 'UTC',
    defaultSince: '24h',
    staleDays: 3,
    vercelProjects: {},
    llm: { enabled: true, model: 'claude-sonnet-5-5', maxProjects: 25 },
    outDir: process.env.OVERNIGHT_OUT || join(homedir(), '.overnight', 'archive'),
    stateDir: process.env.OVERNIGHT_STATE || join(homedir(), '.overnight', 'state'),
    siteTitle: 'Overnight',
    deliver: {
      notion: { enabled: false },
      email: { enabled: false },
      ntfy: { enabled: false, server: 'https://ntfy.sh' },
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function merge(base: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    [...new Set([...Object.keys(base), ...Object.keys(next)])].map((key) => {
      const value = Object.hasOwn(next, key) ? next[key] : undefined;
      const previous = Object.hasOwn(base, key) ? base[key] : undefined;
      return [
        key,
        value === undefined
          ? previous
          : isObject(previous) && isObject(value)
            ? merge(previous, value)
            : value,
      ];
    }),
  );
}

export async function loadConfig(
  path?: string,
  overrides?: Partial<OvernightConfig>,
): Promise<OvernightConfig> {
  let file: unknown = {};
  try {
    file = JSON.parse(await readFile(path ?? 'overnight.config.json', 'utf8'));
  } catch (error) {
    if (path !== undefined || !isObject(error) || error.code !== 'ENOENT') throw error;
  }
  if (!isObject(file)) throw new Error('Config must be a JSON object');
  let merged = merge(merge({ ...defaultConfig() }, file), { ...overrides });
  const env = process.env;
  const environment: Record<string, unknown> = {};
  for (const [key, variable] of Object.entries({
    owner: 'OVERNIGHT_OWNER',
    outDir: 'OVERNIGHT_OUT',
    stateDir: 'OVERNIGHT_STATE',
    siteUrl: 'OVERNIGHT_SITE_URL',
  })) {
    if (env[variable]) environment[key] = env[variable];
  }
  for (const [key, variable] of Object.entries({
    include: 'OVERNIGHT_INCLUDE',
    exclude: 'OVERNIGHT_EXCLUDE',
  })) {
    if (env[variable] !== undefined)
      environment[key] = env[variable]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  }
  const deliver: Record<string, unknown> = {};
  if (env.OVERNIGHT_NTFY_TOPIC) deliver.ntfy = { enabled: true, topic: env.OVERNIGHT_NTFY_TOPIC };
  if (env.OVERNIGHT_NOTION_DATABASE_ID || env.OVERNIGHT_NOTION_PAGE_ID) {
    deliver.notion = {
      enabled: true,
      databaseId: env.OVERNIGHT_NOTION_DATABASE_ID || undefined,
      pageId: env.OVERNIGHT_NOTION_PAGE_ID || undefined,
    };
  }
  if (env.OVERNIGHT_EMAIL_TO || env.OVERNIGHT_EMAIL_FROM) {
    deliver.email = {
      enabled: true,
      to: env.OVERNIGHT_EMAIL_TO || undefined,
      from: env.OVERNIGHT_EMAIL_FROM || undefined,
    };
  }
  environment.deliver = deliver;
  merged = merge(merged, environment);
  return configSchema.parse(merged);
}

export function readSecrets(env: NodeJS.ProcessEnv = process.env): Secrets {
  return {
    githubToken: env.OVERNIGHT_GITHUB_TOKEN || env.GH_TOKEN || env.GITHUB_TOKEN || undefined,
    vercelToken: env.VERCEL_TOKEN || undefined,
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    notionToken: env.NOTION_TOKEN || undefined,
    resendApiKey: env.RESEND_API_KEY || undefined,
    ntfyToken: env.NTFY_TOKEN || undefined,
  };
}

export function parseDuration(s: string): number {
  const match = /^(\d+(?:\.\d+)?)([mhdw])$/.exec(s);
  const units: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  const unit = match?.[2] === undefined ? undefined : units[match[2]];
  const value = match && unit !== undefined ? Number(match[1]) * unit : NaN;
  if (!Number.isFinite(value) || value <= 0)
    throw new Error('Invalid duration: expected a positive number followed by m, h, d, or w');
  return value;
}

function timestamp(value: string): number {
  const result = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) || !Number.isFinite(result))
    throw new Error('Invalid ISO date');
  return result;
}

export function resolveWindow(
  opts: { since?: string; until?: string },
  state: StateSnapshot,
  config: OvernightConfig,
  now = new Date(),
): TimeWindow {
  const current = now.getTime();
  if (!Number.isFinite(current)) throw new Error('Invalid current date');
  const until = opts.until === undefined ? current : timestamp(opts.until);
  let since: number;
  if (opts.since !== undefined) {
    since = /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(opts.since)
      ? timestamp(opts.since)
      : current - parseDuration(opts.since);
  } else {
    since =
      state.lastRunAt === undefined
        ? current - parseDuration(config.defaultSince)
        : timestamp(state.lastRunAt);
  }
  since = Math.max(since, current - 14 * 86_400_000);
  if (since > until) throw new Error('Window since must not be after until');
  return { since: new Date(since).toISOString(), until: new Date(until).toISOString() };
}

export function matchRepo(name: string, config: OvernightConfig): boolean {
  const matches = (pattern: string): boolean =>
    new RegExp(
      `^${pattern
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`,
      'i',
    ).test(name);
  return !config.exclude.some(matches) && (config.include.length === 0 || config.include.some(matches));
}

export function digestDateKey(until: ISODate, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp(until)));
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)!.value).join('-');
}
