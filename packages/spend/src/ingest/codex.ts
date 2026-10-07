import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import type { Ingester, UsageRecord } from '../contracts.js';

type ObjectValue = Record<string, unknown>;
type Counts = { input: number; cached: number; output: number };

function object(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined;
}

function counts(value: unknown): Counts | undefined {
  const data = object(value);
  if (!data) return undefined;
  const input = data.input_tokens;
  const output = data.output_tokens;
  const cached = data.cached_input_tokens ?? 0;
  if (
    typeof input !== 'number' ||
    !Number.isSafeInteger(input) ||
    input < 0 ||
    typeof output !== 'number' ||
    !Number.isSafeInteger(output) ||
    output < 0 ||
    typeof cached !== 'number' ||
    !Number.isSafeInteger(cached) ||
    cached < 0 ||
    cached > input
  )
    return undefined;
  return { input, cached, output };
}

async function* rollouts(directory: string): AsyncGenerator<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* rollouts(path);
    else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) yield path;
  }
}

async function readRollout(path: string, fileId: string, since: number): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  let sessionId: string | undefined;
  let repo: string | undefined;
  let branch: string | undefined;
  let model = 'unknown';
  let previous: Counts = { input: 0, cached: 0, output: 0 };
  let lineNumber = 0;
  const stream = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      lineNumber++;
      let event: ObjectValue | undefined;
      try {
        event = object(JSON.parse(line));
      } catch {
        continue;
      }
      if (!event) continue;
      const payload = object(event.payload);
      if (!payload) continue;
      if (event.type === 'session_meta') {
        if (typeof payload.id === 'string') sessionId = payload.id;
        if (typeof payload.cwd === 'string') repo = basename(payload.cwd) || undefined;
        const git = object(payload.git);
        if (typeof git?.branch === 'string') branch = git.branch;
        continue;
      }
      if (event.type === 'turn_context') {
        if (typeof payload.model === 'string' && payload.model) model = payload.model;
        continue;
      }
      if (event.type !== 'event_msg' || payload.type !== 'token_count') continue;
      const info = object(payload.info);
      if (!info) continue;
      const last = counts(info.last_token_usage);
      const total = counts(info.total_token_usage);
      if (
        total &&
        total.input === previous.input &&
        total.cached === previous.cached &&
        total.output === previous.output
      ) {
        previous = total;
        continue;
      }
      let usage = last;
      if (!usage && total) {
        const reset =
          total.input < previous.input || total.cached < previous.cached || total.output < previous.output;
        usage = reset
          ? total
          : {
              input: total.input - previous.input,
              cached: total.cached - previous.cached,
              output: total.output - previous.output,
            };
      }
      if (total) previous = total;
      else if (last)
        previous = {
          input: previous.input + last.input,
          cached: previous.cached + last.cached,
          output: previous.output + last.output,
        };
      if (!last && usage && usage.input === 0 && usage.cached === 0 && usage.output === 0) continue;
      const ts = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : NaN;
      if (!usage || usage.cached > usage.input || !Number.isFinite(ts) || ts < since) continue;
      records.push({
        id: `codex:${fileId}:${lineNumber}`,
        source: 'codex',
        ts,
        model,
        tokens: {
          input: usage.input - usage.cached,
          output: usage.output,
          cacheRead: usage.cached,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
        },
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(repo === undefined ? {} : { repo }),
        ...(branch === undefined ? {} : { branch }),
      });
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return records;
}

export const ingestCodex: Ingester = async (ctx) => {
  const directory = ctx.config.paths.codexSessionsDir ?? join(ctx.home, '.codex', 'sessions');
  const records: UsageRecord[] = [];
  let foundFile = false;
  let failed = false;
  try {
    for await (const path of rollouts(directory)) {
      foundFile = true;
      const fileId = createHash('sha256').update(relative(directory, path)).digest('hex');
      try {
        for (const record of await readRollout(path, fileId, ctx.since)) records.push(record);
      } catch {
        failed = true;
      }
    }
  } catch (error) {
    if (!foundFile && object(error)?.code === 'ENOENT') {
      return { source: 'codex', records, status: 'missing' };
    }
    failed = true;
  }
  return failed
    ? { source: 'codex', records, status: 'error', note: 'Could not read Codex session data' }
    : { source: 'codex', records, status: 'ok' };
};
