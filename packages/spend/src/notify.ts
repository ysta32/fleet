import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { SpendAlert } from '@fleet/shared';
import type { SpendConfig } from './contracts.js';

export interface NotifyDeps {
  exec?: (file: string, args: string[]) => Promise<unknown>;
  fetch?: typeof globalThis.fetch;
  platform?: NodeJS.Platform;
  readFile?: typeof readFileSync;
  writeFile?: typeof writeFileSync;
  mkdir?: typeof mkdirSync;
  chmod?: typeof chmodSync;
  env?: Record<string, string | undefined>;
  fleetConfigPath?: string;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;
}

type Channel = 'macos' | 'fleet' | 'ntfy';

function isSentState(value: unknown): value is Record<string, Channel[]> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (channels: unknown) =>
        Array.isArray(channels) &&
        channels.every(
          (channel: unknown) => channel === 'macos' || channel === 'fleet' || channel === 'ntfy',
        ),
    )
  );
}

function fleetToken(deps: NotifyDeps, readFile: typeof readFileSync): string | undefined {
  const token = (deps.env ?? process.env).FLEET_TOKEN;
  if (token) return token;
  try {
    const config: unknown = JSON.parse(
      readFile(deps.fleetConfigPath ?? join(homedir(), '.config/fleet/config.json'), 'utf8'),
    );
    if (config !== null && typeof config === 'object' && 'token' in config) {
      return typeof config.token === 'string' && config.token ? config.token : undefined;
    }
  } catch {}
  return undefined;
}

export async function dispatchAlerts(
  alerts: SpendAlert[],
  cfg: SpendConfig,
  statePath = join(homedir(), '.config/fleet/spend-state.json'),
  deps: NotifyDeps = {},
): Promise<SpendAlert[]> {
  const exec = deps.exec ?? promisify(execFile);
  const fetch = deps.fetch ?? globalThis.fetch;
  const readFile = deps.readFile ?? readFileSync;
  const writeFile = deps.writeFile ?? writeFileSync;
  const mkdir = deps.mkdir ?? mkdirSync;
  const chmod = deps.chmod ?? chmodSync;
  let sent = new Map<string, Channel[]>();
  try {
    const state: unknown = JSON.parse(readFile(statePath, 'utf8'));
    if (isSentState(state)) sent = new Map(Object.entries(state));
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const token = cfg.notify.fleet ? fleetToken(deps, readFile) : undefined;
  const newlySent: SpendAlert[] = [];
  const attempted = new Set<string>();
  for (const alert of alerts) {
    if (attempted.has(alert.id)) continue;
    attempted.add(alert.id);
    const channels = sent.get(alert.id) ?? [];
    let delivered = false;
    if (cfg.notify.macos && !channels.includes('macos') && (deps.platform ?? process.platform) === 'darwin') {
      try {
        await exec('osascript', [
          '-e',
          `display notification ${appleScriptString(alert.body)} with title "Fleet Spend" subtitle ${appleScriptString(alert.title)}`,
        ]);
        channels.push('macos');
        delivered = true;
      } catch {}
    }
    if (cfg.notify.fleet && token && !channels.includes('fleet')) {
      try {
        const response = await fetch('http://127.0.0.1:4747/api/alerts', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'spend.budget',
            title: alert.title.slice(0, 80),
            body: alert.body.slice(0, 200),
            id: alert.id,
          }),
        });
        if (response.ok) {
          channels.push('fleet');
          delivered = true;
        }
      } catch {}
    }
    if (cfg.notify.ntfyUrl && !channels.includes('ntfy')) {
      try {
        const response = await fetch(cfg.notify.ntfyUrl, {
          method: 'POST',
          headers: { Title: alert.title.replace(/[\r\n]+/g, ' ') },
          body: alert.body,
        });
        if (response.ok) {
          channels.push('ntfy');
          delivered = true;
        }
      } catch {}
    }
    if (delivered) {
      sent.set(alert.id, channels);
      mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
      writeFile(statePath, `${JSON.stringify(Object.fromEntries(sent))}\n`, { mode: 0o600 });
      chmod(statePath, 0o600);
      newlySent.push(alert);
    }
  }
  return newlySent;
}
