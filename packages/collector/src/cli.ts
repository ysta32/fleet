#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir as osHomedir, networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { FleetSnapshot } from '@fleet/shared';
import { configPath, dataDir, defaultConfig, loadConfig } from './config.js';
import { exitCode, formatLine, runDoctor } from './doctor.js';
import { install, installEnv, planInstall, uninstall } from './launchd.js';

const pexec = promisify(execFile);

function version(): string {
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return (JSON.parse(readFileSync(p, 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

const HELP = `fleet - mission control for Claude Code agents

Usage: fleet <command>

Commands:
  start       run the collector daemon in the foreground
  install     install and load the launchd agent (macOS); --dry-run prints the plist only
  uninstall   unload and remove the launchd agent
  status      show daemon health and counts
  token       print the access token and LAN URL
  open        open the dashboard in a browser
  doctor      check the environment (exit 0 ok, 1 warnings, 2 failures)
  demo        run the daemon with synthetic demo data

Options:
  --help, -h     show this help
  --version, -v  show version
`;

function lanIp(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return '127.0.0.1';
}

// daemon.ts is wired in a separate task; a non-literal specifier keeps tsc independent of it
const DAEMON_MODULE = './daemon.js';

async function runDaemonCmd(): Promise<void> {
  const cfg = loadConfig();
  const { runDaemon } = (await import(DAEMON_MODULE)) as {
    runDaemon: (c: typeof cfg) => Promise<{ port: number; host: string; close(): Promise<void> }>;
  };
  const d = await runDaemon(cfg);
  console.log(
    `fleet listening on http://${d.host}:${d.port}/${process.env.FLEET_DEMO === '1' ? ' (demo)' : ''}`,
  );
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    d.close().then(
      () => process.exit(0),
      (err: unknown) => {
        console.error('fleet: shutdown failed:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function status(): Promise<number> {
  const cfg = loadConfig();
  const base = `http://127.0.0.1:${cfg.port}`;
  try {
    const h = await getJson<{ ok: boolean; version: string }>(`${base}/api/health`);
    const s = await getJson<FleetSnapshot>(`${base}/api/snapshot`);
    console.log(`fleet ${h.version} running on port ${cfg.port}`);
    console.log(
      `projects=${s.projects.length} sessions=${s.sessions.length} agents=${s.agents.length} alerts=${s.alerts.filter((a) => !a.cleared).length}`,
    );
    return 0;
  } catch {
    console.log(`fleet is not running on port ${cfg.port}`);
    return 1;
  }
}

async function doctor(): Promise<number> {
  const path = configPath();
  // read-only: loadConfig would chmod the file and hide the permission problem doctor reports
  const cfg = { ...defaultConfig(), ...readConfigFile(path) };
  cfg.port = envPort() ?? configuredPort(path) ?? defaultConfig().port;
  const lines = await runDoctor({
    port: cfg.port,
    claudeProjectsDir: cfg.claudeProjectsDir,
    configPath: path,
    webDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'web'),
    home: process.env.HOME || osHomedir(),
    noLaunchd: process.env.FLEET_NO_LAUNCHD === '1',
  });
  for (const l of lines) console.log(formatLine(l));
  return exitCode(lines);
}

/** Config file contents, read without creating, chmod-ing or rewriting anything. */
function readConfigFile(path: string): Partial<ReturnType<typeof defaultConfig>> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Partial<ReturnType<typeof defaultConfig>>)
      : {};
  } catch {
    return {};
  }
}

/** Port from an existing config file, read without creating or rewriting anything. */
function configuredPort(path: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const port = (parsed as { port?: unknown } | null)?.port;
    return typeof port === 'number' && Number.isInteger(port) && port >= 0 && port <= 65535
      ? port
      : undefined;
  } catch {
    return undefined;
  }
}

function envPort(): number | undefined {
  const v = process.env.FLEET_PORT;
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : undefined;
}

async function installCmd(args: string[]): Promise<number> {
  const dryRun = args.includes('--dry-run');
  const unknown = args.filter((a) => a !== '--dry-run');
  if (unknown.length > 0) {
    console.error(`Unknown option ${unknown[0]}. Usage: fleet install [--dry-run]`);
    return 2;
  }
  const opts = {
    env: installEnv(process.env, process.execPath),
    nodePath: process.execPath,
    cliPath: fileURLToPath(import.meta.url),
    logDir: join(dataDir(), 'logs'),
  };
  const home = process.env.HOME || osHomedir();
  if (dryRun) {
    // a dry run must not create the config or token either
    const port = envPort() ?? configuredPort(configPath()) ?? defaultConfig().port;
    const plan = planInstall(opts, { home });
    console.log(`Dry run. Nothing was written and launchctl was not called.`);
    console.log(`Plist path: ${plan.path}`);
    console.log(plan.xml.trimEnd());
    console.log(`Dashboard would be at http://127.0.0.1:${port}/.`);
    return 0;
  }
  const cfg = loadConfig(); // create config/token before the daemon can race to do so
  const noLoad = process.env.FLEET_NO_LAUNCHD === '1';
  const path = await install(opts, { home, noLoad });
  console.log(
    noLoad
      ? `Wrote ${path}. FLEET_NO_LAUNCHD=1 is set, so launchctl was not called.`
      : `Installed and loaded ${path}.`,
  );
  console.log(`Dashboard: http://127.0.0.1:${cfg.port}/`);
  console.log('Run fleet token for the access token and LAN URL.');
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  switch (cmd) {
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      console.log(HELP);
      return 0;
    case '--version':
    case '-v':
      console.log(version());
      return 0;
    case 'start':
      await runDaemonCmd();
      return -1; // keep running
    case 'demo':
      process.env.FLEET_DEMO = '1';
      await runDaemonCmd();
      return -1;
    case 'install':
      return installCmd(argv.slice(1));
    case 'uninstall':
      console.log(
        (await uninstall({
          home: process.env.HOME || osHomedir(),
          noLoad: process.env.FLEET_NO_LAUNCHD === '1',
        }))
          ? 'Uninstalled the launchd agent.'
          : 'No launchd agent was installed. Nothing to remove.',
      );
      return 0;
    case 'status':
      return status();
    case 'token': {
      const cfg = loadConfig();
      console.log(`http://${lanIp()}:${cfg.port}/`);
      console.log(cfg.token);
      console.log('Open the URL on your device and paste the token when the app asks for it.');
      if (!cfg.lan) console.log(`(lan is off; enable in ${configPath()} or FLEET_LAN=1)`);
      return 0;
    }
    case 'open': {
      const cfg = loadConfig();
      await pexec('open', [`http://127.0.0.1:${cfg.port}/`]);
      return 0;
    }
    case 'doctor':
      return doctor();
    default:
      console.error(`unknown command: ${cmd}\n`);
      console.error(HELP);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
