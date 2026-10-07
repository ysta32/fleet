import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, saveBudget } from './config.js';

describe('spend config', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spend-config-'));
    path = join(dir, 'spend.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns independent defaults for missing files', () => {
    const config = loadConfig(path);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config.port).toBe(4917);
    expect(config.budget).toEqual({ monthlyUsd: null, warnAt: [0.5, 0.8] });
    config.budget.warnAt.push(0.9);
    config.notify.macos = false;
    expect(loadConfig(path)).toEqual(DEFAULT_CONFIG);
  });

  it('merges partial nested objects and replaces arrays', () => {
    writeFileSync(
      path,
      JSON.stringify({
        budget: { monthlyUsd: 250, warnAt: [0.6] },
        notify: { macos: false },
        paths: { cursorExportPath: 'fixture.csv' },
        apiIngest: true,
        anthropicAdminKeyEnv: 'TEST_ADMIN',
        port: 4900,
      }),
    );
    expect(loadConfig(path)).toEqual({
      ...DEFAULT_CONFIG,
      budget: { monthlyUsd: 250, warnAt: [0.6] },
      notify: { ...DEFAULT_CONFIG.notify, macos: false },
      paths: { cursorExportPath: 'fixture.csv' },
      apiIngest: true,
      anthropicAdminKeyEnv: 'TEST_ADMIN',
      port: 4900,
    });
  });

  it.each([4899, 5000, 4917.5, '4917', null])('defaults invalid port %s', (port) => {
    writeFileSync(path, JSON.stringify({ port }));
    expect(loadConfig(path).port).toBe(4917);
  });

  it('accepts the upper port bound and zero budget', () => {
    writeFileSync(path, JSON.stringify({ port: 4999, budget: { monthlyUsd: 0 } }));
    expect(loadConfig(path).port).toBe(4999);
    expect(loadConfig(path).budget).toEqual({ monthlyUsd: 0, warnAt: [0.5, 0.8] });
  });

  it.each([-1, '100', {}, 1e309])('defaults invalid budget %s', (monthlyUsd) => {
    writeFileSync(path, JSON.stringify({ budget: { monthlyUsd, warnAt: [0.5, 1.1] } }));
    expect(loadConfig(path).budget).toEqual(DEFAULT_CONFIG.budget);
  });

  it('ignores invalid nested field types', () => {
    writeFileSync(
      path,
      JSON.stringify({ budget: [], notify: { fleet: 'false' }, paths: null, apiIngest: 'true' }),
    );
    expect(loadConfig(path)).toEqual(DEFAULT_CONFIG);
  });

  it('preserves unknown keys and hardens permissions when saving', () => {
    const raw = { custom: { keep: true }, notify: { fleet: false }, budget: { warnAt: [0.7], custom: 42 } };
    writeFileSync(path, JSON.stringify(raw), { mode: 0o644 });
    saveBudget(150, path);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      ...raw,
      budget: { ...raw.budget, monthlyUsd: 150 },
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('creates parent directories and supports clearing the budget', () => {
    path = join(dir, 'nested', 'spend.json');
    saveBudget(100, path);
    expect(loadConfig(path).budget.monthlyUsd).toBe(100);
    saveBudget(null, path);
    expect(loadConfig(path).budget.monthlyUsd).toBeNull();
  });

  it.each([-1, NaN, Infinity])('rejects invalid saved budgets %s', (value) => {
    expect(() => saveBudget(value, path)).toThrow(RangeError);
  });

  it('does not overwrite corrupt configuration', () => {
    writeFileSync(path, '{broken');
    expect(() => loadConfig(path)).toThrow();
    expect(() => saveBudget(100, path)).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('{broken');
  });
});
