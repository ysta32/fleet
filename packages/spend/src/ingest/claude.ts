import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { createInterface } from 'node:readline';
import type { IngestContext, IngestResult, Ingester, UsageRecord } from '../contracts.js';

/** a parsed log line: record without filesystem-derived attribution, plus the raw cwd */
type Row = { key: string | undefined; rec: UsageRecord; cwd: string | undefined };

const WT_RE = /^(.*)\/\.orch\/wt\/([^/]+)(?:\/|$)/;

interface FileStat {
  path: string;
  mtimeMs: number;
  ctimeMs: number;
  size: number;
}

async function walk(dir: string, since: number, out: FileStat[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(p, since, out);
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      try {
        const st = await stat(p);
        if (st.mtimeMs >= since)
          out.push({ path: p, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, size: st.size });
      } catch {
        /* unreadable file: skip */
      }
    }
  }
}

function gitRootName(cwd: string, memo: Map<string, string>): string {
  const hit = memo.get(cwd);
  if (hit !== undefined) return hit;
  const name = findGitRootName(cwd);
  memo.set(cwd, name);
  return name;
}

function findGitRootName(cwd: string): string {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return basename(dir);
    const up = dirname(dir);
    if (up === dir) return basename(cwd);
    dir = up;
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function toRecord(line: unknown): Row | undefined {
  const o = obj(line);
  if (!o || o.type !== 'assistant') return undefined;
  const msg = obj(o.message);
  const usage = obj(msg?.usage);
  if (!msg || !usage) return undefined;
  const model = str(msg.model);
  if (!model || model === '<synthetic>') return undefined;
  const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
  if (!Number.isFinite(ts)) return undefined;

  const creation = obj(usage.cache_creation);
  const total = num(usage.cache_creation_input_tokens);
  let w5 = total;
  let w1 = 0;
  if (creation) {
    w5 = num(creation.ephemeral_5m_input_tokens);
    w1 = num(creation.ephemeral_1h_input_tokens);
  }

  const msgId = str(msg.id);
  const reqId = str(o.requestId);
  const key = msgId && reqId ? `${msgId}:${reqId}` : undefined;
  const cwd = str(o.cwd);
  const branch = str(o.gitBranch);

  const rec: UsageRecord = {
    id: `claude-code:${key ?? `${str(o.sessionId) ?? 'nosession'}:${ts}:${str(o.uuid) ?? ''}`}`,
    source: 'claude-code',
    ts,
    model,
    tokens: {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
      cacheWrite5m: w5,
      cacheWrite1h: w1,
    },
  };
  if (branch) rec.branch = branch;
  const sid = str(o.sessionId);
  if (sid) rec.sessionId = sid;
  return { key, rec, cwd };
}

/**
 * repo/army/task depend on the filesystem (where `.git` is), not just the log line, so they are derived on
 * every scan (memoized per cwd within the scan) and applied to a fresh copy; cached rows stay untouched.
 */
function attribute(row: Row, memo: Map<string, string>): UsageRecord {
  const rec: UsageRecord = { ...row.rec };
  const { cwd } = row;
  if (!cwd) return rec;
  const branch = rec.branch;
  const m = WT_RE.exec(cwd);
  const repo = m ? basename(m[1] as string) : gitRootName(cwd, memo);
  rec.repo = repo;
  if (m) {
    rec.task = m[2];
    rec.army = repo;
  } else if (branch?.startsWith('orch/')) rec.army = `${repo}:${branch}`;
  return rec;
}

/**
 * Per-process cache of parsed rows, keyed by file path and invalidated by mtime, ctime (also bumped by chmod) or size. Long-lived hosts
 * (the Fleet daemon, `watch`, `serve`) rescan every ~30s; unchanged session logs are not re-read.
 * Only usage metadata is held (never prompt text); files that leave the scan window are evicted.
 */
const fileCache = new Map<string, { mtimeMs: number; ctimeMs: number; size: number; rows: Row[] }>();

/** Test hook: drop the parsed-file cache. */
export function clearClaudeCache(): void {
  fileCache.clear();
}

/** Test hook: number of cached files. */
export function claudeCacheSize(): number {
  return fileCache.size;
}

let parses = 0;
/** Test hook: how many files have been parsed (cache misses) in this process. */
export function claudeParseCount(): number {
  return parses;
}

/** Parse one log. On a read error the rows parsed so far are kept and `failed` is set (the result is not cached). */
async function parseFile(path: string): Promise<{ rows: Row[]; failed: boolean }> {
  parses++;
  const rows: Row[] = [];
  try {
    const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const raw of rl) {
      if (!raw.includes('"assistant"')) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const r = toRecord(parsed);
      if (r) rows.push(r);
    }
  } catch {
    return { rows, failed: true };
  }
  return { rows, failed: false };
}

export const ingestClaudeCode: Ingester = async (ctx: IngestContext): Promise<IngestResult> => {
  const root = ctx.config.paths.claudeProjectsDir ?? join(ctx.home, '.claude', 'projects');
  if (!existsSync(root)) {
    const prefix = root.endsWith(sep) ? root : root + sep;
    for (const k of fileCache.keys()) if (k.startsWith(prefix)) fileCache.delete(k);
    return { source: 'claude-code', records: [], status: 'missing', note: 'projects dir not found' };
  }

  const files: FileStat[] = [];
  await walk(root, ctx.since, files);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const memo = new Map<string, string>();
  const byKey = new Map<string, UsageRecord>();
  const loose: UsageRecord[] = [];
  const seen = new Set<string>();
  let errors = 0;
  for (const f of files) {
    seen.add(f.path);
    let rows = fileCache.get(f.path);
    if (!rows || rows.mtimeMs !== f.mtimeMs || rows.ctimeMs !== f.ctimeMs || rows.size !== f.size) {
      const res = await parseFile(f.path);
      rows = { mtimeMs: f.mtimeMs, ctimeMs: f.ctimeMs, size: f.size, rows: res.rows };
      if (res.failed) {
        fileCache.delete(f.path);
        errors++;
      } else fileCache.set(f.path, rows);
    }
    for (const r of rows.rows) {
      if (r.key) {
        byKey.delete(r.key); // keep LAST occurrence
        byKey.set(r.key, attribute(r, memo));
      } else loose.push(attribute(r, memo));
    }
  }
  for (const k of fileCache.keys()) if (!seen.has(k)) fileCache.delete(k);
  const records = [...byKey.values(), ...loose].filter((r) => r.ts >= ctx.since);
  return {
    source: 'claude-code',
    records,
    status: 'ok',
    ...(errors ? { note: `${errors} file(s) unreadable` } : {}),
  };
};
