import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

export const LABEL = 'dev.fleet.collector';

export type ExecFn = (cmd: string, args: string[]) => Promise<string>;

export interface PlistOpts {
  nodePath: string;
  cliPath: string;
  logDir: string;
  /** extra environment for the daemon (see installEnv) */
  env?: Record<string, string>;
}

const PASS_THROUGH = ['FLEET_CONFIG', 'FLEET_DATA', 'FLEET_PORT', 'FLEET_LAN'];

/** Env persisted into the plist: FLEET_* overrides present at install time plus a PATH that resolves gh/git. */
export function installEnv(src: NodeJS.ProcessEnv, nodePath: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: [dirname(nodePath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
      .filter((p, i, a) => a.indexOf(p) === i)
      .join(':'),
  };
  for (const k of PASS_THROUGH) {
    const v = src[k];
    if (v === undefined || v === '') continue;
    env[k] = k === 'FLEET_CONFIG' || k === 'FLEET_DATA' ? resolve(v) : v;
  }
  return env;
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function plistXml(o: PlistOpts): string {
  const args = [o.nodePath, o.cliPath, 'start'].map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n');
  const envXml = Object.entries(o.env ?? {})
    .map(([k, v]) => `    <key>${xmlEscape(k)}</key>\n    <string>${xmlEscape(v)}</string>`)
    .join('\n');
  const envBlock = envXml ? `  <key>EnvironmentVariables</key>\n  <dict>\n${envXml}\n  </dict>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
${envBlock}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(join(o.logDir, 'collector.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(join(o.logDir, 'collector.err.log'))}</string>
</dict>
</plist>
`;
}

const pexec = promisify(execFile);
const defaultExec: ExecFn = async (cmd, args) => (await pexec(cmd, args)).stdout;

export interface LaunchdDeps {
  exec?: ExecFn;
  home?: string;
  uid?: number;
  /** write the plist but never call launchctl (FLEET_NO_LAUNCHD=1) */
  noLoad?: boolean;
}

/** What `install` would write, without touching the filesystem or launchctl. */
export function planInstall(o: PlistOpts, d: LaunchdDeps = {}): { path: string; xml: string } {
  return { path: plistPath(d.home), xml: plistXml(o) };
}

export function plistPath(home: string = homedir()): string {
  return join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function uidOf(d: LaunchdDeps): number {
  return d.uid ?? process.getuid?.() ?? 0;
}

async function isLoaded(exec: ExecFn, uid: number): Promise<boolean> {
  try {
    await exec('launchctl', ['print', `gui/${uid}/${LABEL}`]);
    return true;
  } catch {
    return false;
  }
}

export async function install(o: PlistOpts, d: LaunchdDeps = {}): Promise<string> {
  const exec = d.exec ?? defaultExec;
  const uid = uidOf(d);
  const path = plistPath(d.home);
  mkdirSync(join(path, '..'), { recursive: true });
  mkdirSync(o.logDir, { recursive: true });
  writeFileSync(path, plistXml(o), { mode: 0o644 });
  if (d.noLoad) return path;
  if (await isLoaded(exec, uid)) {
    await exec('launchctl', ['bootout', `gui/${uid}/${LABEL}`]);
  }
  await exec('launchctl', ['bootstrap', `gui/${uid}`, path]);
  return path;
}

export async function uninstall(d: LaunchdDeps = {}): Promise<boolean> {
  const exec = d.exec ?? defaultExec;
  const uid = uidOf(d);
  const path = plistPath(d.home);
  if (!d.noLoad && (await isLoaded(exec, uid))) {
    await exec('launchctl', ['bootout', `gui/${uid}/${LABEL}`]);
  }
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

function homedir(): string {
  return process.env.HOME || osHomedir();
}
