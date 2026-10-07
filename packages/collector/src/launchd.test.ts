import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { install, installEnv, plistXml, uninstall } from './launchd.js';

const opts = { nodePath: '/usr/local/bin/node', cliPath: '/opt/fleet/dist/cli.js', logDir: '/tmp/l' };

describe('plistXml', () => {
  it('has label, keepalive, args and log paths', () => {
    const x = plistXml(opts);
    expect(x).toContain('<string>dev.fleet.collector</string>');
    expect(x).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(x).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    expect(x).toMatch(
      /<array>\s*<string>\/usr\/local\/bin\/node<\/string>\s*<string>\/opt\/fleet\/dist\/cli.js<\/string>\s*<string>start<\/string>\s*<\/array>/,
    );
    expect(x).toContain('<key>StandardOutPath</key>');
    expect(x).toContain('<key>StandardErrorPath</key>');
  });

  it('escapes XML special characters', () => {
    const x = plistXml({ ...opts, nodePath: '/a&b/<n>"\'' });
    expect(x).toContain('/a&amp;b/&lt;n&gt;&quot;&apos;');
    expect(x).not.toContain('/a&b/');
  });
});

describe('environment', () => {
  it('persists FLEET_* overrides and a PATH with the node dir', () => {
    const env = installEnv(
      { FLEET_PORT: '4520', FLEET_LAN: '1', FLEET_CONFIG: '/t/c.json', FLEET_DATA: '/t/d', HOME: '/h' },
      '/nvm/bin/node',
    );
    expect(env).toMatchObject({
      FLEET_PORT: '4520',
      FLEET_LAN: '1',
      FLEET_CONFIG: '/t/c.json',
      FLEET_DATA: '/t/d',
    });
    expect(env.HOME).toBeUndefined();
    expect(env.PATH).toBe('/nvm/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
    expect(installEnv({}, '/usr/local/bin/node')).toEqual({
      PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin',
    });
  });

  it('emits an escaped EnvironmentVariables dict', () => {
    const x = plistXml({ ...opts, env: { FLEET_CONFIG: '/a&b.json', PATH: '/bin' } });
    expect(x).toMatch(
      /<key>EnvironmentVariables<\/key>\s*<dict>[\s\S]*<key>FLEET_CONFIG<\/key>\s*<string>\/a&amp;b.json<\/string>/,
    );
    expect(plistXml(opts)).not.toContain('EnvironmentVariables');
  });
});

describe('install/uninstall with injected exec', () => {
  it('writes plist and bootstraps; boots out first when loaded', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fleet-ld-'));
    const calls: string[][] = [];
    let loaded = false;
    const exec = async (cmd: string, args: string[]): Promise<string> => {
      calls.push([cmd, ...args]);
      if (args[0] === 'print' && !loaded) throw new Error('not loaded');
      return '';
    };
    const p = await install({ ...opts, logDir: join(home, 'logs') }, { exec, home, uid: 501 });
    expect(p).toBe(join(home, 'Library/LaunchAgents/dev.fleet.collector.plist'));
    expect(readFileSync(p, 'utf8')).toContain('dev.fleet.collector');
    expect(calls.map((c) => c[1])).toEqual(['print', 'bootstrap']);
    expect(calls[1]).toEqual(['launchctl', 'bootstrap', 'gui/501', p]);

    loaded = true;
    calls.length = 0;
    await install({ ...opts, logDir: join(home, 'logs') }, { exec, home, uid: 501 });
    expect(calls.map((c) => c[1])).toEqual(['print', 'bootout', 'bootstrap']);

    calls.length = 0;
    expect(await uninstall({ exec, home, uid: 501 })).toBe(true);
    expect(calls.map((c) => c[1])).toEqual(['print', 'bootout']);
    expect(existsSync(p)).toBe(false);
    expect(await uninstall({ exec, home, uid: 501 })).toBe(false);
  });
});
