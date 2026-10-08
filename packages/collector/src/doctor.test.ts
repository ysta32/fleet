import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exitCode, formatLine, runDoctor, type DoctorInput } from './doctor.js';

function base(): DoctorInput {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-doctor-'));
  mkdirSync(join(dir, 'projects'));
  mkdirSync(join(dir, 'web'));
  writeFileSync(join(dir, 'web', 'index.html'), '<html></html>');
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, '{}');
  chmodSync(configPath, 0o600);
  return {
    port: 4599,
    claudeProjectsDir: join(dir, 'projects'),
    configPath,
    webDir: join(dir, 'web'),
    home: dir,
    platform: 'darwin',
    uid: 501,
    exec: async () => '',
    portFree: async () => true,
    probeFleet: async () => false,
  };
}

const levels = (lines: { level: string }[]): string[] => lines.map((l) => l.level);

describe('runDoctor', () => {
  it('is all ok when everything is healthy', async () => {
    const lines = await runDoctor(base());
    expect(levels(lines)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(exitCode(lines)).toBe(0);
  });

  it('fails on an old node', async () => {
    const lines = await runDoctor({ ...base(), nodeVersion: '18.19.0' });
    expect(lines[0]).toMatchObject({ level: 'fail' });
    expect(exitCode(lines)).toBe(2);
  });

  it('distinguishes a running collector from a foreign process on the port', async () => {
    const running = await runDoctor({ ...base(), portFree: async () => false, probeFleet: async () => true });
    expect(running[1]).toMatchObject({ level: 'ok' });
    expect(running[1]?.text).toContain('in use by the Fleet collector');
    const foreign = await runDoctor({ ...base(), portFree: async () => false });
    expect(foreign[1]).toMatchObject({ level: 'fail' });
    expect(foreign[1]?.text).toContain('another process');
  });

  it('warns when gh is unavailable and exits 1', async () => {
    const lines = await runDoctor({
      ...base(),
      exec: async (cmd) => {
        if (cmd === 'gh') throw new Error('not found');
        return '';
      },
    });
    expect(lines[3]).toMatchObject({ level: 'warn' });
    expect(exitCode(lines)).toBe(1);
  });

  it('fails when the config is group or world readable', async () => {
    const i = base();
    chmodSync(i.configPath, 0o644);
    const line = (await runDoctor(i))[4];
    expect(line).toMatchObject({ level: 'fail' });
    expect(line?.text).toContain('mode 644');
  });

  it('warns when the claude projects dir is missing', async () => {
    const lines = await runDoctor({ ...base(), claudeProjectsDir: '/nonexistent/fleet-projects' });
    expect(lines[2]).toMatchObject({ level: 'warn' });
  });

  it('reports launchd loaded, plist present but unloaded, and absent', async () => {
    const i = base();
    const unloaded = async (cmd: string): Promise<string> => {
      if (cmd === 'launchctl') throw new Error('Could not find service');
      return '';
    };
    const absent = (await runDoctor({ ...i, exec: unloaded }))[5];
    expect(absent).toMatchObject({ level: 'warn' });
    expect(absent?.text).toContain('not installed');
    const agents = join(i.home, 'Library', 'LaunchAgents');
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(agents, 'dev.fleet.collector.plist'), '');
    const present = (await runDoctor({ ...i, exec: unloaded }))[5];
    expect(present?.text).toContain('is not loaded');
    const calls: string[][] = [];
    const loaded = (
      await runDoctor({
        ...i,
        exec: async (cmd, args) => {
          calls.push([cmd, ...args]);
          return '';
        },
      })
    )[5];
    expect(loaded).toMatchObject({ level: 'ok' });
    expect(calls).toContainEqual(['launchctl', 'print', 'gui/501/dev.fleet.collector']);
  });

  it('skips launchd when FLEET_NO_LAUNCHD is set and never calls launchctl', async () => {
    const calls: string[] = [];
    await runDoctor({
      ...base(),
      noLaunchd: true,
      exec: async (cmd) => {
        calls.push(cmd);
        return '';
      },
    });
    expect(calls).not.toContain('launchctl');
  });

  it('fails when web assets are missing', async () => {
    const lines = await runDoctor({ ...base(), webDir: '/nonexistent/fleet-web' });
    expect(lines[6]).toMatchObject({ level: 'fail' });
  });
});

describe('formatLine', () => {
  it('aligns the level column', () => {
    expect(formatLine({ level: 'ok', text: 'Fact. Action.' })).toBe('ok    Fact. Action.');
    expect(formatLine({ level: 'warn', text: 'Fact.' })).toBe('warn  Fact.');
  });
});
