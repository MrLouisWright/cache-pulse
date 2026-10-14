// Shared static-site reader for the *-beacon packages: a small, forgiving HTML parser,
// a build-output walker that maps files to URLs, and _headers / vercel.json header rules.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript', 'template']);
const HEADISH = new Set(['html', 'head', 'meta', 'link', 'title', 'base', 'script', 'style', 'noscript', 'template']);
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'td', 'th', 'tr', 'ul', 'option', 'caption']);
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»', middot: '·', bull: '•', times: '×', eacute: 'é', egrave: 'è', aacute: 'á', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß', ccedil: 'ç', ntilde: 'ñ', euro: '€', pound: '£', yen: '¥', deg: '°', shy: '' };
export const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);?/gi, (m, e) => { if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } } const v = ENT[e.toLowerCase()]; return v ?? m; });
export const squash = (s) => String(s).replace(/[\s\u00a0]+/g, ' ').trim();

function parseAttrs(src) {
  const attrs = {};
  for (const m of src.matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) { const k = m[1].toLowerCase(); if (!(k in attrs)) attrs[k] = decode(m[2] ?? m[3] ?? m[4] ?? ''); }
  return attrs;
}

/** Parse HTML into a light tree. Elements: { tag, attrs, line, children, parent, inHead }. Text nodes: { text }. */
export function parseHtml(html) {
  html = String(html).replace(/^\uFEFF/, '');
  const root = { tag: '#document', attrs: {}, children: [], line: 1, parent: null };
  const all = []; let cur = root; let bodyStarted = false; let i = 0; let line = 1;
  const lineAt = (to) => { for (let k = i; k < to; k++) if (html.charCodeAt(k) === 10) line++; i = to; };
  const inHeadEl = () => { for (let n = cur; n; n = n.parent) if (n.tag === 'head') return true; return false; };
  const close = (tag) => { for (let n = cur; n && n !== root; n = n.parent) if (n.tag === tag) { cur = n.parent; return true; } return false; };
  const open = (tag, attrs, ln, selfClose) => {
    if (tag === 'body') bodyStarted = true;
    else if (!HEADISH.has(tag) && !inHeadEl()) bodyStarted = true;
    if (cur.tag === 'head' && !HEADISH.has(tag)) cur = cur.parent; // implicit </head>
    if (CLOSES_P.has(tag)) { for (let n = cur; n && n !== root && !['div', 'section', 'article', 'main', 'body', 'td', 'li', 'blockquote'].includes(n.tag) || n === cur; n = n.parent) { if (n === root) break; if (n.tag === 'p') { cur = n.parent; break; } if (n !== cur) break; } }
    if (tag === 'li') { for (let n = cur; n && n !== root; n = n.parent) { if (n.tag === 'li') { cur = n.parent; break; } if (n.tag === 'ul' || n.tag === 'ol') break; } }
    if (tag === 'dt' || tag === 'dd') { for (let n = cur; n && n !== root; n = n.parent) { if (n.tag === 'dt' || n.tag === 'dd') { cur = n.parent; break; } if (n.tag === 'dl') break; } }
    if (tag === 'option' && cur.tag === 'option') cur = cur.parent;
    if ((tag === 'tr' || tag === 'td' || tag === 'th') && (cur.tag === 'td' || cur.tag === 'th')) cur = cur.parent;
    if (tag === 'tr' && cur.tag === 'tr') cur = cur.parent;
    const el = { tag, attrs, line: ln, children: [], parent: cur, inHead: !bodyStarted || inHeadEl() };
    cur.children.push(el); all.push(el);
    if (!VOID.has(tag) && !selfClose) cur = el;
    return el;
  };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { const t = html.slice(i); if (t.trim() && !inHeadEl()) bodyStarted = true; cur.children.push({ text: decode(t) }); lineAt(html.length); break; }
    if (lt > i) { const t = html.slice(i, lt); if (t.trim()) { if (!inHeadEl() && cur.tag !== 'html' || cur.tag === 'html' || cur === root) { if (!inHeadEl()) bodyStarted = true; } } cur.children.push({ text: decode(t) }); lineAt(lt); }
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); lineAt(e === -1 ? html.length : e + 3); continue; }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { const e = html.indexOf('>', lt); lineAt(e === -1 ? html.length : e + 1); continue; }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.slice(lt, lt + 20000));
    if (!m) { cur.children.push({ text: '<' }); lineAt(lt + 1); continue; }
    const tag = m[2].toLowerCase(); const ln = line;
    lineAt(lt + m[0].length);
    if (m[1]) { if (tag === 'p' && !close('p')) { /* stray </p> */ } else if (tag !== 'p') close(tag); continue; }
    const el = open(tag, parseAttrs(m[3]), ln, /\/\s*$/.test(m[3]));
    if (RAW.has(tag) && !/\/\s*$/.test(m[3])) {
      const re = new RegExp(`</${tag}\\s*>`, 'i'); re.lastIndex = 0; const rest = html.slice(i); const em = re.exec(rest);
      const end = em ? i + em.index : html.length; const raw = html.slice(i, end);
      if (tag === 'noscript' || tag === 'template') { const inner = parseHtml(raw); for (const c of inner.root.children) { c.parent = el; el.children.push(c); } for (const c of inner.all) { c.line += ln - 1; c.inHead = el.inHead; all.push(c); } }
      else el.children.push({ text: tag === 'script' || tag === 'style' ? raw : decode(raw), raw: true });
      el.rawText = raw;
      lineAt(end); if (em) lineAt(end + em[0].length);
      cur = el.parent;
    }
  }
  return makeDoc(root, all);
}

/** Visible text of an element (skips script/style/template, adds spaces at block boundaries). opts.alt includes img alt text. */
export function textOf(node, opts = {}) {
  const out = [];
  const walk = (n) => {
    if (n.text != null) { if (!n.raw || (n.parent?.tag !== 'script' && n.parent?.tag !== 'style')) out.push(n.text); return; }
    if (n.tag === 'script' || n.tag === 'style' || n.tag === 'template' || (n.tag === 'noscript' && !opts.noscript)) return;
    if (opts.skip && opts.skip.has(n.tag)) return;
    if (n.attrs?.hidden != null || n.attrs?.['aria-hidden'] === 'true' && opts.skipHidden) return;
    if (n.tag === 'img' && opts.alt) out.push(` ${n.attrs.alt || ''} `);
    if (BLOCK.has(n.tag)) out.push(' ');
    for (const c of n.children || []) walk(c);
    if (BLOCK.has(n.tag)) out.push(' ');
  };
  if (node.text != null) return squash(node.text);
  for (const c of node.children || []) walk(c);
  return squash(out.join(''));
}
const has = (el, tag) => { for (let n = el.parent; n; n = n.parent) if (n.tag === tag) return true; return false; };
export const ancestor = (el, pred) => { for (let n = el.parent; n; n = n.parent) if (n.tag && pred(n)) return n; return null; };

function makeDoc(root, all) {
  const doc = { root, all };
  const by = (t) => all.filter((e) => e.tag === t);
  doc.find = (t) => by(t);
  const html = all.find((e) => e.tag === 'html');
  doc.lang = html?.attrs.lang ?? null;
  doc.titles = by('title').filter((e) => !has(e, 'svg')).map((e) => ({ text: squash(decode(e.rawText ?? textOf(e))), line: e.line, inHead: e.inHead, el: e }));
  doc.title = doc.titles.find((t) => t.inHead)?.text ?? doc.titles[0]?.text ?? null;
  doc.metas = by('meta').map((e) => ({ name: (e.attrs.name || '').toLowerCase() || null, property: (e.attrs.property || '').toLowerCase() || null, httpEquiv: (e.attrs['http-equiv'] || '').toLowerCase() || null, content: e.attrs.content ?? null, charset: e.attrs.charset ?? null, itemprop: e.attrs.itemprop ?? null, line: e.line, inHead: e.inHead, el: e }));
  doc.meta = (key) => { key = key.toLowerCase(); return doc.metas.filter((m) => m.name === key || m.property === key); };
  doc.metaContent = (key) => { const m = doc.meta(key).find((x) => x.inHead) || doc.meta(key)[0]; return m ? (m.content ?? '') : null; };
  doc.links = by('link').map((e) => ({ rel: (e.attrs.rel || '').toLowerCase().split(/\s+/).filter(Boolean), href: e.attrs.href ?? null, hreflang: e.attrs.hreflang ?? null, type: e.attrs.type ?? null, line: e.line, inHead: e.inHead, el: e }));
  doc.base = by('base').find((e) => e.attrs.href)?.attrs.href ?? null;
  doc.anchors = by('a').filter((e) => e.attrs.href != null).map((e) => ({ href: e.attrs.href, rel: (e.attrs.rel || '').toLowerCase().split(/\s+/).filter(Boolean), text: textOf(e, { alt: true }), line: e.line, el: e }));
  doc.headings = [];
  for (const e of all) {
    let level = /^h([1-6])$/.exec(e.tag)?.[1];
    if (!level && e.attrs.role === 'heading') level = e.attrs['aria-level'] || '2';
    if (level && !has(e, 'svg') && !has(e, 'template')) doc.headings.push({ level: +level, text: textOf(e, { alt: true }), line: e.line, el: e, hidden: e.attrs.hidden != null || !!ancestor(e, (n) => n.attrs?.hidden != null) });
  }
  doc.jsonld = by('script').filter((e) => /^application\/ld\+json$/i.test((e.attrs.type || '').trim())).map((e) => { const raw = e.rawText ?? ''; try { return { raw, line: e.line, data: JSON.parse(raw.trim().replace(/^<!--|-->$/g, '')) }; } catch (err) { return { raw, line: e.line, error: err.message }; } });
  const body = by('body')[0] || root;
  let _text; let _main;
  Object.defineProperty(doc, 'text', { get: () => (_text ??= textOf(body)) });
  Object.defineProperty(doc, 'mainText', { get: () => {
    if (_main != null) return _main;
    const mains = all.filter((e) => e.tag === 'main' || e.attrs.role === 'main');
    const arts = mains.length ? mains : all.filter((e) => e.tag === 'article' && !has(e, 'article'));
    _main = arts.length ? squash(arts.map((e) => textOf(e, { skip: new Set(['nav', 'aside']) })).join(' ')) : textOf(body, { skip: new Set(['nav', 'header', 'footer', 'aside']) });
    return _main;
  } });
  doc.words = (s) => (s ?? doc.mainText).split(/[^\p{L}\p{N}'’-]+/u).filter((w) => /[\p{L}\p{N}]/u.test(w));
  doc.robots = (bots = ['robots']) => doc.metas.filter((m) => m.name && bots.includes(m.name)).map((m) => ({ ...m, directives: String(m.content || '').toLowerCase().split(',').map((d) => d.trim()).filter(Boolean) }));
  return doc;
}

// ---------------------------------------------------------------------------------------------- site
export function globToRe(g) {
  let s = ''; g = String(g);
  for (let k = 0; k < g.length; k++) {
    const c = g[k];
    if (c === '*') { if (g[k + 1] === '*') { s += '.*'; k++; if (g[k + 1] === '/') k++; } else s += '[^/]*'; }
    else if (c === '?') s += '[^/]';
    else s += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${s}$`);
}
export const matchAny = (globs, s) => (globs || []).some((g) => globToRe(g).test(s));

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg']);
function walk(dir, base = dir, out = []) {
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

/** URL path for a built file: index.html -> "/", a/index.html -> "/a/", a.html -> "/a.html" (or "/a" with cleanUrls). */
export function pathForFile(file, { cleanUrls = false } = {}) {
  if (/(^|\/)index\.html?$/i.test(file)) return '/' + file.replace(/index\.html?$/i, '');
  return '/' + (cleanUrls ? file.replace(/\.html?$/i, '') : file);
}
export function normPath(p) {
  let s = String(p || '/').split('#')[0].split('?')[0];
  try { s = decodeURI(s); } catch { /* keep */ }
  if (!s.startsWith('/')) s = '/' + s;
  return s.replace(/\/{2,}/g, '/');
}

/**
 * Load a built static site. opts: { baseUrl, include, exclude, cleanUrls }.
 * Returns { dir, files, pages, baseUrl, origin, find(urlOrPath), resolve(page, href), isInternal(url), headersFor(path), read(rel) }.
 */
export function loadSite(dir, opts = {}) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw Object.assign(new Error(`No such directory: ${dir}`), { code: 'ENOENT' });
  const files = walk(dir).sort();
  const htmlFiles = files.filter((f) => /\.html?$/i.test(f) && !matchAny(opts.exclude, f) && !matchAny(opts.exclude, pathForFile(f, opts)) && (!opts.include?.length || matchAny(opts.include, f) || matchAny(opts.include, pathForFile(f, opts))));
  const cache = new Map();
  const pages = htmlFiles.map((file) => {
    const page = { file, path: pathForFile(file, opts) };
    Object.defineProperty(page, 'html', { get: () => readFileSync(join(dir, file), 'utf8') });
    Object.defineProperty(page, 'doc', { get: () => { if (!cache.has(file)) cache.set(file, parseHtml(readFileSync(join(dir, file), 'utf8'))); return cache.get(file); }, enumerable: false });
    return page;
  });
  const index = new Map();
  const keyVariants = (path) => { const p = normPath(path).toLowerCase(); const out = [p]; if (p.endsWith('/')) { out.push(p + 'index.html', p + 'index.htm'); if (p !== '/') out.push(p.slice(0, -1)); } else if (/\.html?$/.test(p)) { out.push(p.replace(/\.html?$/, '')); if (/\/index\.html?$/.test(p)) out.push(p.replace(/index\.html?$/, '')); } else out.push(p + '/', p + '.html'); return out; };
  for (const pg of pages) for (const k of keyVariants('/' + pg.file).concat(keyVariants(pg.path))) if (!index.has(k)) index.set(k, pg);

  let baseUrl = opts.baseUrl ? String(opts.baseUrl).replace(/\/+$/, '') : null;
  if (!baseUrl) {
    const counts = new Map();
    for (const pg of pages.slice(0, 60)) { const d = pg.doc; for (const v of [d.links.find((l) => l.rel.includes('canonical'))?.href, d.metaContent('og:url')]) { try { const u = new URL(v); if (/^https?:$/.test(u.protocol)) counts.set(u.origin, (counts.get(u.origin) || 0) + 1); } catch { /* relative */ } } }
    baseUrl = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  let origin = null; let basePath = '';
  if (baseUrl) { try { const u = new URL(baseUrl); origin = u.origin; basePath = u.pathname.replace(/\/+$/, ''); } catch { throw Object.assign(new Error(`Invalid base URL: ${baseUrl}`), { code: 'EINVAL', usage: true }); } }
  const site = { dir, files, pages, baseUrl, origin, basePath, inferredBase: !opts.baseUrl && !!baseUrl };
  site.urlOf = (pg) => (origin ? origin + basePath + pg.path : pg.path);
  /** Absolute URL object for href as seen from page (honours <base href>). */
  site.resolve = (pg, href) => {
    if (href == null) return null; href = String(href).trim();
    if (!href || /^(javascript|mailto|tel|data|sms|ftp|blob):/i.test(href)) return null;
    const pageUrl = (origin || 'http://site.invalid') + basePath + pg.path;
    try { const b = pg.doc?.base ? new URL(pg.doc.base, pageUrl).href : pageUrl; return new URL(href, b); } catch { return null; }
  };
  site.isInternal = (u) => { if (!u) return false; const o = origin || 'http://site.invalid'; if (u.origin === o) return true; if (origin) { try { const a = new URL(o); return u.hostname.replace(/^www\./, '') === a.hostname.replace(/^www\./, '') && false; } catch { return false; } } return false; };
  /** Find the page for a URL / path / URL object. Returns undefined for external or unknown. */
  site.find = (x) => {
    let path;
    if (x instanceof URL) { if (!(x.origin === (origin || 'http://site.invalid'))) return undefined; path = x.pathname; }
    else { const s = String(x); if (/^[a-z][a-z0-9+.-]*:/i.test(s)) { try { const u = new URL(s); if (u.origin !== (origin || 'http://site.invalid')) return undefined; path = u.pathname; } catch { return undefined; } } else path = s; }
    if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length) || '/';
    for (const k of keyVariants(path)) { const pg = index.get(k); if (pg) return pg; }
    return undefined;
  };
  site.read = (rel) => { try { return readFileSync(join(dir, rel), 'utf8'); } catch { return null; } };
  site.exists = (rel) => existsSync(join(dir, rel));
  const rules = loadHeaderRules(dir);
  site.headerRules = rules;
  site.headersFor = (path) => { const out = {}; for (const r of rules) if (r.re.test(path) || r.re.test(path.replace(/\/$/, '')) ) for (const [k, v] of r.headers) (out[k] ||= []).push({ value: v, source: r.source, line: r.line }); return out; };
  return site;
}

/** Header rules from Netlify / Cloudflare Pages `_headers` and `vercel.json`. */
export function loadHeaderRules(dir) {
  const rules = [];
  const hf = join(dir, '_headers');
  if (existsSync(hf)) {
    let cur = null;
    readFileSync(hf, 'utf8').split(/\r?\n/).forEach((l, i) => {
      if (!l.trim() || l.trim().startsWith('#')) return;
      if (!/^\s/.test(l)) { const pat = l.trim(); cur = { source: '_headers', line: i + 1, pattern: pat, re: pathPatternRe(pat), headers: [] }; rules.push(cur); }
      else if (cur) { const m = /^\s+([^:]+):\s*(.*)$/.exec(l); if (m) cur.headers.push([m[1].trim().toLowerCase(), m[2].trim()]); }
    });
  }
  for (const f of ['vercel.json', '../vercel.json']) {
    const vf = join(dir, f); if (!existsSync(vf)) continue;
    try { const j = JSON.parse(readFileSync(vf, 'utf8')); const text = readFileSync(vf, 'utf8').split('\n'); for (const h of j.headers || []) { const ln = text.findIndex((l) => l.includes(JSON.stringify(h.source))) + 1 || undefined; rules.push({ source: f.replace('../', ''), line: ln, pattern: h.source, re: pathPatternRe(h.source), headers: (h.headers || []).map((x) => [String(x.key).toLowerCase(), String(x.value)]) }); } } catch { /* ignore */ }
    break;
  }
  return rules;
}
function pathPatternRe(p) {
  try { if (/^https?:\/\//.test(p)) p = new URL(p).pathname; } catch { /* keep */ }
  if (/\(.*\)/.test(p) && !/:\w/.test(p.replace(/\(.*\)/g, ''))) { try { return new RegExp('^' + p.replace(/\//g, '\\/') + '$'); } catch { /* fall through */ } }
  let s = '';
  for (let k = 0; k < p.length; k++) {
    const c = p[k];
    if (c === '*') s += '.*';
    else if (c === ':' && /\w/.test(p[k + 1] || '')) { const m = /^:(\w+)(\*|\+|\?)?(\([^)]*\))?/.exec(p.slice(k)); k += m[0].length - 1; s += m[2] === '*' || m[2] === '+' ? '.*' : m[3] ? m[3] : '[^/]+'; }
    else s += c.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
  }
  return new RegExp(`^${s}$`);
}

/** Robots directives that apply to a page from meta tags and X-Robots-Tag headers. bots: lowercased names. */
export function robotsDirectives(site, pg, bots = ['robots', 'googlebot']) {
  const out = [];
  for (const m of pg.doc.robots(bots)) out.push({ bot: m.name, directives: m.directives, source: 'meta', file: pg.file, line: m.line, inHead: m.inHead, raw: m.content });
  for (const h of site.headersFor(pg.path)['x-robots-tag'] || []) {
    const v = h.value; const mm = /^([a-z0-9_-]+)\s*:\s*(.*)$/i.exec(v);
    const bot = mm && !/^(noindex|nofollow|none|all|index|follow|noarchive|nosnippet|unavailable_after|max-snippet|max-image-preview|max-video-preview|noimageindex|notranslate|indexifembedded)$/i.test(mm[1]) ? mm[1].toLowerCase() : 'robots';
    const body = bot === 'robots' ? v : mm[2];
    if (bot === 'robots' || bots.includes(bot)) out.push({ bot, directives: body.toLowerCase().split(',').map((d) => d.trim()).filter(Boolean), source: 'header', file: h.source, line: h.line, raw: v });
  }
  return out;
}
export const isNoindex = (dirs) => dirs.some((d) => d.directives.some((x) => x === 'noindex' || x === 'none'));

/** Page-level helpers shared across beacons. */
export function canonicalOf(site, pg) {
  const c = pg.doc.links.filter((l) => l.rel.includes('canonical') && l.href != null);
  const hdr = (site.headersFor(pg.path).link || []).map((h) => /<([^>]+)>\s*;\s*rel="?canonical"?/i.exec(h.value)?.[1]).filter(Boolean);
  const href = c.find((l) => l.inHead)?.href ?? c[0]?.href ?? hdr[0] ?? null;
  return { href, url: href != null ? site.resolve(pg, href) : null, tags: c, header: hdr };
}

/** Very small JSON-LD helpers. */
export function jsonldNodes(doc) {
  const out = [];
  const visit = (n, block, depth = 0) => {
    if (Array.isArray(n)) { n.forEach((x) => visit(x, block, depth)); return; }
    if (!n || typeof n !== 'object') return;
    if (n['@graph']) visit(n['@graph'], block, depth);
    if (n['@type']) out.push({ node: n, types: [].concat(n['@type']).map(String), line: block.line, depth });
    for (const [k, v] of Object.entries(n)) if (k !== '@graph' && k !== '@context' && v && typeof v === 'object') visit(v, block, depth + 1);
  };
  for (const b of doc.jsonld) if (b.data) visit(b.data, b);
  return out;
}
export const typeName = (t) => String(t).replace(/^https?:\/\/schema\.org\//, '').replace(/^schema:/, '');

// ---------------------------------------------------------------------------------------------- CLI glue
export const SITE_OPTIONS = { 'base-url': { type: 'string' }, include: { type: 'string', multiple: true }, exclude: { type: 'string', multiple: true }, 'clean-urls': { type: 'boolean' } };
export const SITE_HELP = `Site
      --base-url <url>        Public URL of the site, e.g. https://example.com (default: inferred from canonical/og:url)
      --include <globs>       Only check these pages (file or URL path globs, comma-separated)
      --exclude <globs>       Skip these pages
      --clean-urls            Pages are served without .html (about.html -> /about)
`;
const list = (v) => (v || []).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean);
export function siteOptions(o = {}, config = {}) {
  return { baseUrl: o['base-url'] ?? config.baseUrl, include: [...list(config.include), ...list(o.include)], exclude: [...list(config.exclude), ...list(o.exclude)], cleanUrls: o['clean-urls'] ?? config.cleanUrls ?? false };
}
/** Run a beacon: loads the site, calls analyze(site, opts) -> { findings, info, summary }, returns a report via buildReport. */
export function runBeacon(tool, dir, opts, config, configFile, analyze, buildReport) {
  let site;
  try { site = loadSite(dir, siteOptions(opts.cli || {}, { ...config, ...pick(opts, ['baseUrl', 'include', 'exclude', 'cleanUrls']) })); }
  catch (e) { if (e.usage || e.code === 'ENOENT') { const U = opts.UsageError || Error; throw new U(e.message); } throw e; }
  const { findings, info = {}, summary } = analyze(site, opts, config);
  const line = summary ?? `${site.pages.length} page(s)${site.baseUrl ? ` at ${site.baseUrl}${site.inferredBase ? ' (inferred)' : ''}` : ' (no base URL; pass --base-url)'}`;
  return buildReport(tool, site.baseUrl || dir, findings, config, { now: opts.now, configFile, summaryLine: line, info: { pages: site.pages.length, baseUrl: site.baseUrl, ...info } });
}
function pick(o, keys) { const r = {}; for (const k of keys) if (o[k] !== undefined && !(Array.isArray(o[k]) && !o[k].length)) r[k] = o[k]; return r; }
/** Finding factory bound to a rule table. */
export function finder(RULES, findings = []) {
  const add = (rule, subject, message, fix, loc = {}) => { if (!RULES[rule]) throw new Error(`unknown rule ${rule}`); findings.push({ rule, severity: loc.severity || RULES[rule].severity, subject, file: loc.file, line: loc.line, message, fix }); };
  return { findings, add };
}
/** Redirect stubs (meta refresh) and error pages are skipped by most checks. */
export const isRedirectStub = (pg) => pg.doc.metas.some((m) => m.httpEquiv === 'refresh');
export const isErrorPage = (pg) => /(^|\/)(404|500|50x|error)(\/index)?\.html?$/i.test(pg.file);
export const contentPages = (site) => site.pages.filter((p) => !isRedirectStub(p) && !isErrorPage(p));
/** Published / modified dates a page declares (JSON-LD, Open Graph article tags, <time itemprop>, meta). Values are Date or null. */
export function pageDates(doc) {
  const pick = (vals) => { for (const v of vals) { if (!v) continue; const d = new Date(String(v).trim()); if (!Number.isNaN(d.getTime())) return d; } return null; };
  const ld = jsonldNodes(doc).map((n) => n.node);
  const ldv = (k) => ld.map((n) => [].concat(n[k] ?? [])[0]).filter(Boolean);
  const timeProp = (k) => doc.all.filter((e) => e.attrs.itemprop === k).map((e) => e.attrs.datetime || e.attrs.content);
  return {
    published: pick([...ldv('datePublished'), doc.metaContent('article:published_time'), ...timeProp('datePublished'), doc.metaContent('date'), doc.metaContent('dc.date'), doc.metaContent('pubdate')]),
    modified: pick([...ldv('dateModified'), doc.metaContent('article:modified_time'), doc.metaContent('og:updated_time'), ...timeProp('dateModified'), doc.metaContent('last-modified')]),
  };
}
