/**
 * Opt-in organization usage ingestion from the Anthropic Admin API and the OpenAI Usage API.
 *
 * Security: the admin key is read only from ctx.env[config.*AdminKeyEnv] (never process.env, never .env files),
 * is sent only in request headers, and never appears in notes, errors, or records. Response bodies are not echoed.
 *
 * Overlap: these reports are org-wide. When the same org key also backs local Claude Code / Codex usage, the same
 * tokens appear both here (source "anthropic-api" / "openai-api") and in the local ingesters. The APIs expose no
 * request ids, so dedupe across sources is not possible; records are tagged with their API source so callers can
 * filter one side out.
 */
import type { IngestContext, IngestResult, Ingester, SpendSource, UsageRecord } from '../contracts.js';

const TIMEOUT_MS = 15_000;
const MAX_PAGES = 200;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/organizations/usage_report/messages';
const OPENAI_URL = 'https://api.openai.com/v1/organization/usage/completions';

const OVERLAP_NOTE =
  'org-wide API usage; overlaps local usage when the same org key is used (not deduplicated)';

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** Internal-only errors whose notes are fixed strings chosen here, never derived from exception text. */
const PAGINATION_NOTES = {
  repeated: 'pagination cursor repeated',
  exceeded: `pagination exceeded ${MAX_PAGES} pages`,
} as const;

class PaginationError extends Error {
  constructor(readonly kind: keyof typeof PAGINATION_NOTES) {
    super(PAGINATION_NOTES[kind]);
  }
}

class ResponseShapeError extends Error {
  constructor() {
    super('unexpected response shape');
  }
}

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function disabledNote(source: SpendSource, keyEnv: string, enabled: boolean): string {
  const parts: string[] = [];
  if (!enabled) parts.push('set "apiIngest": true in spend.json');
  parts.push(`export an admin key in the ${keyEnv} environment variable`);
  return `${source} ingestion disabled: ${parts.join(' and ')}`;
}

/** Fetches every page; buildUrl receives the previous next_page cursor (undefined for the first page). */
async function fetchPages(
  ctx: IngestContext,
  buildUrl: (page: string | undefined) => string,
  headers: Record<string, string>,
): Promise<Json[]> {
  const buckets: Json[] = [];
  const seen = new Set<string>();
  let page: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const res = await ctx.fetch(buildUrl(page), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new HttpError(res.status);
    const body: unknown = await res.json();
    if (!isObj(body)) throw new ResponseShapeError();
    if (Array.isArray(body.data)) for (const b of body.data) if (isObj(b)) buckets.push(b);
    const next = str(body.next_page);
    if (body.has_more !== true || !next) return buckets;
    if (seen.has(next)) throw new PaginationError('repeated');
    seen.add(next);
    page = next;
  }
  throw new PaginationError('exceeded');
}

function errorNote(err: unknown): string {
  // Notes come only from fixed strings or numeric status codes; exception messages are never passed through.
  if (err instanceof HttpError) return `HTTP ${err.status}`;
  if (err instanceof PaginationError) return PAGINATION_NOTES[err.kind];
  if (err instanceof ResponseShapeError) return 'unexpected response shape';
  if (err instanceof SyntaxError) return 'invalid JSON response';
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'))
    return 'request timed out';
  // Anything else (network errors, injected fetch failures) may carry arbitrary text: keep it generic.
  return 'request failed';
}

function parseTs(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v * 1000; // unix seconds
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

async function run(
  ctx: IngestContext,
  source: SpendSource,
  keyEnv: string,
  fetchAll: (key: string) => Promise<Json[]>,
  toRecords: (bucket: Json, ts: number) => UsageRecord[],
  startField: string,
): Promise<IngestResult> {
  const key = ctx.env[keyEnv];
  if (!ctx.config.apiIngest || !key) {
    return {
      source,
      records: [],
      status: 'missing',
      note: disabledNote(source, keyEnv, ctx.config.apiIngest),
    };
  }
  try {
    const buckets = await fetchAll(key);
    const byId = new Map<string, UsageRecord>();
    for (const b of buckets) {
      const ts = parseTs(b[startField]);
      if (ts === undefined) continue;
      for (const r of toRecords(b, ts)) {
        const prev = byId.get(r.id);
        if (prev) {
          prev.tokens.input += r.tokens.input;
          prev.tokens.output += r.tokens.output;
          prev.tokens.cacheRead += r.tokens.cacheRead;
          prev.tokens.cacheWrite5m += r.tokens.cacheWrite5m;
          prev.tokens.cacheWrite1h += r.tokens.cacheWrite1h;
        } else byId.set(r.id, r);
      }
    }
    return { source, records: [...byId.values()], status: 'ok', note: OVERLAP_NOTE };
  } catch (err) {
    return { source, records: [], status: 'error', note: errorNote(err) };
  }
}

function isEmpty(r: UsageRecord): boolean {
  const t = r.tokens;
  return t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h === 0;
}

export const ingestAnthropicApi: Ingester = (ctx) =>
  run(
    ctx,
    'anthropic-api',
    ctx.config.anthropicAdminKeyEnv,
    (key) =>
      fetchPages(
        ctx,
        (page) => {
          const q = new URLSearchParams();
          q.set('starting_at', new Date(ctx.since).toISOString());
          q.set('bucket_width', '1d');
          q.append('group_by[]', 'model');
          if (page) q.set('page', page);
          return `${ANTHROPIC_URL}?${q.toString()}`;
        },
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      ),
    (bucket, ts) => {
      const out: UsageRecord[] = [];
      for (const r of Array.isArray(bucket.results) ? bucket.results : []) {
        if (!isObj(r)) continue;
        const model = str(r.model) ?? 'unknown';
        const cc = isObj(r.cache_creation) ? r.cache_creation : {};
        const rec: UsageRecord = {
          id: `anthropic-api:${ts}:${model}`,
          source: 'anthropic-api',
          ts,
          model,
          tokens: {
            input: num(r.uncached_input_tokens),
            output: num(r.output_tokens),
            cacheRead: num(r.cache_read_input_tokens),
            cacheWrite5m: num(cc.ephemeral_5m_input_tokens),
            cacheWrite1h: num(cc.ephemeral_1h_input_tokens),
          },
        };
        if (!isEmpty(rec)) out.push(rec);
      }
      return out;
    },
    'starting_at',
  );

export const ingestOpenAiApi: Ingester = (ctx) =>
  run(
    ctx,
    'openai-api',
    ctx.config.openaiAdminKeyEnv,
    (key) =>
      fetchPages(
        ctx,
        (page) => {
          const q = new URLSearchParams();
          q.set('start_time', String(Math.floor(ctx.since / 1000)));
          q.set('bucket_width', '1d');
          q.set('group_by', 'model');
          if (page) q.set('page', page);
          return `${OPENAI_URL}?${q.toString()}`;
        },
        { authorization: `Bearer ${key}` },
      ),
    (bucket, ts) => {
      const out: UsageRecord[] = [];
      for (const r of Array.isArray(bucket.results) ? bucket.results : []) {
        if (!isObj(r)) continue;
        const model = str(r.model) ?? 'unknown';
        const cached = num(r.input_cached_tokens);
        // OpenAI input_tokens includes cached tokens; split so cached input is priced at the cache-read rate.
        const rec: UsageRecord = {
          id: `openai-api:${ts}:${model}`,
          source: 'openai-api',
          ts,
          model,
          tokens: {
            input: Math.max(0, num(r.input_tokens) - cached),
            output: num(r.output_tokens),
            cacheRead: cached,
            cacheWrite5m: 0,
            cacheWrite1h: 0,
          },
        };
        if (!isEmpty(rec)) out.push(rec);
      }
      return out;
    },
    'start_time',
  );
