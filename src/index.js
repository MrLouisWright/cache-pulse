// cache-pulse: check that static hosting config gives effective caching: long max-age + immutable on hashed
// files, revalidation on HTML, no long cache on unhashed files, and precompressed assets that match.
// Performance only: security headers are out of scope. Zero dependencies. Louis Wright, MIT.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { runBeacon, finder, globToRe } from './site.js';
import { buildReport, UsageError } from './core.js';

export * from './core.js';
export { loadSite, parseHtml, SITE_OPTIONS, SITE_HELP } from './site.js';

export const RULES = {
  'cache-hashed-short': { severity: 'high', title: 'Fingerprinted asset is not cached long (max-age under 1 year, no-cache or no-store)' },
  'cache-unhashed-immutable': { severity: 'high', title: 'Unfingerprinted file is cached for a long time or immutable (users keep stale versions)' },
  'cache-html-long': { severity: 'high', title: 'HTML is cached without revalidation (deploys will not show up)' },
  'cache-precompressed-stale': { severity: 'high', title: 'Precompressed .gz/.br file does not match the original' },
  'cache-hashed-missing': { severity: 'medium', title: 'Fingerprinted asset has no Cache-Control at all' },
  'cache-no-store-static': { severity: 'medium', title: 'no-store on a static asset disables all caching' },
  'cache-vary-star': { severity: 'medium', title: 'Vary: * makes responses uncacheable' },
  'cache-set-cookie-static': { severity: 'medium', title: 'Set-Cookie on static assets prevents shared caching' },
  'cache-precompressed-missing': { severity: 'medium', title: 'Text asset lacks a precompressed .br/.gz sibling while others have one' },
  'cache-encoding-on-binary': { severity: 'medium', title: 'Content-Encoding set on already-compressed files (images, fonts, archives)' },
  'cache-hashed-not-immutable': { severity: 'low', title: 'Fingerprinted asset with long max-age but no immutable' },
  'cache-static-no-policy': { severity: 'low', title: 'Unfingerprinted static asset has no Cache-Control (heuristic caching)' },
  'cache-html-no-policy': { severity: 'info', title: 'HTML has no explicit Cache-Control' },
  'cache-config-missing': { severity: 'info', title: 'No hosting header config found (_headers, vercel.json, netlify.toml, firebase.json, serve.json)' },
};
const YEAR = 31536000; const DAY = 86400; const WEEK = 7 * DAY;
const STATIC = /\.(m?js|cjs|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wasm|map|json|xml|txt|pdf)$/i;
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|mp4|webm|mp3|zip|gz|br|pdf)$/i;
const TEXT = /\.(m?js|cjs|css|html?|svg|json|xml|txt|wasm|map)$/i;
const HASHED_DIRS = /(^|\/)(_next\/static\/(?!development)|_astro\/|_app\/immutable\/|_nuxt\/|static\/(js|css|media)\/|assets\/[^/]*[.-][A-Za-z0-9_-]{8,}\.)/;
/** Content-hash heuristic: a name segment of 8+ chars with letters and digits (or hex), as bundlers emit. */
export function isHashed(path) {
  const name = path.split('/').pop();
  if (HASHED_DIRS.test(path)) return true;
  return /[.-]((?=[A-Za-z0-9_]*\d)(?=[A-Za-z0-9_]*[A-Za-z])[A-Za-z0-9_]{8,}|[a-f0-9]{8,})(\.chunk|\.min|\.bundle)?\.[a-z0-9]+$/i.test(name) && !/[.-](v?\d+\.\d+\.\d+)\./.test(name);
}
/** Parse a Cache-Control value. */
export function parseCacheControl(v) {
  const o = {}; for (const part of String(v || '').split(',')) { const [k, val] = part.trim().split('='); if (!k) continue; o[k.toLowerCase()] = val == null ? true : val.replace(/^"|"$/g, ''); }
  const n = (k) => (o[k] != null && o[k] !== true ? Number(o[k]) : null);
  return { raw: v, maxAge: n('max-age'), sMaxAge: n('s-maxage'), immutable: !!o.immutable, noCache: !!o['no-cache'], noStore: !!o['no-store'], mustRevalidate: !!o['must-revalidate'], private: !!o.private, swr: n('stale-while-revalidate') };
}

/** Extra header sources beyond site.js (_headers, vercel.json): netlify.toml, firebase.json, serve.json. */
export function loadExtraRules(dir) {
  const rules = [];
  const toRe = (p) => { try { return globToRe(p.replace(/^\*\*\//, '**/')); } catch { return /^$/; } };
  for (const f of ['netlify.toml', '../netlify.toml']) {
    const p = join(dir, f); if (!existsSync(p)) continue; const lines = readFileSync(p, 'utf8').split(/\r?\n/); let cur = null; let inValues = false;
    lines.forEach((l, i) => { const t = l.trim(); if (/^\[\[headers\]\]/.test(t)) { cur = { source: 'netlify.toml', line: i + 1, headers: [] }; rules.push(cur); inValues = false; return; } if (/^\[headers\.values\]/.test(t)) { inValues = true; return; } if (/^\[/.test(t)) { cur = null; return; } if (!cur) return; let m = /^for\s*=\s*["'](.+)["']/.exec(t); if (m) { cur.pattern = m[1]; cur.re = netlifyRe(m[1]); return; } m = /^["']?([\w-]+)["']?\s*=\s*["'](.*)["']\s*$/.exec(t); if (m && (inValues || /^[A-Z]/.test(m[1]))) cur.headers.push([m[1].toLowerCase(), m[2]]); });
    break;
  }
  for (const f of ['firebase.json', '../firebase.json']) {
    const p = join(dir, f); if (!existsSync(p)) continue; try { const j = JSON.parse(readFileSync(p, 'utf8')); for (const h of [].concat(j.hosting || []).flatMap((x) => x.headers || [])) rules.push({ source: 'firebase.json', pattern: h.source || h.glob || h.regex, re: h.regex ? new RegExp(h.regex) : toRe('/' + String(h.source || h.glob || '**').replace(/^\//, '')), headers: (h.headers || []).map((x) => [String(x.key).toLowerCase(), String(x.value)]) }); } catch { /* invalid */ } break;
  }
  for (const f of ['serve.json']) { const p = join(dir, f); if (!existsSync(p)) continue; try { const j = JSON.parse(readFileSync(p, 'utf8')); for (const h of j.headers || []) rules.push({ source: 'serve.json', pattern: h.source, re: toRe('/' + String(h.source).replace(/^\//, '')), headers: (h.headers || []).map((x) => [String(x.key).toLowerCase(), String(x.value)]) }); } catch { /* invalid */ } }
  return rules.filter((r) => r.re);
}
function netlifyRe(p) { let s = ''; for (let k = 0; k < p.length; k++) { const c = p[k]; if (c === '*') s += '.*'; else if (c === ':' && /\w/.test(p[k + 1] || '')) { const m = /^:\w+/.exec(p.slice(k)); k += m[0].length - 1; s += '[^/]+'; } else s += c.replace(/[.+^${}()|[\]\\?]/g, '\\$&'); } return new RegExp(`^${s}$`); }

function analyze(site, opts, config) {
  const { findings, add } = finder(RULES);
  const extra = loadExtraRules(site.dir); const configured = site.headerRules.length + extra.length > 0;
  const allRules = [...site.headerRules, ...extra].map((r, i) => ({ ...r, i, spec: String(r.pattern || '').replace(/\(\.\*\)|\*+|:\w+/g, '').length }));
  // Most specific matching rule wins per header (ties: later rule), like Vercel's last-match and how people read _headers.
  const headersFor = (path) => { const h = {}; const m = allRules.filter((r) => r.re.test(path) || r.re.test(path.replace(/\/$/, ''))).sort((a, b) => a.spec - b.spec || a.i - b.i); for (const r of m) for (const [k, v] of r.headers) (h[k] ||= []).push({ value: v, source: r.source, line: r.line }); return h; };
  const last = (h, k) => (h[k]?.length ? h[k][h[k].length - 1] : null);
  if (!configured && !opts.headers) { add('cache-config-missing', site.dir, 'No _headers, vercel.json, netlify.toml, firebase.json or serve.json found; caching depends on host defaults', 'Declare Cache-Control for /assets/* (long, immutable) and HTML (revalidate) in your hosting config.', {}); }
  const htmlMax = config.maxHtmlAge ?? 600; const unhashedMax = config.maxUnhashedAge ?? WEEK;
  const isHashedP = (p) => isHashed(p) || (config.hashedPaths || []).some((g) => globToRe(g).test(p));
  const report = new Map(); // rule|pattern dedupe: summarise per header rule
  const hit = (rule, key, subject, msg, fix, loc) => { const k = `${rule}|${key}`; const r = report.get(k); if (r) { r.n++; return; } report.set(k, { rule, subject, msg, fix, loc, n: 1 }); };
  const precompressed = site.files.filter((f) => /\.(br|gz)$/.test(f)); const usesPre = precompressed.length > 0 || opts.expectPrecompressed || config.expectPrecompressed;
  let hashed = 0; let checked = 0;
  for (const f of site.files) {
    if (/\.(br|gz)$/.test(f) || /^(_headers|_redirects|vercel\.json|netlify\.toml|firebase\.json|serve\.json)$/.test(f) || f.startsWith('.')) continue;
    const path = '/' + f; const isHtml = /\.html?$/i.test(f); if (!isHtml && !STATIC.test(f)) continue; checked++;
    const h = headersFor(isHtml ? site.pages.find((p) => p.file === f)?.path ?? path : path); const cc = last(h, 'cache-control'); const c = cc ? parseCacheControl(cc.value) : null;
    const loc = cc ? { file: cc.source, line: cc.line } : { file: f }; const key = cc ? `${cc.source}:${cc.line}` : f.replace(/[^/]+$/, '*' + (f.match(/\.[^.]+$/)?.[0] || ''));
    const age = c ? (c.noStore || c.noCache ? 0 : c.maxAge ?? c.sMaxAge ?? null) : null;
    for (const v of h.vary || []) if (/^\s*\*\s*$/.test(v.value)) hit('cache-vary-star', `${v.source}:${v.line}`, path, `Vary: * on ${path}`, 'Vary on specific headers (Accept-Encoding) only.', { file: v.source, line: v.line });
    if (!isHtml && h['set-cookie']?.length) { const v = last(h, 'set-cookie'); hit('cache-set-cookie-static', `${v.source}:${v.line}`, path, `Set-Cookie on static ${path}`, 'Do not set cookies on static assets; CDNs will not cache them.', { file: v.source, line: v.line }); }
    if (BINARY.test(f) && h['content-encoding']?.length) { const v = last(h, 'content-encoding'); hit('cache-encoding-on-binary', `${v.source}:${v.line}`, path, `Content-Encoding: ${v.value} on already-compressed ${path}`, 'Compress only text (HTML, CSS, JS, SVG, JSON); images, fonts and video are already compressed.', { file: v.source, line: v.line }); }
    if (isHtml) {
      if (!c) { if (configured) hit('cache-html-no-policy', 'html', path, `HTML such as ${path} has no Cache-Control`, 'Set Cache-Control: public, max-age=0, must-revalidate (or no-cache) for HTML, with ETag/Last-Modified.', loc); continue; }
      const browserAge = c.noCache || c.noStore ? 0 : c.maxAge ?? 0;
      if (c.immutable || browserAge > htmlMax) hit('cache-html-long', key, path, `HTML ${path} is cached ${c.immutable ? 'immutable' : `for ${browserAge}s`} (${cc.value})`, 'Use max-age=0, must-revalidate (or no-cache) for HTML; put long caching on fingerprinted assets only. Use s-maxage plus CDN purge for edge caching.', loc);
      continue;
    }
    if (isHashedP(path)) {
      hashed++;
      if (!c) hit('cache-hashed-missing', key, path, `Fingerprinted ${path} has no Cache-Control`, 'Set Cache-Control: public, max-age=31536000, immutable for hashed assets (e.g. /assets/*).', loc);
      else if (c.noStore) hit('cache-no-store-static', key, path, `no-store on fingerprinted ${path}`, 'Use public, max-age=31536000, immutable.', loc);
      else if ((age ?? 0) < YEAR * 0.99) hit('cache-hashed-short', key, path, `Fingerprinted ${path} is cached ${age ? `only ${age}s` : 'with revalidation'} (${cc.value})`, 'Set max-age=31536000, immutable: the URL changes whenever the content does.', { ...loc, severity: (age ?? 0) >= 30 * DAY ? 'medium' : undefined });
      else if (!c.immutable) hit('cache-hashed-not-immutable', key, path, `Fingerprinted ${path} has max-age but no immutable`, 'Add immutable so browsers skip revalidation on reload.', loc);
    } else {
      if (!c) { if (configured) hit('cache-static-no-policy', key, path, `Unfingerprinted ${path} has no Cache-Control`, 'Give it a short max-age with revalidation (e.g. max-age=3600, must-revalidate) or fingerprint it.', loc); }
      else if (c.noStore) hit('cache-no-store-static', key, path, `no-store on static ${path}`, 'Use no-cache (revalidate) instead of no-store for static files.', loc);
      else if (c.immutable || (age ?? 0) > unhashedMax) hit('cache-unhashed-immutable', key, path, `Unfingerprinted ${path} is cached ${c.immutable ? 'immutable' : `${age}s`} (${cc.value})`, 'Fingerprint the file name (content hash) or shorten max-age; otherwise a new deploy is not seen until the cache expires.', loc);
    }
  }
  // precompressed siblings
  if (usesPre) {
    for (const f of site.files) {
      if (!TEXT.test(f) || /\.(br|gz)$/.test(f)) continue; let size; try { size = statSync(join(site.dir, f)).size; } catch { continue; } if (size < (config.minCompressSize ?? 1400)) continue;
      const orig = readFileSync(join(site.dir, f)); const has = [];
      for (const [ext, dec] of [['.br', brotliDecompressSync], ['.gz', gunzipSync]]) { const p = join(site.dir, f + ext); if (!existsSync(p)) continue; has.push(ext); let ok = false; try { ok = dec(readFileSync(p)).equals(orig); } catch { ok = false; } if (!ok) add('cache-precompressed-stale', f + ext, `${f}${ext} does not decompress to the current ${f}`, 'Regenerate precompressed files as the last build step.', { file: f + ext }); }
      if (!has.length) hit('cache-precompressed-missing', f.replace(/[^/]+$/, '') + (f.match(/\.[^.]+$/)?.[0] || ''), f, `${f} (${Math.round(size / 1024)} KB) has no .br or .gz sibling`, 'Precompress all text assets (brotli 11 and gzip 9) or rely on the host to compress.', { file: f });
    }
  }
  for (const r of report.values()) add(r.rule, r.subject, r.n > 1 ? `${r.msg} (+${r.n - 1} more file(s) with the same rule)` : r.msg, r.fix, r.loc);
  return { findings, info: { files: checked, hashed, headerRules: site.headerRules.length + extra.length, precompressed: precompressed.length }, summary: `${checked} file(s) (${hashed} fingerprinted), ${site.headerRules.length + extra.length} header rule(s)` };
}

export function check(dir, opts = {}, config = {}, configFile) {
  const tool = { name: 'cache-pulse', version: opts.toolVersion || '1.0.0', rules: RULES, emoji: '🗃️', defaultFile: '_headers' };
  return runBeacon(tool, dir, { ...opts, UsageError }, config, configFile, analyze, buildReport);
}
