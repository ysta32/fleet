#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { burnTint, type SpendDimension } from '@fleet/shared';
import { loadConfig, saveBudget } from './config.js';
import type { SpendSummary } from './contracts.js';
import { defaultConfigPath, loadAll, type Loaded } from './index.js';
import { dispatchAlerts } from './notify.js';
import {
  renderBudget,
  renderSummary,
  renderTips,
  renderTsv,
  renderWhere,
  type RenderOpts,
} from './render.js';
import { startServer, validPort, PORT_MAX, PORT_MIN } from './serve.js';

export interface CliStream {
  write(chunk: string): unknown;
  isTTY?: boolean;
  columns?: number;
}

export interface CliIo {
  stdout: CliStream;
  stderr: CliStream;
  env: Record<string, string | undefined>;
  /** defaults to os.homedir() */
  home?: string;
  /** fixed clock for tests */
  now?: () => number;
  fetch?: typeof globalThis.fetch;
  platform?: NodeJS.Platform;
  /** resolves when the user asks to stop (watch/serve); defaults to SIGINT/SIGTERM */
  stopSignal?: Promise<void>;
}

const DIMENSIONS: readonly SpendDimension[] = [
  'repo',
  'model',
  'session',
  'army',
  'task',
  'day',
  'branch',
  'source',
];

const HELP = `fleet-spend - local, private spend tracker for AI coding agents

Usage:
  fleet-spend                       summary: month to date, today, forecast, burn, top repos/models, tips
  fleet-spend where [--by DIM] [--limit N]
                                    spend breakdown; DIM = ${DIMENSIONS.join('|')}
  fleet-spend tips                  savings tips
  fleet-spend budget                budget status
  fleet-spend budget set <usd>      set the monthly budget
  fleet-spend budget clear          remove the monthly budget
  fleet-spend check                 exit 0 ok, 1 warning threshold reached, 2 over budget
  fleet-spend json                  full SpendSummary JSON
  fleet-spend brief                 compact SpendBrief JSON
  fleet-spend watch [--interval S]  re-collect every S seconds (default 60) and send budget alerts
  fleet-spend serve [--port P]      local dashboard on http://127.0.0.1:P (${PORT_MIN}-${PORT_MAX}, default from config)

Options:
  --json        print JSON (summary, where, tips, budget)
  --no-color    disable ANSI color (also NO_COLOR)
  --ascii       ASCII-only output
  --debug       print stack traces on error
  -h, --help    show this help
  -v, --version show the version
`;

class UsageError extends Error {}

function version(): string {
  const pkg: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return typeof pkg === 'object' && pkg !== null && 'version' in pkg && typeof pkg.version === 'string'
    ? pkg.version
    : '0.0.0';
}

function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function intArg(value: string | undefined, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new UsageError(`--${name} must be a whole number`);
  const n = Number(value);
  if (n < min || n > max) throw new UsageError(`--${name} must be between ${min} and ${max}`);
  return n;
}

function defaultStop(): { promise: Promise<void>; dispose(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  const onSignal = () => resolve();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return {
    promise,
    dispose: () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    },
  };
}

function statusLine(s: SpendSummary): string {
  const budget = s.budget.monthlyUsd === null ? '' : ` / budget ${money(s.budget.monthlyUsd)}`;
  return `MTD ${money(s.monthToDateUsd)}  today ${money(s.todayUsd)}  forecast ${money(s.forecastMonthEndUsd)}${budget}  burn ${money(s.burnUsdPerHour)}/h (${burnTint(s.burnUsdPerHour)})`;
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  let debug = argv.includes('--debug');
  const out = (text: string) => io.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  try {
    const { values, positionals } = (() => {
      try {
        return parseArgs({
          args: argv,
          allowPositionals: true,
          strict: true,
          options: {
            help: { type: 'boolean', short: 'h' },
            version: { type: 'boolean', short: 'v' },
            json: { type: 'boolean' },
            'no-color': { type: 'boolean' },
            ascii: { type: 'boolean' },
            debug: { type: 'boolean' },
            by: { type: 'string' },
            limit: { type: 'string' },
            interval: { type: 'string' },
            port: { type: 'string' },
          },
        });
      } catch (error) {
        throw new UsageError((error as Error).message.split('\n')[0]!);
      }
    })();
    debug = values.debug === true;
    if (values.help) {
      io.stdout.write(HELP);
      return 0;
    }
    if (values.version) {
      out(version());
      return 0;
    }

    const home = io.home ?? homedir();
    const configPath = defaultConfigPath(home);
    const clock = io.now ?? Date.now;
    const env = io.env;
    const platform = io.platform ?? process.platform;
    const locale = `${env.LC_ALL ?? ''} ${env.LC_CTYPE ?? ''} ${env.LANG ?? ''}`;
    const isTTY = io.stdout.isTTY === true;
    const renderOpts = (now: number): RenderOpts => ({
      width: io.stdout.columns ?? 80,
      color: isTTY && !env.NO_COLOR && !values['no-color'],
      unicode: !values.ascii && (/utf-?8/i.test(locale) || platform === 'darwin'),
      now,
    });
    const load = (): Promise<Loaded> => {
      const now = clock();
      return loadAll({ now, configPath }, { home, env, fetch: io.fetch });
    };
    const json = (value: unknown) => out(JSON.stringify(value, null, 2));

    const [command = 'summary', ...rest] = positionals;
    const noExtra = (count = 0) => {
      if (rest.length > count) throw new UsageError(`unexpected argument: ${rest[count]}`);
    };

    switch (command) {
      case 'summary': {
        noExtra();
        const { summary } = await load();
        if (values.json) json(summary);
        else out(renderSummary(summary, renderOpts(summary.generatedAt)));
        return 0;
      }
      case 'where': {
        noExtra();
        const by = (values.by ?? 'repo') as SpendDimension;
        if (!DIMENSIONS.includes(by)) throw new UsageError(`--by must be one of ${DIMENSIONS.join(', ')}`);
        const limit = intArg(values.limit, 'limit', 10, 1, 1000);
        const { summary } = await load();
        const buckets = summary.breakdown[by].slice(0, limit);
        if (values.json) json(buckets);
        else if (!isTTY) {
          out(
            renderTsv([
              [by, 'costUsd', 'records', 'input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'],
              ...buckets.map((b) => [
                b.key,
                b.costUsd.toFixed(6),
                String(b.records),
                String(b.tokens.input),
                String(b.tokens.output),
                String(b.tokens.cacheRead),
                String(b.tokens.cacheWrite5m),
                String(b.tokens.cacheWrite1h),
              ]),
            ]),
          );
        } else out(renderWhere(summary, by, limit, renderOpts(summary.generatedAt)));
        return 0;
      }
      case 'tips': {
        noExtra();
        const { summary } = await load();
        if (values.json) json(summary.tips);
        else out(renderTips(summary, renderOpts(summary.generatedAt)));
        return 0;
      }
      case 'budget': {
        const [action, amount] = rest;
        if (action === undefined) {
          const { summary } = await load();
          if (values.json) json(summary.budget);
          else out(renderBudget(summary, renderOpts(summary.generatedAt)));
          return 0;
        }
        if (action === 'set') {
          noExtra(2);
          const usd = amount === undefined ? NaN : Number(amount.replace(/^\$/, ''));
          if (amount === undefined || amount.trim() === '' || !Number.isFinite(usd) || usd <= 0) {
            throw new UsageError('usage: fleet-spend budget set <usd>  (a positive number)');
          }
          saveBudget(usd, configPath);
          out(`Monthly budget set to ${money(usd)}.`);
          return 0;
        }
        if (action === 'clear') {
          noExtra(1);
          saveBudget(null, configPath);
          out('Monthly budget cleared.');
          return 0;
        }
        throw new UsageError(`unknown budget action: ${action} (use set <usd> or clear)`);
      }
      case 'check': {
        noExtra();
        const { summary } = await load();
        const over = summary.alerts.some((a) => a.level === 'over');
        const warn = summary.alerts.some((a) => a.level === 'warn');
        const code = over ? 2 : warn ? 1 : 0;
        if (values.json) json({ status: ['ok', 'warn', 'over'][code], alerts: summary.alerts });
        else out(`${['ok', 'warn', 'over'][code]}: ${statusLine(summary)}`);
        return code;
      }
      case 'json': {
        noExtra();
        json((await load()).summary);
        return 0;
      }
      case 'brief': {
        noExtra();
        json((await load()).brief);
        return 0;
      }
      case 'watch': {
        noExtra();
        const seconds = intArg(values.interval, 'interval', 60, 5, 86_400);
        const stop = io.stopSignal ? { promise: io.stopSignal, dispose: () => {} } : defaultStop();
        let stopped = false;
        void stop.promise.then(() => (stopped = true));
        const statePath = join(home, '.config/fleet/spend-state.json');
        try {
          while (!stopped) {
            try {
              const { config, summary } = await load();
              const sent = await dispatchAlerts(summary.alerts, config, statePath, {
                env,
                platform,
                fetch: io.fetch,
                fleetConfigPath: join(home, '.config/fleet/config.json'),
              });
              out(
                `${new Date(summary.generatedAt).toTimeString().slice(0, 8)}  ${statusLine(summary)}` +
                  (sent.length ? `  alerts sent: ${sent.length}` : ''),
              );
            } catch (error) {
              io.stderr.write(`fleet-spend: watch cycle failed: ${(error as Error).message}\n`);
              if (debug && error instanceof Error && error.stack) io.stderr.write(`${error.stack}\n`);
            }
            if (stopped) break;
            let timer: NodeJS.Timeout | undefined;
            await Promise.race([
              stop.promise,
              new Promise<void>((resolve) => (timer = setTimeout(resolve, seconds * 1000))),
            ]);
            clearTimeout(timer);
          }
        } finally {
          stop.dispose();
        }
        return 0;
      }
      case 'serve': {
        noExtra();
        let port: number;
        if (values.port !== undefined) {
          port = intArg(values.port, 'port', 0, PORT_MIN, PORT_MAX);
        } else {
          port = loadConfig(configPath, home).port;
        }
        if (!validPort(port)) throw new UsageError(`port must be between ${PORT_MIN} and ${PORT_MAX}`);
        const stop = io.stopSignal ? { promise: io.stopSignal, dispose: () => {} } : defaultStop();
        try {
          const running = await startServer({
            port,
            load: async () => {
              const { summary, brief } = await load();
              return { summary, brief };
            },
          });
          out(`Fleet Spend dashboard on ${running.url}  (Ctrl-C to stop)`);
          await stop.promise;
          await running.close();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
            throw new UsageError(`port ${port} is already in use; try --port <${PORT_MIN}-${PORT_MAX}>`);
          }
          throw error;
        } finally {
          stop.dispose();
        }
        return 0;
      }
      default:
        throw new UsageError(`unknown command: ${command} (see fleet-spend --help)`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`fleet-spend: ${message}\n`);
    if (debug && error instanceof Error && error.stack) io.stderr.write(`${error.stack}\n`);
    return 1;
  }
}

function isEntry(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(script)).href;
  } catch {
    return false;
  }
}

if (isEntry()) {
  main(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, env: process.env }).then(
    (code) => {
      process.exitCode = code;
    },
  );
}
