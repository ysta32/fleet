// Post-build: start the Next.js runtime after the first contentful paint, on every exported page.
//
// The static HTML already holds the whole page (the hero poster included), but `next build` emits the runtime
// chunks as <script async> in <head>: on a phone they download alongside the hero poster and run before the
// first frame, so the poster (the LCP element) waits on ~110 KB of JS and its hydration. Here each such tag is
// replaced by one inline loader at the end of <body> that adds the same scripts (async, same ids) once the
// first contentful paint has happened. The inline RSC payload (self.__next_f) stays where it is; the runtime
// reads it when it boots, as before. Browsers without paint timing load them on the next frame; a page that
// never paints (a background tab) still loads them after LOAD_FALLBACK_MS.
//
// Fails the build when a page has runtime chunks this script does not recognise (a Next.js upgrade changed the
// markup) or when a moved chunk is missing from out/.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out');
const LOAD_FALLBACK_MS = 3000;
const CHUNK = /^\/_next\/static\/chunks\/[\w./-]+\.js$/;
const TAG = /<script\b([^>]*)><\/script>/g;
const ATTR = /([\w-]+)(?:="([^"]*)")?/g;

/** The loader, as source: `list` is [src, id | null][] (JSON). */
const loader = (list) =>
  `(function(){var s=${list},d=0;function go(){if(d)return;d=1;for(var i=0;i<s.length;i++){var e=document.createElement("script");e.src=s[i][0];if(s[i][1])e.id=s[i][1];e.async=true;document.head.appendChild(e)}}` +
  `var P=window.PerformanceObserver,t=P&&P.supportedEntryTypes;` +
  `if(t&&t.indexOf("paint")>=0){new P(function(l,o){if(l.getEntriesByName("first-contentful-paint").length){o.disconnect();setTimeout(go,0)}}).observe({type:"paint",buffered:true});setTimeout(go,${LOAD_FALLBACK_MS})}` +
  `else requestAnimationFrame(function(){setTimeout(go,0)})})()`;

async function pages(dir) {
  const acc = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) acc.push(...(await pages(p)));
    else if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

const problems = [];
let rewritten = 0;
for (const file of await pages(out)) {
  const html = await readFile(file, 'utf8');
  const rel = path.relative(out, file);
  const moved = [];
  const next = html.replace(TAG, (tag, attrs) => {
    const a = Object.fromEntries([...attrs.matchAll(ATTR)].map((m) => [m[1].toLowerCase(), m[2] ?? '']));
    // only the runtime's own async chunks; inline scripts and the noModule polyfill stay as they are
    if (!a.src || !CHUNK.test(a.src) || !('async' in a) || 'nomodule' in a) return tag;
    const extra = Object.keys(a).filter((k) => !['src', 'async', 'id'].includes(k));
    if (extra.length) {
      problems.push(
        `${rel}: runtime chunk ${a.src} has attributes this loader does not carry: ${extra.join(', ')}`,
      );
      return tag;
    }
    if (!existsSync(path.join(out, a.src))) problems.push(`${rel}: missing chunk ${a.src}`);
    moved.push([a.src, a.id || null]);
    return '';
  });
  if (!moved.length) {
    if (/<script\b[^>]*src="\/_next\/static\/chunks\//.test(html) && !html.includes('defer-hydration'))
      problems.push(`${rel}: runtime chunks present but none recognised`);
    continue;
  }
  if (next.split('</body>').length !== 2) {
    problems.push(`${rel}: expected exactly one </body>`);
    continue;
  }
  const script = `<script data-defer-hydration="">${loader(JSON.stringify(moved))}</script>`;
  await writeFile(file, next.replace('</body>', `${script}</body>`));
  rewritten++;
}

if (problems.length) {
  console.error(`[defer-hydration] ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`[defer-hydration] ok: ${rewritten} pages start the runtime after first contentful paint`);
