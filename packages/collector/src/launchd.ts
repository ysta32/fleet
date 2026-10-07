import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const LABEL = 'dev.fleet.collector';

export type ExecFn = (cmd: string, args: string[]) => Promise<string>;

export interface PlistOpts {
  nodePath: string;
  cliPath: string;
  logDir: string;
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
  <key>RunAtLoad</key>
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
  if (await isLoaded(exec, uid)) {
    await exec('launchctl', ['bootout', `gui/${uid}/${LABEL}`]);
  }
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

function homedir(): string {
  return process.env.HOME || osHomedir();
}
