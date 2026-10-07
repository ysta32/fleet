#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig, readSecrets } from './config.js';
import { syntheticArchive } from './demo/synthetic.js';
import { writeArchive } from './render/html.js';
import { redactSecrets, runDigest, type RunResult } from './run.js';
import type { FetchLike } from './types.js';

export interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  env?: NodeJS.ProcessEnv;
  /** Base directory for relative paths and `init`; defaults to process.cwd(). */
  cwd?: string;
  fetch?: FetchLike;
  now?: Date;
}

export class UsageError extends Error {}

const USAGE = `Usage:
  overnight [run] [--since 24h|ISO] [--until ISO] [--config path] [--out dir]
                  [--no-llm] [--no-deliver] [--dry-run] [--json]
  overnight demo [--out public] [--days 14] [--date YYYY-MM-DD]
  overnight init [--config path]
  overnight --help | --version

Secrets are read from the environment only (OVERNIGHT_GITHUB_TOKEN, VERCEL_TOKEN,
ANTHROPIC_API_KEY, NOTION_TOKEN, RESEND_API_KEY, NTFY_TOKEN).`;

type Command = 'run' | 'demo' | 'init';

const VALUE_FLAGS: Record<Command, readonly string[]> = {
  run: ['since', 'until', 'config', 'out'],
  demo: ['out', 'days', 'date'],
  init: ['config'],
};
const BOOL_FLAGS: Record<Command, readonly string[]> = {
  run: ['no-llm', 'no-deliver', 'dry-run', 'json'],
  demo: [],
  init: [],
};

export interface ParsedArgs {
  command: Command | 'help' | 'version';
  values: Record<string, string>;
  flags: Set<string>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.includes('--help') || argv.includes('-h'))
    return { command: 'help', values: {}, flags: new Set() };
  if (argv.includes('--version') || argv.includes('-v'))
    return { command: 'version', values: {}, flags: new Set() };

  let command: Command | undefined;
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith('--')) {
      if (i === 0 && (arg === 'run' || arg === 'demo' || arg === 'init')) {
        command = arg;
        continue;
      }
      throw new UsageError(`unexpected argument "${arg}"`);
    }
    // The command can only be the first argument, so it is known before any flag is seen.
    const cmd: Command = command ?? 'run';
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (VALUE_FLAGS[cmd].includes(name)) {
      const value = eq === -1 ? argv[i + 1] : arg.slice(eq + 1);
      if (value === undefined || value === '' || (eq === -1 && value.startsWith('--')))
        throw new UsageError(`--${name} requires a value`);
      values[name] = value;
      if (eq === -1) i++;
    } else if (BOOL_FLAGS[cmd].includes(name)) {
      if (eq !== -1) throw new UsageError(`--${name} does not take a value`);
      flags.add(name);
    } else {
      throw new UsageError(`unknown option --${name} for "${cmd}"`);
    }
  }
  const cmd: Command = command ?? 'run';
  return { command: cmd, values, flags };
}

function readVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const version =
    typeof pkg === 'object' && pkg !== null ? (pkg as { version?: unknown }).version : undefined;
  if (typeof version !== 'string') throw new Error('package.json has no version');
  return version;
}

function initTemplate(owner: string): Record<string, unknown> {
  const base = defaultConfig(owner);
  return {
    owner,
    include: base.include,
    exclude: base.exclude,
    includeForks: base.includeForks,
    includeArchived: base.includeArchived,
    agents: base.agents,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    defaultSince: base.defaultSince,
    staleDays: base.staleDays,
    vercelProjects: base.vercelProjects,
    llm: base.llm,
    siteTitle: base.siteTitle,
    deliver: base.deliver,
  };
}

const DEFAULT_CONFIG_FILE = 'overnight.config.json';

/**
 * Runs `fn` with the config path to load. Explicit --config is resolved against cwd. Otherwise
 * `<cwd>/overnight.config.json` is used when present; when absent, config falls back to defaults,
 * which must not pick up a file from process.cwd() when cwd differs, so an empty object is loaded instead.
 */
async function withConfigPath<T>(
  explicit: string | undefined,
  cwd: string,
  fn: (configPath: string | undefined) => Promise<T>,
): Promise<T> {
  if (explicit !== undefined) return fn(resolve(cwd, explicit));
  const candidate = resolve(cwd, DEFAULT_CONFIG_FILE);
  if (existsSync(candidate)) return fn(candidate);
  const processDefault = resolve(process.cwd(), DEFAULT_CONFIG_FILE);
  if (processDefault === candidate || !existsSync(processDefault)) return fn(undefined);
  const dir = await mkdtemp(join(tmpdir(), 'overnight-config-'));
  try {
    const empty = join(dir, DEFAULT_CONFIG_FILE);
    await writeFile(empty, '{}\n');
    return await fn(empty);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function cmdRun(p: ParsedArgs, io: CliIO, cwd: string): Promise<number> {
  const { digest, paths, deliveries } = await withConfigPath(
    p.values.config,
    cwd,
    (configPath): Promise<RunResult> =>
      runDigest({
        since: p.values.since,
        until: p.values.until,
        configPath,
        outDir: p.values.out !== undefined ? resolve(cwd, p.values.out) : undefined,
        llm: !p.flags.has('no-llm'),
        deliver: !p.flags.has('no-deliver'),
        dryRun: p.flags.has('dry-run'),
        fetch: io.fetch,
        env: io.env ?? process.env,
        now: io.now,
        log: (m) => io.stderr(m),
      }),
  );
  if (p.flags.has('json')) {
    io.stdout(JSON.stringify(digest, null, 2));
    return 0;
  }
  const t = digest.totals;
  const lines = [
    digest.headline,
    `Window: ${digest.window.since} → ${digest.window.until} (${digest.id})`,
    `Projects active: ${t.projectsActive} · merged PRs: ${t.mergedPRs} · commits: ${t.commits} · releases: ${t.releases}`,
    `CI failures: ${t.ciFailures} · PRs needing attention: ${t.openPRsNeedingAttention} · issues +${t.issuesOpened}/-${t.issuesClosed}`,
    `Deployments: ${t.deployments} (${t.deploymentsFailed} failed) · stars Δ ${t.starsDelta} · agent contributions: ${t.agentContributions}`,
  ];
  if (digest.warnings.length > 0) lines.push(`Warnings: ${digest.warnings.length}`);
  if (paths.length > 0) {
    lines.push('Wrote:');
    for (const path of paths) lines.push(`  ${path}`);
  } else {
    lines.push('Dry run: nothing written, delivered, or saved.');
  }
  const secrets = readSecrets(io.env ?? process.env);
  for (const d of deliveries) {
    lines.push(`Delivery ${d.channel}: ${d.ok ? 'ok' : 'FAILED'} — ${redactSecrets(d.detail, secrets)}`);
  }
  io.stdout(lines.join('\n'));
  return 0;
}

async function cmdDemo(p: ParsedArgs, io: CliIO, cwd: string): Promise<number> {
  const out = resolve(cwd, p.values.out ?? 'public');
  const daysRaw = p.values.days ?? '14';
  if (!/^\d+$/.test(daysRaw) || Number(daysRaw) < 1 || Number(daysRaw) > 366) {
    throw new UsageError('--days must be an integer between 1 and 366');
  }
  const date = p.values.date ?? (io.now ?? new Date()).toISOString().slice(0, 10);
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== date
  ) {
    throw new UsageError('--date must be a valid YYYY-MM-DD date');
  }
  const digests = syntheticArchive(Number(daysRaw), date);
  const siteTitle = defaultConfig('demo').siteTitle;
  for (const d of digests) await writeArchive(d, out, { siteTitle });
  const latest = digests[digests.length - 1];
  if (!latest) throw new Error('demo produced no digests');
  await mkdir(out, { recursive: true });
  const demoPath = join(out, 'demo-digest.json');
  await writeFile(demoPath, JSON.stringify(latest, null, 2) + '\n');
  io.stdout(`Wrote ${digests.length} synthetic digests to ${out} (latest ${latest.id}); ${demoPath}`);
  return 0;
}

async function cmdInit(p: ParsedArgs, io: CliIO, cwd: string): Promise<number> {
  const path = resolve(cwd, p.values.config ?? 'overnight.config.json');
  const owner = (io.env ?? process.env).OVERNIGHT_OWNER || 'your-github-login';
  try {
    await writeFile(path, JSON.stringify(initTemplate(owner), null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
      io.stderr(`overnight: ${path} already exists; leaving it unchanged`);
      return 1;
    }
    throw error;
  }
  io.stdout(`Wrote ${path}`);
  return 0;
}

/** CLI entry point. Returns the process exit code; never throws. */
export async function main(argv: readonly string[], io: CliIO): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  // Everything written to stderr (progress logs, errors, debug stacks) is scrubbed of secrets.
  const secrets = readSecrets(env);
  const safeIO: CliIO = { ...io, env, stderr: (s) => io.stderr(redactSecrets(s, secrets)) };
  try {
    const parsed = parseArgs(argv);
    switch (parsed.command) {
      case 'help':
        io.stdout(USAGE);
        return 0;
      case 'version':
        io.stdout(readVersion());
        return 0;
      case 'run':
        return await cmdRun(parsed, safeIO, cwd);
      case 'demo':
        return await cmdDemo(parsed, safeIO, cwd);
      case 'init':
        return await cmdInit(parsed, safeIO, cwd);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      safeIO.stderr(`overnight: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    const debug = env.OVERNIGHT_DEBUG === '1';
    const message = error instanceof Error ? error.message : String(error);
    safeIO.stderr(`overnight: ${debug && error instanceof Error && error.stack ? error.stack : message}`);
    return 1;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry || !existsSync(entry)) return false;
  return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  void main(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s + '\n'),
    stderr: (s) => process.stderr.write(s + '\n'),
  }).then((code) => {
    process.exitCode = code;
  });
}
