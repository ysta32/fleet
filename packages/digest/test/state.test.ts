import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadState, saveState } from '../src/state.js';
import type { StateSnapshot } from '../src/types.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'overnight-state-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('state persistence', () => {
  it('returns an empty snapshot for missing files and directories', async () => {
    expect(await loadState(dir)).toEqual({ repoStats: {} });
    expect(await loadState(join(dir, 'missing'))).toEqual({ repoStats: {} });
  });
  it('creates parents and round trips snapshots while replacing previous state', async () => {
    const nested = join(dir, 'nested', 'state');
    const snapshot: StateSnapshot = {
      lastRunAt: '2026-10-07T12:00:00.000Z',
      repoStats: { 'owner/repo': { stars: 12, forks: 3 } },
    };
    await saveState(nested, snapshot);
    expect(await loadState(nested)).toEqual(snapshot);
    expect(JSON.parse(await readFile(join(nested, 'state.json'), 'utf8'))).toEqual(snapshot);
    await saveState(nested, { repoStats: {} });
    expect(await loadState(nested)).toEqual({ repoStats: {} });
    expect(await readdir(nested)).toEqual(['state.json']);
  });
  it('rejects corrupt state and non-missing filesystem errors', async () => {
    const path = join(dir, 'state.json');
    for (const value of ['{', 'null', '{}', '{"repoStats":{"repo":{"stars":"12","forks":0}}}']) {
      await writeFile(path, value);
      await expect(loadState(dir)).rejects.toThrow();
    }
    await rm(path);
    await mkdir(path);
    await expect(loadState(dir)).rejects.toThrow();
  });
  it('leaves the previous state intact when validation fails', async () => {
    await saveState(dir, { repoStats: {} });
    await expect(saveState(dir, { repoStats: { repo: { stars: NaN, forks: 0 } } })).rejects.toThrow();
    expect(await loadState(dir)).toEqual({ repoStats: {} });
    expect(await readdir(dir)).toEqual(['state.json']);
  });
  it('cleans temporary files and propagates a failed rename', async () => {
    await mkdir(join(dir, 'state.json'));
    await expect(saveState(dir, { repoStats: {} })).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['state.json']);
  });
  it('supports concurrent atomic writes without mixed or partial content', async () => {
    const snapshots = Array.from({ length: 8 }, (_, stars) => ({
      repoStats: { repo: { stars, forks: stars } },
    }));
    await saveState(dir, { repoStats: {} });
    await Promise.all(
      snapshots.map(async (snapshot) => {
        await saveState(dir, snapshot);
        expect(snapshots).toContainEqual(await loadState(dir));
      }),
    );
    expect(snapshots).toContainEqual(await loadState(dir));
    expect(await readdir(dir)).toEqual(['state.json']);
  });
});
