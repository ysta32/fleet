// Post-build: start the Next.js runtime after the first contentful paint, on every exported page.
//
// The static HTML already holds the whole page (the hero poster included), but `next build` emits the runtime
// chunks as <script async> in <head>: on a phone they download alongside the hero poster and run before the
// first frame, so the poster (the LCP element) waits on ~110 KB of JS and its hydration. Here each such tag is
// replaced by one inline loader at the end of <body> that adds the same scripts (async, same ids) once the
// first contentful paint has happened. The inline RSC payload (self.__next_f) stays where it is; the runtime
// reads it when it boots, as before. Browsers without paint timing load them on the next frame. Either way a
// LOAD_FALLBACK_MS timer is always armed, so a page that never paints or never gets a frame (a background tab)
// still boots.
//
// Strict by design: any runtime <script src="/_next/..."> this script cannot move exactly (a query string, a
// body, defer, type, an unknown attribute) fails the build rather than being left to run early, as does a moved
// chunk missing from out/. Re-running over rewritten pages re-validates the loader's manifest.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LOAD_FALLBACK_MS = 3000;
export const LOADER_ATTR = 'data-defer-hydration';
const CHUNK = /^\/_next\/static\/chunks\/[\w./-]+\.js$/;
/** The noModule polyfill: ignored by every browser that runs the runtime, so it stays where Next put it. */
const POLYFILL = /^\/_next\/static\/chunks\/polyfills-[\w-]+\.js$/;
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const ATTR = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const MANIFEST = /^\(function\(\)\{var s=(\[[^\n]*?\]),d=0;/;

/** The loader, as source: `list` is [src, id | null][] (JSON). */
const loader = (list) =>
  `(function(){var s=${list},d=0;function go(){if(d)return;d=1;for(var i=0;i<s.length;i++){var e=document.createElement("script");e.src=s[i][0];if(s[i][1])e.id=s[i][1];e.async=true;document.head.appendChild(e)}}` +
  `setTimeout(go,${LOAD_FALLBACK_MS});` +
  `var P=window.PerformanceObserver,t=P&&P.supportedEntryTypes;` +
  `if(t&&t.indexOf("paint")>=0)new P(function(l,o){if(l.getEntriesByName("first-contentful-paint").length){o.disconnect();setTimeout(go,0)}}).observe({type:"paint",buffered:true});` +
  `else requestAnimationFrame(function(){setTimeout(go,0)})})()`;

const attrsOf = (raw) =>
  Object.fromEntries([...raw.matchAll(ATTR)].map((m) => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '']));

/** The [src, id] list inside a loader's source, or null when it is not one this script wrote. */
export function manifestOf(body) {
  const m = MANIFEST.exec(body.trim());
  if (!m) return null;
  try {
    const list = JSON.parse(m[1]);
    const ok =
      Array.isArray(list) &&
      list.every(
        (e) =>
          Array.isArray(e) &&
          e.length === 2 &&
          typeof e[0] === 'string' &&
          (e[1] === null || typeof e[1] === 'string'),
      );
    return ok ? list : null;
  } catch {
    return null;
  }
}

/** Every runtime URL a page's loader(s) will add, for check-out.mjs. */
export function loaderUrls(html) {
  const urls = [];
  for (const m of html.matchAll(SCRIPT)) {
    if (!(LOADER_ATTR in attrsOf(m[1]))) continue;
    for (const [src] of manifestOf(m[2]) ?? []) urls.push(src);
  }
  return urls;
}

/**
 * Rewrites one page. `exists(urlPath)` says whether a chunk is in the export.
 * Returns { html, moved, problems }: html is unchanged whenever problems is non-empty.
 */
export function rewrite(html, exists) {
  const problems = [];
  const moved = [];
  let loaders = 0;
  const check = (src, what) => {
    if (!CHUNK.test(src)) problems.push(`${what} ${src}: not a plain runtime chunk path`);
    else if (!exists(src)) problems.push(`${what} ${src}: missing from the export`);
  };
  const next = html.replace(SCRIPT, (tag, raw, body) => {
    const a = attrsOf(raw);
    if (LOADER_ATTR in a) {
      loaders++;
      const list = manifestOf(body);
      if (!list) problems.push('loader script with an unreadable manifest');
      else for (const [src] of list) check(src, 'loader chunk');
      return tag;
    }
    if (!('src' in a)) return tag; // inline (theme boot, RSC payload): stays in place
    const src = a.src;
    if (!src.startsWith('/_next/')) return tag; // not the runtime
    if ('nomodule' in a && POLYFILL.test(src) && body.length === 0) return tag;
    const extra = Object.keys(a).filter((k) => !['src', 'async', 'id'].includes(k));
    const why = [
      !CHUNK.test(src) && 'not a plain chunk path',
      !('async' in a) && 'not async',
      extra.length && `attributes ${extra.join(', ')}`,
      body.length && 'has a body',
    ].filter(Boolean);
    if (why.length) {
      problems.push(`runtime script ${src}: cannot defer (${why.join('; ')})`);
      return tag;
    }
    check(src, 'chunk');
    moved.push([src, a.id || null]);
    return '';
  });
  if (loaders > 1) problems.push(`${loaders} loader scripts`);
  if (loaders && moved.length) problems.push('a loader is present but runtime chunks are still eager');
  if (problems.length || !moved.length) return { html, moved, problems };
  if (next.split('</body>').length !== 2) return { html, moved, problems: ['expected exactly one </body>'] };
  const script = `<script ${LOADER_ATTR}="">${loader(JSON.stringify(moved))}</script>`;
  return { html: next.replace('</body>', `${script}</body>`), moved, problems };
}

async function pages(dir) {
  const acc = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) acc.push(...(await pages(p)));
    else if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

async function main() {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out');
  const exists = (u) => {
    const abs = path.join(out, u);
    return abs.startsWith(out + path.sep) && existsSync(abs);
  };
  const problems = [];
  const writes = [];
  let deferred = 0;
  for (const file of await pages(out)) {
    const html = await readFile(file, 'utf8');
    const r = rewrite(html, exists);
    const rel = path.relative(out, file);
    problems.push(...r.problems.map((p) => `${rel}: ${p}`));
    if (r.html !== html) writes.push([file, r.html]);
    if (r.moved.length || html.includes(LOADER_ATTR)) deferred++;
  }
  if (problems.length) {
    console.error(`[defer-hydration] ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  // write only once every page passed, so a failed run leaves no half-rewritten export
  for (const [file, html] of writes) await writeFile(file, html);
  console.log(`[defer-hydration] ok: ${deferred} pages start the runtime after first contentful paint`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
