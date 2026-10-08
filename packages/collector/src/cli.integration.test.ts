import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The CLI is bundled into <root>/dist/cli.js next to <root>/web, mirroring the published layout.
// Every run uses a throwaway HOME and FLEET_NO_LAUNCHD=1 so the real ~/Library and launchctl are never touched.
const root = mkdtempSync(join(tmpdir(), 'fleet-cli-'));
const cli = join(root, 'dist', 'cli.js');
const LINE = /^(ok|warn|fail) +\S.*\.$/;

beforeAll(() => {
  buildSync({
    entryPoints: [join(dirname(fileURLToPath(import.meta.url)), 'cli.ts')],
    outfile: cli,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'silent',
  });
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function tempHome(): string {
  const home = mkdtempSync(join(root, 'home-'));
  mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
  return home;
}

function run(home: string, args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: {
      HOME: home,
      // node only: no gh, no launchctl, so results do not depend on the developer machine
      PATH: dirname(process.execPath),
      FLEET_NO_LAUNCHD: '1',
      ...extra,
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('fleet install --dry-run', () => {
  it('prints the plist path and contents and writes nothing', () => {
    const home = tempHome();
    const r = run(home, ['install', '--dry-run']);
    expect(r.code).toBe(0);
    const plist = join(home, 'Library', 'LaunchAgents', 'dev.fleet.collector.plist');
    expect(r.out).toContain(`Plist path: ${plist}`);
    expect(r.out).toContain('<string>dev.fleet.collector</string>');
    expect(r.out).toContain('<string>start</string>');
    expect(r.out).toContain('http://127.0.0.1:4747/');
    expect(existsSync(join(home, 'Library'))).toBe(false);
    expect(existsSync(join(home, '.config'))).toBe(false);
  });

  it('honours FLEET_PORT in the dashboard URL', () => {
    const r = run(tempHome(), ['install', '--dry-run'], { FLEET_PORT: '4561' });
    expect(r.out).toContain('http://127.0.0.1:4561/');
  });

  it('uses the configured port, with FLEET_PORT taking precedence, and leaves the config untouched', () => {
    const home = tempHome();
    const cfgPath = join(home, '.config', 'fleet', 'config.json');
    mkdirSync(dirname(cfgPath), { recursive: true });
    const body = JSON.stringify({ port: 4581 });
    writeFileSync(cfgPath, body);
    const r = run(home, ['install', '--dry-run']);
    expect(r.out).toContain('http://127.0.0.1:4581/');
    expect(run(home, ['install', '--dry-run'], { FLEET_PORT: '4582' }).out).toContain(
      'http://127.0.0.1:4582/',
    );
    expect(readFileSync(cfgPath, 'utf8')).toBe(body);
  });

  it('rejects unknown options with exit 2', () => {
    expect(run(tempHome(), ['install', '--wat']).code).toBe(2);
  });
});

describe('fleet install with FLEET_NO_LAUNCHD=1', () => {
  it('writes the plist under HOME and a 0600 config, without launchctl', () => {
    const home = tempHome();
    const r = run(home, ['install']);
    expect(r.code).toBe(0);
    expect(
      readFileSync(join(home, 'Library', 'LaunchAgents', 'dev.fleet.collector.plist'), 'utf8'),
    ).toContain('dev.fleet.collector');
    expect(statSync(join(home, '.config', 'fleet', 'config.json')).mode & 0o777).toBe(0o600);
    expect(r.out).toContain('launchctl was not called');
    const u = run(home, ['uninstall']);
    expect(u.code).toBe(0);
    expect(existsSync(join(home, 'Library', 'LaunchAgents', 'dev.fleet.collector.plist'))).toBe(false);
  });
});

describe('fleet doctor', () => {
  it('prints "level  fact. action" lines and exits 1 when only warnings remain', () => {
    const home = tempHome();
    run(home, ['install'], { FLEET_PORT: '4571' });
    const r = run(home, ['doctor'], { FLEET_PORT: '4571' });
    const lines = r.out.trimEnd().split('\n');
    expect(lines).toHaveLength(7);
    for (const l of lines) expect(l).toMatch(LINE);
    expect(lines.filter((l) => l.startsWith('fail'))).toEqual([]);
    expect(lines.find((l) => l.startsWith('warn'))).toContain('GitHub CLI');
    expect(r.code).toBe(1);
  });

  it('exits 2 and says how to fix a config with loose permissions', () => {
    const home = tempHome();
    run(home, ['install']);
    chmodSync(join(home, '.config', 'fleet', 'config.json'), 0o644);
    const r = run(home, ['doctor'], { FLEET_PORT: '4572' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/^fail +.*mode 644.*chmod 600/m);
  });

  it('exits 2 when another process holds the port', async () => {
    const srv = createServer();
    await new Promise<void>((res) => srv.listen(4573, '127.0.0.1', res));
    try {
      const home = tempHome();
      const r = await new Promise<{ code: number | null; out: string }>((resolve) => {
        // async spawn: the in-process server must keep serving while the CLI probes it
        import('node:child_process').then(({ execFile }) => {
          const child = execFile(
            process.execPath,
            [cli, 'doctor'],
            {
              env: { HOME: home, PATH: dirname(process.execPath), FLEET_NO_LAUNCHD: '1', FLEET_PORT: '4573' },
            },
            (_e, stdout) => resolve({ code: child.exitCode, out: stdout }),
          );
        });
      });
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/^fail +Port 4573 is in use by another process\./m);
    } finally {
      srv.close();
    }
  });
});

describe('npm package contents', () => {
  it('ships only dist, web and package.json: no tests, fixtures or .orch', () => {
    const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
    const r = spawnSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: pkgDir,
      encoding: 'utf8',
      env: { ...process.env, HOME: tempHome() },
    });
    expect(r.status).toBe(0);
    const files =
      (JSON.parse(r.stdout) as { files: { path: string }[] }[])[0]?.files.map((f) => f.path) ?? [];
    expect(files).toContain('package.json');
    for (const f of files) {
      expect(f).toMatch(/^(dist\/|web\/|package\.json$)/);
      expect(f).not.toMatch(/\.test\.|fixture|\.orch|\.tsbuildinfo|\.env/);
    }
  });
});
