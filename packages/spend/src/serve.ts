import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { SpendBrief, SpendSummary } from './contracts.js';

export const PORT_MIN = 4500;
export const PORT_MAX = 4999;
export const CACHE_MS = 30_000;
const HOST = '127.0.0.1';

export interface ServeOptions {
  port: number;
  load: () => Promise<{ summary: SpendSummary; brief: SpendBrief }>;
  /** clock for the cache (tests inject) */
  clock?: () => number;
}

export interface RunningServer {
  server: Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

export function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= PORT_MIN && port <= PORT_MAX;
}

/** DNS-rebinding guard: only loopback Host headers are accepted. */
export function loopbackHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const m = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?$/i.exec(host.trim());
  return m !== null && (m[2] === undefined || Number(m[2]) === port);
}

function tokensCss(): string | undefined {
  try {
    return readFileSync(createRequire(import.meta.url).resolve('@fleet/ui/tokens.css'), 'utf8');
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

async function renderTab(summary: SpendSummary): Promise<string> {
  try {
    const [react, server, web] = await Promise.all([
      import('react'),
      import('react-dom/server'),
      import('./web/index.js'),
    ]);
    const createElement = react.createElement ?? react.default.createElement;
    const renderToString = server.renderToString ?? server.default.renderToString;
    return renderToString(createElement(web.SpendTab, { summary }));
  } catch {
    return `<p>Install react and react-dom to render the dashboard. Raw data: <a href="/api/spend">/api/spend</a></p><pre>${escapeHtml(JSON.stringify(summary, null, 2))}</pre>`;
  }
}

export function page(body: string, nonce: string, withTokens: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fleet Spend</title>
${withTokens ? '<link rel="stylesheet" href="/tokens.css">\n' : ''}<style nonce="${nonce}">body{margin:0;padding:24px;background:var(--bg,#14130f);color:var(--fg,#ece7da);font-family:var(--font-sans,system-ui,sans-serif)}</style>
</head>
<body>
<div id="root">${body}</div>
<script nonce="${nonce}">setInterval(function(){fetch('/api/spend',{cache:'no-store'}).then(function(r){if(r.ok)location.reload()}).catch(function(){})},60000);</script>
</body>
</html>
`;
}

export async function startServer(opts: ServeOptions): Promise<RunningServer> {
  if (!validPort(opts.port)) throw new RangeError(`port must be an integer in ${PORT_MIN}-${PORT_MAX}`);
  const clock = opts.clock ?? Date.now;
  const css = tokensCss();
  let cached: { at: number; value: Promise<{ summary: SpendSummary; brief: SpendBrief }> } | undefined;

  const data = () => {
    const now = clock();
    if (!cached || now - cached.at >= CACHE_MS) {
      const value = opts.load();
      const entry = { at: now, value };
      cached = entry;
      value.catch(() => {
        if (cached === entry) cached = undefined;
      });
    }
    return cached.value;
  };

  const send = (
    res: ServerResponse,
    status: number,
    type: string,
    body: string,
    extra: Record<string, string> = {},
  ) => {
    res.writeHead(status, {
      'Content-Type': type,
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      ...extra,
    });
    res.end(body);
  };
  const json = (res: ServerResponse, status: number, value: unknown) =>
    send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (!loopbackHost(req.headers.host, actualPort)) return json(res, 403, { error: 'forbidden host' });
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    try {
      if (path === '/api/spend') return json(res, 200, (await data()).summary);
      if (path === '/api/brief') return json(res, 200, (await data()).brief);
      if (path === '/tokens.css' && css !== undefined) return send(res, 200, 'text/css; charset=utf-8', css);
      if (path === '/') {
        const nonce = randomBytes(16).toString('base64');
        const html = page(await renderTab((await data()).summary), nonce, css !== undefined);
        return send(res, 200, 'text/html; charset=utf-8', html, {
          'Content-Security-Policy': `default-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        });
      }
      return json(res, 404, { error: 'not found' });
    } catch {
      return json(res, 500, { error: 'failed to collect spend data' });
    }
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.destroy();
    });
  });
  let actualPort = opts.port;
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(opts.port, HOST, () => {
      server.off('error', onError);
      // keep a handler after listen so a late socket/server error cannot crash the process
      server.on('error', (error: NodeJS.ErrnoException) => {
        process.stderr.write(`fleet-spend serve: server error (${error.code ?? 'unknown'})\n`);
      });
      resolve();
    });
  });
  const address = server.address();
  if (address && typeof address === 'object') actualPort = address.port;
  return {
    server,
    port: actualPort,
    url: `http://${HOST}:${actualPort}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
