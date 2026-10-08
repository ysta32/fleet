import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LABEL, plistPath, type ExecFn } from './launchd.js';

const pexec = promisify(execFile);

export type Level = 'ok' | 'warn' | 'fail';

export interface DoctorLine {
  level: Level;
  text: string;
}

export interface DoctorInput {
  port: number;
  claudeProjectsDir: string;
  configPath: string;
  webDir: string;
  home: string;
  nodeVersion?: string;
  platform?: string;
  noLaunchd?: boolean;
  uid?: number;
  exec?: ExecFn;
  /** returns true when something answers /api/health as Fleet on the port */
  probeFleet?: (port: number) => Promise<boolean>;
  portFree?: (port: number) => Promise<boolean>;
}

const defaultExec: ExecFn = async (cmd, args) => (await pexec(cmd, args)).stdout;

export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

async function probeFleet(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  }
}

/** Every line reads "<level>  <fact>. <action>" so a failing line says what to do next. */
export function formatLine(l: DoctorLine): string {
  return `${l.level.padEnd(4)}  ${l.text}`;
}

/** 0 = all ok, 1 = warnings only, 2 = at least one failure. */
export function exitCode(lines: DoctorLine[]): 0 | 1 | 2 {
  if (lines.some((l) => l.level === 'fail')) return 2;
  return lines.some((l) => l.level === 'warn') ? 1 : 0;
}

export async function runDoctor(i: DoctorInput): Promise<DoctorLine[]> {
  const exec = i.exec ?? defaultExec;
  const out: DoctorLine[] = [];
  const add = (level: Level, text: string): void => {
    out.push({ level, text });
  };

  const nodeVersion = i.nodeVersion ?? process.versions.node;
  const major = Number(nodeVersion.split('.')[0]);
  if (major >= 20) add('ok', `Node ${nodeVersion} meets the >=20 requirement.`);
  else add('fail', `Node ${nodeVersion} is older than 20. Install Node 20 or newer.`);

  const free = await (i.portFree ?? portFree)(i.port);
  if (free) {
    add('ok', `Port ${i.port} is free. The collector can bind it.`);
  } else if (await (i.probeFleet ?? probeFleet)(i.port)) {
    add('ok', `Port ${i.port} is in use by the Fleet collector. Nothing to do.`);
  } else {
    add('fail', `Port ${i.port} is in use by another process. Stop it or set "port" in ${i.configPath}.`);
  }

  try {
    accessSync(i.claudeProjectsDir, constants.R_OK);
    const n = readdirSync(i.claudeProjectsDir).length;
    add('ok', `${i.claudeProjectsDir} is readable with ${n} entries. Sessions appear as agents write.`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      add('warn', `${i.claudeProjectsDir} does not exist. Start Claude Code in any repo to create it.`);
    } else {
      add('fail', `${i.claudeProjectsDir} is not readable. Grant read access to this user.`);
    }
  }

  try {
    await exec('gh', ['auth', 'status']);
    add('ok', 'GitHub CLI is signed in. PR and CI status will load.');
  } catch {
    add('warn', 'GitHub CLI is not signed in or not installed. Run gh auth login for PR and CI status.');
  }

  if (!existsSync(i.configPath)) {
    add('warn', `No config at ${i.configPath}. Run fleet install to create it with a private token.`);
  } else {
    const mode = statSync(i.configPath).mode & 0o777;
    const octal = mode.toString(8).padStart(3, '0');
    if (mode === 0o600) add('ok', `${i.configPath} has mode 600. The token stays private.`);
    else add('fail', `${i.configPath} has mode ${octal}, which exposes the token. Run chmod 600 on it.`);
  }

  const platform = i.platform ?? process.platform;
  if (i.noLaunchd) {
    add('ok', 'launchd check skipped because FLEET_NO_LAUNCHD=1. Unset it to manage the agent.');
  } else if (platform !== 'darwin') {
    add('warn', `launchd is macOS only and this is ${platform}. Run fleet start under your own supervisor.`);
  } else {
    const uid = i.uid ?? process.getuid?.() ?? 0;
    const plist = plistPath(i.home);
    let loaded = false;
    try {
      await exec('launchctl', ['print', `gui/${uid}/${LABEL}`]);
      loaded = true;
    } catch {
      loaded = false;
    }
    if (loaded) add('ok', `launchd agent ${LABEL} is loaded. The collector restarts on login.`);
    else if (existsSync(plist))
      add('warn', `${plist} exists but is not loaded. Run fleet install to load it.`);
    else
      add(
        'warn',
        `launchd agent ${LABEL} is not installed. Run fleet install to keep the collector running.`,
      );
  }

  if (existsSync(join(i.webDir, 'index.html')))
    add('ok', `Web assets found in ${i.webDir}. The dashboard will load.`);
  else add('fail', `Web assets missing in ${i.webDir}. Run npm run build or reinstall fleet-collector.`);

  return out;
}
