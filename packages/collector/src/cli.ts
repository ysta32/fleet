#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { FleetSnapshot } from '@fleet/shared';
import { configPath, dataDir, loadConfig } from './config.js';
import { install, uninstall } from './launchd.js';

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
  install     install and load the launchd agent (macOS)
  uninstall   unload and remove the launchd agent
  status      show daemon health and counts
  token       print the access token and LAN URL
  open        open the dashboard in a browser
  doctor      check the environment
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
    runDaemon: (c: typeof cfg) => Promise<{ close(): void }>;
  };
  const d = await runDaemon(cfg);
  const stop = (): void => {
    d.close();
    process.exit(0);
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

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

async function doctor(): Promise<number> {
  const cfg = loadConfig();
  let bad = 0;
  const line = (ok: boolean, msg: string): void => {
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  };
  const major = Number(process.versions.node.split('.')[0]);
  line(major >= 20, `node ${process.versions.node} (need >=20)`);
  line(existsSync(cfg.claudeProjectsDir), `claude projects dir ${cfg.claudeProjectsDir}`);
  let gh = false;
  try {
    await pexec('gh', ['auth', 'status']);
    gh = true;
  } catch {
    gh = false;
  }
  line(gh, 'gh auth status (needed only for GitHub polling)');
  line(await portFree(cfg.port), `port ${cfg.port} free (fails if the daemon is already running)`);
  return bad === 0 ? 0 : 1;
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
    case 'install': {
      const path = await install({
        nodePath: process.execPath,
        cliPath: fileURLToPath(import.meta.url),
        logDir: join(dataDir(), 'logs'),
      });
      const cfg = loadConfig();
      console.log(`installed ${path}`);
      console.log(`dashboard: http://127.0.0.1:${cfg.port}/`);
      return 0;
    }
    case 'uninstall':
      console.log((await uninstall()) ? 'uninstalled' : 'not installed');
      return 0;
    case 'status':
      return status();
    case 'token': {
      const cfg = loadConfig();
      console.log(cfg.token);
      console.log(`http://${lanIp()}:${cfg.port}/?token=${cfg.token}`);
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
