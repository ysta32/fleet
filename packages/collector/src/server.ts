import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import http from 'node:http';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { PROTOCOL_VERSION } from '@fleet/shared';
import type { Alert, FleetConfig, FleetEvent, FleetSnapshot, HistoryResponse } from '@fleet/shared';

/** Minimal store surface the server needs (FleetStore satisfies this). */
export interface StoreLike {
  snapshot(): FleetSnapshot;
  history(from: number, to: number): HistoryResponse;
  on(ev: 'event', cb: (e: FleetEvent) => void): unknown;
  on(ev: 'change', cb: () => void): unknown;
  off(ev: 'event', cb: (e: FleetEvent) => void): unknown;
  off(ev: 'change', cb: () => void): unknown;
}

export interface CreateServerOptions {
  store: StoreLike;
  config: FleetConfig;
  webDir?: string;
  digestDir?: string;
  /** override loopback detection (tests simulate remote clients with this) */
  isLoopback?: (req: http.IncomingMessage) => boolean;
  /** secret salt for opaque remote ids; defaults to a random per-process value */
  redactSalt?: string | Uint8Array;
  /** called for validated POST /api/alerts bodies (local, Bearer-authenticated callers only) */
  onExternalAlert?: (alert: ExternalAlert) => void;
  /** extra GET JSON routes keyed by exact path (e.g. "/api/spend"); remote access only with shareContent */
  extraGet?: Record<string, (req: http.IncomingMessage) => Promise<unknown> | unknown>;
  /** host other devices can reach this collector at (LAN/Tailscale IP); defaults to the first external IPv4 */
  shareHost?: () => string | undefined;
}

/**
 * Alert injected by a local tool via POST /api/alerts. `kind` is outside the frozen AlertKind union,
 * so it is typed separately rather than widening the shared contract.
 */
export type ExternalAlert = Omit<Alert, 'kind'> & { kind: 'spend.budget' };

export type RedactSalt = string | Uint8Array;

export const SERVER_VERSION = '0.1.0';
const SNAPSHOT_MIN_INTERVAL_MS = 2000;
const PING_INTERVAL_MS = 15000;
const DEFAULT_HISTORY_MS = 6 * 3600_000;
const MAX_HISTORY_MS = 24 * 3600_000;
/** drop SSE clients that stop reading once this much output is buffered */
const MAX_SSE_BUFFER_BYTES = 8 * 1024 * 1024;
const TOKEN_COOKIE = 'fleet_token';
const COOKIE_MAX_AGE_S = 30 * 24 * 3600;
const MAX_SSE_CLIENTS = 32;
const MAX_ALERT_BODY_BYTES = 4096;
/** task ids are short tokens like "t04" / "07"; anything else may be free text */
const TASK_ID_RE = /^[\w.-]{1,16}$/;

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** Host header values accepted for token-less loopback access (DNS-rebinding defence). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
    "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
};

/** First non-internal IPv4 address (LAN or Tailscale), or undefined when offline. */
function defaultShareHost(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return undefined;
}

function defaultIsLoopback(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress;
  return addr !== undefined && LOOPBACK_ADDRS.has(addr);
}

/** Host header without port, lowercased. */
function hostName(req: http.IncomingMessage): string {
  const host = (req.headers.host ?? '').trim().toLowerCase();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

function digest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/** Constant-time token comparison; an empty configured token never matches. */
function tokenMatches(candidate: string | undefined, expected: string): boolean {
  if (!expected || candidate === undefined || candidate === '') return false;
  // hash both sides so timingSafeEqual always sees equal-length buffers
  return timingSafeEqual(digest(candidate), digest(expected));
}

function bearerToken(req: http.IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return undefined;
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(h);
  return m ? m[1] : undefined;
}

function cookieToken(req: http.IncomingMessage): string | undefined {
  const h = req.headers.cookie;
  if (typeof h !== 'string') return undefined;
  for (const part of h.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === TOKEN_COOKIE) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Opaque, stable per-install replacement for a projectId (which encodes the absolute path). */
export function opaqueProjectId(id: string, salt: RedactSalt): string {
  return 'p_' + createHash('sha256').update(salt).update(`:${id}`, 'utf8').digest('hex').slice(0, 12);
}

/** Agent ids may embed the projectId ("<projectId>:astra:<task>"); rewrite that part. */
function redactAgentId(id: string, projectId: string, salt: RedactSalt): string {
  if (id === projectId) return opaqueProjectId(id, salt);
  return id.startsWith(projectId + ':') ? opaqueProjectId(projectId, salt) + id.slice(projectId.length) : id;
}

const ALERT_TITLES: Record<string, string> = {
  'army.done': 'Army finished',
  'army.blocked': 'Army blocked',
  'ci.failed': 'CI failed',
  'session.waiting': 'Session waiting for input',
  'deploy.failed': 'Deploy failed',
  'spend.budget': 'Spend budget reached',
};

function safeTaskId(t: string | undefined): string | undefined {
  return t !== undefined && TASK_ID_RE.test(t) ? t : undefined;
}

export interface RedactOptions {
  /** remote clients may see orch STATUS/HANDOFF excerpts and other free text */
  shareContent?: boolean;
}

/**
 * Pure redaction for non-loopback clients; never mutates the input.
 * Always: Project.path = "" and every projectId-bearing field (incl. agent ids that embed it)
 * becomes opaqueProjectId(id, salt).
 * Unless shareContent: orch status/handoff text, worktree names, alert/session free text,
 * non-id task labels and non-https links are removed.
 */
export function redactSnapshot(s: FleetSnapshot, salt: RedactSalt, opts: RedactOptions = {}): FleetSnapshot {
  const share = opts.shareContent === true;
  const pid = (id: string): string => opaqueProjectId(id, salt);
  return {
    ...s,
    projects: s.projects.map((p) => {
      const out = { ...p, id: pid(p.id), path: '' };
      if (p.orch) {
        const knownTasks = new Set(p.orch.tasks.map((t) => t.id));
        out.orch = share
          ? { ...p.orch, projectId: pid(p.orch.projectId) }
          : {
              ...p.orch,
              projectId: pid(p.orch.projectId),
              statusText: '',
              handoffText: '',
              inflight: p.orch.inflight.map((x) => ({ ...x, worktree: '' })),
              worktrees: [],
              blocked: p.orch.blocked.flatMap((b) => {
                // keep only ids of known tasks; a free-text first word must never pass
                const id = /^[^\s:]+/.exec(b.trim())?.[0];
                return id !== undefined && TASK_ID_RE.test(id) && knownTasks.has(id) ? [id] : [];
              }),
            };
      }
      return out;
    }),
    sessions: s.sessions.map((x) => {
      const out = {
        ...x,
        projectId: pid(x.projectId),
        agentIds: x.agentIds.map((a) => redactAgentId(a, x.projectId, salt)),
      };
      if (!share) delete out.title;
      return out;
    }),
    agents: s.agents.map((a) => {
      const out = {
        ...a,
        id: redactAgentId(a.id, a.projectId, salt),
        projectId: pid(a.projectId),
        location: { ...a.location, projectId: pid(a.location.projectId) },
      };
      if (!share) {
        const task = safeTaskId(a.currentTask);
        if (task === undefined) delete out.currentTask;
        else out.currentTask = task;
      }
      return out;
    }),
    prs: s.prs.map((x) => ({
      ...x,
      projectId: pid(x.projectId),
      url: share || x.url.startsWith('https://github.com/') ? x.url : '',
    })),
    releases: s.releases.map((x) => ({ ...x, projectId: pid(x.projectId) })),
    deploys: s.deploys.map((x) => {
      const out = { ...x, projectId: pid(x.projectId) };
      if (!share && out.url !== undefined && !out.url.startsWith('https://')) delete out.url;
      return out;
    }),
    alerts: s.alerts.map((x) =>
      share
        ? { ...x, projectId: pid(x.projectId) }
        : { ...x, projectId: pid(x.projectId), title: ALERT_TITLES[x.kind] ?? x.kind, body: '' },
    ),
  };
}

/** Event counterpart of redactSnapshot. */
export function redactEvent(e: FleetEvent, salt: RedactSalt, opts: RedactOptions = {}): FleetEvent {
  const out: FleetEvent = { ...e, projectId: opaqueProjectId(e.projectId, salt) };
  if (e.agentId !== undefined) out.agentId = redactAgentId(e.agentId, e.projectId, salt);
  if (e.to) out.to = { ...e.to, projectId: opaqueProjectId(e.to.projectId, salt) };
  if (opts.shareContent !== true) {
    out.label = e.kind;
    delete out.data;
  }
  return out;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  sendRawJson(res, status, JSON.stringify(body));
}

function sendRawJson(res: http.ServerResponse, status: number, data: string): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

interface ParsedUrl {
  /** raw (still percent-encoded) pathname */
  rawPath: string;
  query: URLSearchParams;
}

function parseUrl(url: string | undefined): ParsedUrl {
  const u = url ?? '/';
  const q = u.indexOf('?');
  const rawPath = (q === -1 ? u : u.slice(0, q)).split('#')[0] || '/';
  const query = new URLSearchParams(q === -1 ? '' : u.slice(q + 1));
  return { rawPath, query };
}

function parseTime(v: string | null): number | undefined | null {
  if (v === null || v === '') return undefined;
  if (!/^\d{1,16}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function createServer(opts: CreateServerOptions): http.Server {
  const { store, config } = opts;
  const isLoopback = opts.isLoopback ?? defaultIsLoopback;
  const redactOpts: RedactOptions = { shareContent: config.shareContent === true };
  const salt: RedactSalt = opts.redactSalt ?? randomBytes(32);
  const extraGet = opts.extraGet ?? {};

  /* Redacted snapshot cache, shared by all remote readers. It is only valid while an
   * invalidation listener is attached, i.e. while at least one SSE client is connected. */
  let sseClients = 0;
  let redactedCache: { snap: FleetSnapshot; json: string } | undefined;
  const invalidate = (): void => {
    redactedCache = undefined;
  };
  function remoteSnapshot(): { snap: FleetSnapshot; json: string } {
    if (redactedCache) return redactedCache;
    const snap = redactSnapshot(store.snapshot(), salt, redactOpts);
    const entry = { snap, json: JSON.stringify(snap) };
    if (sseClients > 0) redactedCache = entry;
    return entry;
  }
  const rawAllowed: unknown = (config as FleetConfig & { allowedHosts?: unknown }).allowedHosts;
  const extraHosts = new Set(
    (Array.isArray(rawAllowed) ? rawAllowed : [])
      .filter((h): h is string => typeof h === 'string')
      .map((h) => h.trim().toLowerCase()),
  );

  /** DNS-rebinding defence: only known host names may reach the server at all. */
  function hostAllowed(req: http.IncomingMessage): boolean {
    const h = hostName(req);
    if (!h) return false;
    if (LOOPBACK_HOSTS.has(h)) return true;
    if (!config.lan) return false;
    if (isIP(h) !== 0) return true;
    if (h.startsWith('[') && h.endsWith(']') && isIP(h.slice(1, -1)) === 6) return true;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.(local|ts\.net)$/.test(h)) return true;
    return extraHosts.has(h);
  }
  const webRoot = opts.webDir ? path.resolve(opts.webDir) : undefined;
  let webRootReal: Promise<string | undefined> | undefined;
  const realWebRoot = (): Promise<string | undefined> => {
    if (!webRoot) return Promise.resolve(undefined);
    webRootReal ??= fsp.realpath(webRoot).catch(() => undefined);
    return webRootReal;
  };

  /** true when the client is local: loopback socket AND a loopback Host header. */
  function isLocal(req: http.IncomingMessage): boolean {
    return isLoopback(req) && LOOPBACK_HOSTS.has(hostName(req));
  }

  function setSessionCookie(req: http.IncomingMessage, res: http.ServerResponse): void {
    const proto = String(req.headers['x-forwarded-proto'] ?? '')
      .split(',')[0]!
      .trim()
      .toLowerCase();
    res.setHeader(
      'Set-Cookie',
      `${TOKEN_COOKIE}=${encodeURIComponent(config.token)}; Path=/; HttpOnly; SameSite=Strict; ` +
        `Max-Age=${COOKIE_MAX_AGE_S}${proto === 'https' ? '; Secure' : ''}`,
    );
  }

  /** Same-origin check for state-changing browser requests: Origin (if sent) must match Host. */
  function crossSite(req: http.IncomingMessage): boolean {
    const site = req.headers['sec-fetch-site'];
    if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return true;
    const origin = req.headers.origin;
    if (origin === undefined) return false;
    if (typeof origin !== 'string' || origin === 'null') return true;
    let host: string;
    try {
      host = new URL(origin).host.toLowerCase();
    } catch {
      return true;
    }
    return host !== String(req.headers.host ?? '').toLowerCase();
  }

  /**
   * URL another device on the LAN/tailnet can open (no token: the device still has to unlock).
   * Only computed for local requests when remote access is enabled.
   */
  function shareUrl(req: http.IncomingMessage): string | undefined {
    const host = (opts.shareHost ?? defaultShareHost)();
    const port = req.socket.localPort;
    if (!host || !port) return undefined;
    const literal = isIP(host) === 6 ? `[${host}]` : host;
    let url: URL;
    try {
      url = new URL(`http://${literal}:${port}/`);
    } catch {
      return undefined;
    }
    return url.toString();
  }

  /** Failed POST /api/session attempts per client address, to slow token guessing. */
  const sessionFailures = new Map<string, { count: number; resetAt: number }>();
  const SESSION_MAX_FAILURES = 10;
  const SESSION_WINDOW_MS = 60_000;

  /**
   * POST /api/session: exchanges `Authorization: Bearer <token>` for the HttpOnly session cookie,
   * so the web UI never has to put the token in a URL. 204 on success, 401 on a bad token.
   */
  function handleSession(req: http.IncomingMessage, res: http.ServerResponse): void {
    req.resume(); // no body expected; drain anything sent
    if (crossSite(req)) return sendError(res, 403, 'cross-site request');
    const key = req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    let entry = sessionFailures.get(key);
    if (entry && entry.resetAt <= now) {
      sessionFailures.delete(key);
      entry = undefined;
    }
    if (entry && entry.count >= SESSION_MAX_FAILURES) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return sendError(res, 429, 'too many attempts');
    }
    if (!tokenMatches(bearerToken(req), config.token)) {
      if (sessionFailures.size > 10_000) sessionFailures.clear();
      sessionFailures.set(key, {
        count: (entry?.count ?? 0) + 1,
        resetAt: entry?.resetAt ?? now + SESSION_WINDOW_MS,
      });
      res.setHeader('WWW-Authenticate', 'Bearer');
      return sendError(res, 401, 'unauthorized');
    }
    sessionFailures.delete(key);
    setSessionCookie(req, res);
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(204);
    res.end();
  }

  function authorize(req: http.IncomingMessage, query: URLSearchParams, res: http.ServerResponse): boolean {
    const queryToken = query.get('token') ?? undefined;
    if (tokenMatches(queryToken, config.token)) {
      // lets the web UI load its own assets after being opened with ?token=
      setSessionCookie(req, res);
      return true;
    }
    return tokenMatches(bearerToken(req), config.token) || tokenMatches(cookieToken(req), config.token);
  }

  function handleEvents(req: http.IncomingMessage, res: http.ServerResponse, local: boolean): void {
    if (sseClients >= MAX_SSE_CLIENTS) {
      res.setHeader('Retry-After', '10');
      return sendError(res, 503, 'too many event streams');
    }
    const snapshotJson = (): string => (local ? JSON.stringify(store.snapshot()) : remoteSnapshot().json);
    const viewEvent = (e: FleetEvent): FleetEvent => (local ? e : redactEvent(e, salt, redactOpts));

    // the cache invalidator must run before any client's onChange, so attach it first
    if (sseClients === 0) store.on('change', invalidate);
    sseClients++;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);

    let closed = false;
    let lastSnapshotAt = 0;
    let pending: NodeJS.Timeout | undefined;

    const write = (chunk: string): void => {
      if (closed) return;
      res.write(chunk);
      if (res.writableLength > MAX_SSE_BUFFER_BYTES) cleanup(true);
    };
    const sendSnapshot = (): void => {
      if (closed) return;
      lastSnapshotAt = Date.now();
      let json: string;
      try {
        json = snapshotJson();
      } catch {
        cleanup(true);
        return;
      }
      write(`event: snapshot\ndata: ${json}\n\n`);
    };
    const onChange = (): void => {
      if (closed || pending) return;
      const wait = lastSnapshotAt + SNAPSHOT_MIN_INTERVAL_MS - Date.now();
      if (wait <= 0) {
        sendSnapshot();
      } else {
        pending = setTimeout(() => {
          pending = undefined;
          sendSnapshot();
        }, wait);
      }
    };
    const onEvent = (e: FleetEvent): void => {
      if (closed) return;
      try {
        write(`event: fleet\ndata: ${JSON.stringify(viewEvent(e))}\n\n`);
      } catch {
        cleanup(true);
      }
    };
    const ping = setInterval(() => write(': ping\n\n'), PING_INTERVAL_MS);

    function cleanup(destroy = false): void {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      if (pending) clearTimeout(pending);
      pending = undefined;
      store.off('change', onChange);
      store.off('event', onEvent);
      sseClients--;
      if (sseClients === 0) {
        store.off('change', invalidate);
        redactedCache = undefined;
      }
      if (destroy) res.destroy();
    }

    store.on('change', onChange);
    store.on('event', onEvent);
    req.on('close', () => cleanup());
    res.on('close', () => cleanup());
    res.on('error', () => cleanup(true));
    write('retry: 3000\n\n');
    sendSnapshot();
  }

  async function handleDigest(res: http.ServerResponse, local: boolean): Promise<void> {
    if (!local && config.shareContent !== true) return sendError(res, 403, 'forbidden');
    if (!opts.digestDir) return sendError(res, 404, 'not found');
    let raw: string;
    try {
      raw = await fsp.readFile(path.join(opts.digestDir, 'latest.json'), 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR')
        return sendError(res, 404, 'not found');
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return sendError(res, 502, 'invalid digest');
    }
    sendJson(res, 200, parsed);
  }

  async function serveFile(res: http.ServerResponse, file: string, size: number): Promise<void> {
    const ext = path.extname(file).toLowerCase();
    const isIndex = path.basename(file) === 'index.html';
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': size,
      'Cache-Control': isIndex || ext === '.webmanifest' ? 'no-cache' : 'public, max-age=3600',
    });
    if (res.req.method === 'HEAD') {
      res.end();
      return;
    }
    await new Promise<void>((resolve) => {
      const stream = createReadStream(file);
      stream.on('error', () => {
        res.destroy();
        resolve();
      });
      stream.on('end', resolve);
      res.on('close', () => {
        stream.destroy();
        resolve();
      });
      stream.pipe(res);
    });
  }

  /** Resolve a file inside the web root, following symlinks only if they stay inside it. */
  async function statInRoot(root: string, rel: string): Promise<{ file: string; size: number } | undefined> {
    const candidate = path.resolve(root, rel);
    if (!isWithin(root, candidate)) return undefined;
    let real: string;
    try {
      real = await fsp.realpath(candidate);
    } catch {
      return undefined;
    }
    if (!isWithin(root, real)) return undefined;
    const st = await fsp.stat(real).catch(() => undefined);
    if (st?.isDirectory()) {
      return statInRoot(root, path.join(path.relative(root, real), 'index.html'));
    }
    if (!st?.isFile()) return undefined;
    return { file: real, size: st.size };
  }

  async function handleStatic(res: http.ServerResponse, rawPath: string): Promise<void> {
    const root = await realWebRoot();
    if (!root) return sendError(res, 404, 'not found');
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      return sendError(res, 400, 'bad request');
    }
    if (decoded.includes('\0') || decoded.includes('\\')) return sendError(res, 400, 'bad request');
    const segments = decoded.split('/').filter((s) => s !== '');
    if (segments.some((s) => s === '..' || s === '.')) return sendError(res, 403, 'forbidden');
    // never serve dotfiles (.env, .git, ...)
    if (segments.some((s) => s.startsWith('.'))) return sendError(res, 404, 'not found');

    const found = await statInRoot(root, segments.join('/'));
    if (found) return serveFile(res, found.file, found.size);

    // SPA fallback: route-like paths (no extension) get index.html
    const last = segments[segments.length - 1] ?? '';
    if (!last.includes('.')) {
      const index = await statInRoot(root, 'index.html');
      if (index) return serveFile(res, index.file, index.size);
    }
    sendError(res, 404, 'not found');
  }

  /** Reads a request body up to `limit` bytes; resolves undefined when the limit is exceeded. */
  function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer | undefined> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false;
      req.on('data', (c: Buffer) => {
        if (done) return;
        size += c.length;
        if (size > limit) {
          done = true;
          resolve(undefined);
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (done) return;
        done = true;
        resolve(Buffer.concat(chunks));
      });
      req.on('error', (err) => {
        if (done) return;
        done = true;
        reject(err);
      });
    });
  }

  /**
   * POST /api/alerts: local tools only. Requires a loopback socket + loopback Host and a Bearer
   * token even on loopback (a browser page cannot attach it cross-origin: CSRF protection).
   */
  async function handlePostAlert(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const tooLarge = (): void => {
      res.setHeader('Connection', 'close');
      sendError(res, 413, 'payload too large');
    };
    if (!isLocal(req)) return sendError(res, 403, 'forbidden');
    if (!tokenMatches(bearerToken(req), config.token)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return sendError(res, 401, 'unauthorized');
    }
    const ctype = String(req.headers['content-type'] ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase();
    if (ctype !== 'application/json') return sendError(res, 415, 'expected application/json');
    const declared = req.headers['content-length'];
    if (declared !== undefined && !(Number(declared) <= MAX_ALERT_BODY_BYTES)) return tooLarge();
    const raw = await readBody(req, MAX_ALERT_BODY_BYTES);
    if (raw === undefined) return tooLarge();

    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return sendError(res, 400, 'invalid json');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      return sendError(res, 400, 'invalid alert');
    const b = body as Record<string, unknown>;
    const clean = (v: unknown, max: number, min: number): v is string =>
      typeof v === 'string' && v.length >= min && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
    if (
      b.kind !== 'spend.budget' ||
      !clean(b.id, 64, 1) ||
      !clean(b.title, 80, 1) ||
      !clean(b.body, 200, 0)
    ) {
      return sendError(res, 400, 'invalid alert');
    }
    const alert: ExternalAlert = {
      id: b.id,
      kind: 'spend.budget',
      projectId: '',
      title: b.title,
      body: b.body,
      at: Date.now(),
    };
    opts.onExternalAlert?.(alert);
    res.writeHead(204);
    res.end();
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

    if (!hostAllowed(req)) return sendError(res, 421, 'misdirected request');
    const { rawPath, query } = parseUrl(req.url);

    const method = req.method ?? 'GET';
    if (rawPath === '/api/alerts') {
      if (method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendError(res, 405, 'method not allowed');
      }
      return handlePostAlert(req, res);
    }
    if (rawPath === '/api/session') {
      if (method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendError(res, 405, 'method not allowed');
      }
      return handleSession(req, res);
    }
    if (method !== 'GET' && method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendError(res, 405, 'method not allowed');
    }
    const local = isLocal(req);
    const api = rawPath === '/api' || rawPath.startsWith('/api/');
    // Remote clients may load the static web shell (it holds no fleet data) so a fresh browser can
    // reach the token gate; every /api route still requires the token. authorize() also turns a
    // valid ?token= link on a shell path into the session cookie.
    if (!local && !authorize(req, query, res) && api) {
      res.removeHeader('Set-Cookie');
      res.setHeader('WWW-Authenticate', 'Bearer');
      return sendError(res, 401, 'unauthorized');
    }

    if (api) {
      switch (rawPath) {
        case '/api/health': {
          const share = local && config.lan ? shareUrl(req) : undefined;
          return sendJson(res, 200, {
            ok: true,
            version: SERVER_VERSION,
            protocol: PROTOCOL_VERSION,
            ...(share ? { shareUrl: share } : {}),
          });
        }
        case '/api/snapshot': {
          if (!local) return sendRawJson(res, 200, remoteSnapshot().json);
          return sendJson(res, 200, store.snapshot());
        }
        case '/api/events':
          if (method === 'HEAD') return sendError(res, 405, 'method not allowed');
          return handleEvents(req, res, local);
        case '/api/history': {
          const fromQ = parseTime(query.get('from'));
          const toQ = parseTime(query.get('to'));
          if (fromQ === null || toQ === null) return sendError(res, 400, 'invalid from/to');
          const to = toQ ?? Date.now();
          let from = fromQ ?? to - DEFAULT_HISTORY_MS;
          if (from > to) return sendError(res, 400, 'from must be <= to');
          if (to - from > MAX_HISTORY_MS) from = to - MAX_HISTORY_MS;
          const h = store.history(from, to);
          return sendJson(
            res,
            200,
            local
              ? h
              : {
                  ...h,
                  frames: h.frames.map((f) => redactSnapshot(f, salt, redactOpts)),
                  events: h.events.map((e) => redactEvent(e, salt, redactOpts)),
                },
          );
        }
        case '/api/digest/latest':
          return handleDigest(res, local);
        default: {
          if (!Object.prototype.hasOwnProperty.call(extraGet, rawPath))
            return sendError(res, 404, 'not found');
          const route = extraGet[rawPath];
          if (typeof route !== 'function') return sendError(res, 404, 'not found');
          if (!local && config.shareContent !== true) return sendError(res, 403, 'forbidden');
          const result = await route(req);
          if (result === undefined) return sendError(res, 404, 'not found');
          return sendJson(res, 200, result);
        }
      }
    }
    return handleStatic(res, rawPath);
  }

  return http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendError(res, 500, 'internal error');
      else res.destroy();
    });
  });
}
