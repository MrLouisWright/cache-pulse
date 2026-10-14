import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHtml, textOf, loadSite, pathForFile, globToRe, robotsDirectives, isNoindex, canonicalOf } from '../src/site.js';

test('site: parser extracts head, headings, text and JSON-LD', () => {
  const d = parseHtml('<html lang="en"><head><title>A &amp; B</title><meta name="description" content="d"></head><body><nav>Menu</nav><main><h1>Hi <img alt="x"></h1><p>One<p>Two<ul><li>a<li>b</ul></main><script type="application/ld+json">{"@type":"Thing"}</script><meta name="robots" content="noindex"></body></html>');
  assert.equal(d.title, 'A & B'); assert.equal(d.lang, 'en'); assert.equal(d.metaContent('description'), 'd');
  assert.deepEqual(d.headings.map((h) => h.text), ['Hi x']); assert.equal(d.mainText, 'Hi One Two a b');
  assert.deepEqual(d.all.filter((e) => e.tag === 'p').map((e) => textOf(e)), ['One', 'Two']);
  assert.equal(d.jsonld[0].data['@type'], 'Thing'); assert.equal(d.meta('robots')[0].inHead, false);
});
test('site: file to URL mapping, lookup variants and _headers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-'));
  const w = (p, c) => { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c); };
  w('index.html', '<link rel="canonical" href="https://ex.com/">'); w('about/index.html', '<title>About</title>'); w('blog/post.html', '<meta name="robots" content="index">');
  w('_headers', '/blog/*\n  X-Robots-Tag: noindex\n');
  assert.equal(pathForFile('a/index.html'), '/a/'); assert.equal(pathForFile('a.html', { cleanUrls: true }), '/a');
  const s = loadSite(dir);
  assert.equal(s.baseUrl, 'https://ex.com'); assert.equal(s.find('/about')?.file, 'about/index.html'); assert.equal(s.find('https://ex.com/blog/post')?.file, 'blog/post.html');
  assert.equal(s.find('https://other.com/about'), undefined);
  const post = s.find('/blog/post.html'); assert.ok(isNoindex(robotsDirectives(s, post)));
  assert.equal(canonicalOf(s, s.find('/')).url.href, 'https://ex.com/');
  assert.ok(globToRe('blog/**').test('blog/a/b.html')); assert.ok(!globToRe('blog/*').test('blog/a/b.html'));
});
