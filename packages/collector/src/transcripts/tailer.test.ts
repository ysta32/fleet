import { symlink, mkdir, mkdtemp, rm, utimes, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Tailer, type TranscriptFile } from './tailer.js';

let root: string;
let tailer: Tailer | undefined;
let got: { file: TranscriptFile; lines: string[] }[];
let files: TranscriptFile[];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'fleet-tailer-'));
  got = [];
  files = [];
});
afterEach(async () => {
  tailer?.stop();
  await rm(root, { recursive: true, force: true });
});

function make(recentWindowMs = 60_000): Tailer {
  const t = new Tailer({ root, recentWindowMs, pollMs: 30 });
  t.on('lines', (file: TranscriptFile, lines: string[]) => got.push({ file, lines }));
  t.on('file', (f: TranscriptFile) => files.push(f));
  tailer = t;
  return t;
}
const all = () => got.flatMap((g) => g.lines);
const wait = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe('Tailer', () => {
  it('emits initial lines and appended lines once', async () => {
    const dir = path.join(root, 'proj-a');
    await mkdir(dir);
    const f = path.join(dir, 'sess1.jsonl');
    await writeFile(f, '{"a":1}\n{"a":2}\n');
    await make().start();
    expect(all()).toEqual(['{"a":1}', '{"a":2}']);
    expect(files[0]).toMatchObject({
      sessionId: 'sess1',
      projectDir: 'proj-a',
      projectId: 'proj-a',
      isSubagent: false,
    });
    await appendFile(f, '{"a":3}\n');
    await wait(() => all().length >= 3);
    await new Promise((r) => setTimeout(r, 100));
    expect(all()).toEqual(['{"a":1}', '{"a":2}', '{"a":3}']);
    expect(files).toHaveLength(1);
  });

  it('holds a partial line until newline', async () => {
    const dir = path.join(root, 'p');
    await mkdir(dir);
    const f = path.join(dir, 's.jsonl');
    await writeFile(f, '{"x":1}\n{"x":');
    await make().start();
    expect(all()).toEqual(['{"x":1}']);
    await appendFile(f, '2}\n');
    await wait(() => all().length >= 2);
    expect(all()).toEqual(['{"x":1}', '{"x":2}']);
  });

  it('parses subagent paths', async () => {
    const dir = path.join(root, 'p', 'sess9', 'subagents');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'agent-abc.jsonl'), '{"s":1}\n');
    await make().start();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      sessionId: 'sess9',
      parentSessionId: 'sess9',
      agentFileId: 'abc',
      isSubagent: true,
      projectId: 'p',
    });
    expect(all()).toEqual(['{"s":1}']);
  });

  it('ignores files older than the recent window', async () => {
    const dir = path.join(root, 'p');
    await mkdir(dir);
    const f = path.join(dir, 'old.jsonl');
    await writeFile(f, '{"o":1}\n');
    const old = new Date(Date.now() - 3_600_000);
    await utimes(f, old, old);
    await make(1000).start();
    expect(files).toHaveLength(0);
    expect(all()).toEqual([]);
  });

  it('restarts after truncation', async () => {
    const dir = path.join(root, 'p');
    await mkdir(dir);
    const f = path.join(dir, 's.jsonl');
    await writeFile(f, '{"n":1}\n{"n":2}\n{"n":3}\n');
    await make().start();
    expect(all()).toHaveLength(3);
    await writeFile(f, '{"n":9}\n');
    await wait(() => all().length >= 4);
    expect(all().slice(3)).toEqual(['{"n":9}']);
  });

  it('reads only the tail of large files on discovery', async () => {
    const dir = path.join(root, 'p');
    await mkdir(dir);
    const line = JSON.stringify({ pad: 'x'.repeat(1000) }) + '\n';
    const n = Math.ceil((3 * 1024 * 1024) / line.length);
    await writeFile(path.join(dir, 'big.jsonl'), line.repeat(n));
    await make().start();
    expect(all().length).toBeGreaterThan(0);
    expect(all().length).toBeLessThan(n);
    expect(all().every((l) => l === line.trimEnd())).toBe(true);
  });

  it('keeps skipping a newline-less initial tail across polls', async () => {
    const dir = path.join(root, 'p');
    await mkdir(dir);
    const f = path.join(dir, 'nonl.jsonl');
    await writeFile(f, 'y'.repeat(3 * 1024 * 1024));
    await make().start();
    expect(all()).toEqual([]);
    await appendFile(f, 'rest-of-line\n{"ok":1}\n');
    await wait(() => all().length >= 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(all()).toEqual(['{"ok":1}']);
  });

  it('does not follow symlinks that leave the root', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'fleet-outside-'));
    try {
      await mkdir(path.join(outside, 'subagents'));
      await writeFile(path.join(outside, 'subagents', 'agent-z.jsonl'), '{"leak":1}\n');
      await writeFile(path.join(outside, 'ext.jsonl'), '{"leak":2}\n');
      await mkdir(path.join(outside, 'projdir'));
      await writeFile(path.join(outside, 'projdir', 'q.jsonl'), '{"leak":3}\n');
      const dir = path.join(root, 'p');
      await mkdir(path.join(dir, 'sess'), { recursive: true });
      await symlink(path.join(outside, 'subagents'), path.join(dir, 'sess', 'subagents'));
      await symlink(path.join(outside, 'ext.jsonl'), path.join(dir, 'ext.jsonl'));
      await symlink(path.join(outside, 'projdir'), path.join(root, 'linkproj'));
      await make().start();
      expect(files).toHaveLength(0);
      expect(all()).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
