import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_PORT, type AlertKind, type FleetConfig } from '@fleet/shared';

export const ALL_ALERT_KINDS: AlertKind[] = [
  'army.done',
  'army.blocked',
  'ci.failed',
  'session.waiting',
  'deploy.failed',
];

export function configPath(): string {
  return process.env.FLEET_CONFIG || join(homedir(), '.config', 'fleet', 'config.json');
}

export function dataDir(): string {
  return process.env.FLEET_DATA || join(homedir(), '.local', 'share', 'fleet');
}

export function defaultConfig(): Omit<FleetConfig, 'token'> {
  return {
    port: DEFAULT_PORT,
    lan: false,
    claudeProjectsDir: join(homedir(), '.claude', 'projects'),
    recentWindowMs: 24 * 60 * 60 * 1000,
    shareContent: false,
    notify: { macos: true, ntfyUrl: '', kinds: [...ALL_ALERT_KINDS] },
    github: true,
    githubPollMs: 60_000,
  };
}

function readJson(path: string): Record<string, unknown> {
  const raw = readFileSync(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`config at ${path} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function writeConfig(path: string, cfg: FleetConfig): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Load config (merging defaults), generating a token and persisting on first run. */
export function loadConfig(path: string = configPath()): FleetConfig {
  const defaults = defaultConfig();
  const user = existsSync(path) ? readJson(path) : {};
  const userNotify =
    typeof user.notify === 'object' && user.notify !== null && !Array.isArray(user.notify)
      ? (user.notify as Partial<FleetConfig['notify']>)
      : {};
  const hadToken = typeof user.token === 'string' && user.token.length > 0;
  const cfg: FleetConfig = {
    ...defaults,
    ...(user as Partial<FleetConfig>),
    notify: { ...defaults.notify, ...userNotify },
    token: hadToken ? (user.token as string) : randomBytes(32).toString('hex'),
  };
  if (!hadToken) writeConfig(path, cfg);

  // env overrides are applied in memory only, never persisted
  const envPort = process.env.FLEET_PORT;
  if (envPort !== undefined && envPort !== '') {
    const n = Number(envPort);
    if (Number.isInteger(n) && n >= 0 && n <= 65535) cfg.port = n;
  }
  if (process.env.FLEET_LAN === '1') cfg.lan = true;
  return cfg;
}

function homedir(): string {
  return process.env.HOME || osHomedir();
}
