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
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;
}

function connectionRefused(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const value = error as { code?: unknown; cause?: unknown };
  return value.code === 'ECONNREFUSED' || (value.cause !== undefined && connectionRefused(value.cause));
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
  let ids: unknown = [];
  try {
    const state: unknown = JSON.parse(readFile(statePath, 'utf8'));
    ids = state !== null && typeof state === 'object' ? (state as { sentIds?: unknown }).sentIds : undefined;
    if (!Array.isArray(ids) || !ids.every((id: unknown) => typeof id === 'string')) {
      throw new TypeError('Invalid spend notification state');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const sent = new Set(ids as string[]);
  const newlySent: SpendAlert[] = [];
  for (const alert of alerts) {
    if (sent.has(alert.id)) continue;
    let delivered = false;
    const errors: unknown[] = [];
    if (cfg.notify.macos && (deps.platform ?? process.platform) === 'darwin') {
      try {
        await exec('osascript', [
          '-e',
          `display notification ${appleScriptString(alert.body)} with title "Fleet Spend" subtitle ${appleScriptString(alert.title)}`,
        ]);
        delivered = true;
      } catch (error) {
        errors.push(error);
      }
    }
    if (cfg.notify.fleet) {
      try {
        const response = await fetch('http://127.0.0.1:4747/api/alerts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'spend.budget', title: alert.title, body: alert.body, id: alert.id }),
        });
        if (!response.ok) throw new Error(`Fleet notification failed (${response.status})`);
        delivered = true;
      } catch (error) {
        if (!connectionRefused(error)) errors.push(error);
      }
    }
    if (cfg.notify.ntfyUrl) {
      try {
        const response = await fetch(cfg.notify.ntfyUrl, {
          method: 'POST',
          headers: { Title: alert.title.replace(/[\r\n]+/g, ' ') },
          body: alert.body,
        });
        if (!response.ok) throw new Error(`ntfy notification failed (${response.status})`);
        delivered = true;
      } catch (error) {
        errors.push(error);
      }
    }
    if (delivered) {
      sent.add(alert.id);
      mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
      writeFile(statePath, `${JSON.stringify({ sentIds: [...sent] })}\n`, { mode: 0o600 });
      chmod(statePath, 0o600);
      newlySent.push(alert);
    }
    if (errors.length > 0) throw errors[0];
  }
  return newlySent;
}
