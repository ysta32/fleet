import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { IngestContext, IngestResult, Ingester, UsageRecord } from '../contracts.js';

const WT_RE = /^(.*)\/\.orch\/wt\/([^/]+)(?:\/|$)/;

async function walk(dir: string, since: number, out: string[]): Promise<void> {
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
        if ((await stat(p)).mtimeMs >= since) out.push(p);
      } catch {
        /* unreadable file: skip */
      }
    }
  }
}

function gitRootName(cwd: string): string {
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

function toRecord(line: unknown): { key: string | undefined; rec: UsageRecord } | undefined {
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
  let repo: string | undefined;
  let army: string | undefined;
  let task: string | undefined;
  if (cwd) {
    const m = WT_RE.exec(cwd);
    if (m) {
      repo = basename(m[1] as string);
      task = m[2];
    } else {
      repo = gitRootName(cwd);
    }
    if (m) army = repo;
    else if (branch?.startsWith('orch/')) army = `${repo}:${branch}`;
  }

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
  if (repo) rec.repo = repo;
  if (branch) rec.branch = branch;
  const sid = str(o.sessionId);
  if (sid) rec.sessionId = sid;
  if (army) rec.army = army;
  if (task) rec.task = task;
  return { key, rec };
}

export const ingestClaudeCode: Ingester = async (ctx: IngestContext): Promise<IngestResult> => {
  const root = ctx.config.paths.claudeProjectsDir ?? join(ctx.home, '.claude', 'projects');
  if (!existsSync(root))
    return { source: 'claude-code', records: [], status: 'missing', note: 'projects dir not found' };

  const files: string[] = [];
  await walk(root, ctx.since, files);
  files.sort();

  const byKey = new Map<string, UsageRecord>();
  const loose: UsageRecord[] = [];
  let errors = 0;
  for (const f of files) {
    try {
      const rl = createInterface({ input: createReadStream(f, { encoding: 'utf8' }), crlfDelay: Infinity });
      for await (const raw of rl) {
        if (!raw.includes('"assistant"')) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }
        const r = toRecord(parsed);
        if (!r) continue;
        if (r.key) {
          byKey.delete(r.key); // keep LAST occurrence
          byKey.set(r.key, r.rec);
        } else loose.push(r.rec);
      }
    } catch {
      errors++;
    }
  }
  const records = [...byKey.values(), ...loose].filter((r) => r.ts >= ctx.since);
  return {
    source: 'claude-code',
    records,
    status: 'ok',
    ...(errors ? { note: `${errors} file(s) unreadable` } : {}),
  };
};
