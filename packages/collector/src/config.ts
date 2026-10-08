import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
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

/**
 * The config holds the access token: if the file is ours and readable/writable/executable by anyone
 * else (mode broader than 0600), tighten it through the already-open descriptor, so the file that
 * was checked is the one changed. A chmod failure is reported, not fatal: the config is still usable.
 */
function tightenMode(fd: number, st: Stats, path: string): void {
  const uid = process.getuid?.();
  if (uid === undefined || st.uid !== uid || (st.mode & 0o777 & ~0o600) === 0) return;
  try {
    fchmodSync(fd, 0o600);
  } catch (e) {
    console.warn(`fleet: could not restrict permissions of ${path} to 0600: ${(e as Error).message}`);
  }
}

/**
 * Read and validate the config through one descriptor. A symlinked config (e.g. managed dotfiles) is
 * read but never chmod-ed, so a link can't redirect the chmod to an unrelated file. A regular file is
 * opened with O_NOFOLLOW (a swap to a symlink mid-load falls back to read-only), parsed and
 * validated, and only then has its mode tightened through the same descriptor.
 */
function readJson(path: string): Record<string, unknown> {
  let link = lstatSync(path).isSymbolicLink();
  const base = fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0);
  let fd: number;
  if (link) {
    fd = openSync(path, base);
  } else {
    try {
      fd = openSync(path, base | (fsConstants.O_NOFOLLOW ?? 0));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ELOOP') throw e;
      link = true;
      fd = openSync(path, base);
    }
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error(`config at ${path} must be a regular file`);
    const parsed: unknown = JSON.parse(readFileSync(fd, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`config at ${path} must be a JSON object`);
    }
    if (!link) tightenMode(fd, st, path);
    else if ((st.mode & 0o077) !== 0) {
      console.warn(`fleet: ${path} is a symlink to a file readable by others; restrict it to 0600`);
    }
    return parsed as Record<string, unknown>;
  } finally {
    closeSync(fd);
  }
}

/**
 * Write the config via a private tmp file. With exclusive=true the final path is created with
 * link() (fails with EEXIST if another process won the race) and false is returned.
 */
function writeConfig(path: string, cfg: FleetConfig, exclusive: boolean, beforeLink?: () => void): boolean {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  try {
    beforeLink?.();
    if (exclusive) {
      linkSync(tmp, path);
    } else {
      renameSync(tmp, path);
    }
    chmodSync(path, 0o600);
    return true;
  } catch (e) {
    if (exclusive && (e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* already renamed away */
    }
  }
}

/** Test seam: runs after the tmp file is written and before the config is published. */
export interface LoadHooks {
  beforeLink?: () => void;
}

/** Load config (merging defaults), generating a token and persisting on first run. */
export function loadConfig(path: string = configPath(), hooks: LoadHooks = {}): FleetConfig {
  const defaults = defaultConfig();
  const existed = existsSync(path);
  const user = existed ? readJson(path) : {};
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
  if (!hadToken) {
    if (!writeConfig(path, cfg, !existed, hooks.beforeLink)) {
      // another process created the file first: adopt its token
      return loadConfig(path);
    }
  }

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
