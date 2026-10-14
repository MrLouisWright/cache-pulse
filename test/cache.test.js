import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { check, isHashed, parseCacheControl, runCli, RULES } from '../src/index.js';

const ids = (r) => [...new Set(r.findings.map((f) => f.rule))].sort();
const io = () => { const o = { s: '', e: '' }; return { o, io: { stdout: { write: (x) => { o.s += x; } }, stderr: { write: (x) => { o.e += x; } } } }; };
const site = (files) => { const d = mkdtempSync(join(tmpdir(), 'cp-')); for (const [k, v] of Object.entries({ 'index.html': '<!doctype html><title>t</title><p>x</p>', ...files })) { mkdirSync(dirname(join(d, k)), { recursive: true }); writeFileSync(join(d, k), v); } return d; };

test('isHashed', () => {
  for (const p of ['/assets/index-BdT9x2Qa.js', '/main.3f2a9c1b.js', '/static/js/main.8e4f1c2a.chunk.js', '/_next/static/chunks/app.js', '/_astro/x.css', '/_app/immutable/a.js', '/a.0123456789abcdef.css']) assert.ok(isHashed(p), p);
  for (const p of ['/app.js', '/logo.svg', '/styles.css', '/jquery-3.7.1.min.js', '/assets/logo.png', '/favicon.ico']) assert.ok(!isHashed(p), p);
});
test('parseCacheControl', () => {
  assert.deepEqual(parseCacheControl('public, max-age=31536000, immutable'), { raw: 'public, max-age=31536000, immutable', maxAge: 31536000, sMaxAge: null, immutable: true, noCache: false, noStore: false, mustRevalidate: false, private: false, swr: null });
  const c = parseCacheControl('no-cache, s-maxage=60, stale-while-revalidate=30'); assert.ok(c.noCache); assert.equal(c.sMaxAge, 60); assert.equal(c.swr, 30);
});
test('good fixture is clean (even at info)', () => assert.deepEqual(ids(check('test/fixtures/good')), []));
test('bad fixture', () => assert.deepEqual(ids(check('test/fixtures/bad')), ['cache-encoding-on-binary', 'cache-hashed-short', 'cache-html-long', 'cache-no-store-static', 'cache-precompressed-missing', 'cache-precompressed-stale', 'cache-set-cookie-static', 'cache-unhashed-immutable', 'cache-vary-star']));
test('no config is an info note', () => assert.deepEqual(ids(check(site({ 'a.js': 'x' }))), ['cache-config-missing']));
test('hashed asset without policy, without immutable, and 30-day medium', () => {
  assert.deepEqual(ids(check(site({ 'assets/a-BdT9x2Qa.js': 'x', _headers: '/\n  Cache-Control: no-cache\n' }))), ['cache-hashed-missing']);
  assert.deepEqual(ids(check(site({ 'assets/a-BdT9x2Qa.js': 'x', _headers: '/assets/*\n  Cache-Control: max-age=31536000\n/\n  Cache-Control: no-cache\n' }))), ['cache-hashed-not-immutable']);
  const f = check(site({ 'assets/a-BdT9x2Qa.js': 'x', _headers: '/assets/*\n  Cache-Control: max-age=2592000\n/\n  Cache-Control: no-cache\n' })).findings[0]; assert.equal(f.rule, 'cache-hashed-short'); assert.equal(f.severity, 'medium');
});
test('netlify.toml headers', () => {
  const toml = '[[headers]]\n  for = "/assets/*"\n  [headers.values]\n    Cache-Control = "public, max-age=31536000, immutable"\n\n[[headers]]\n  for = "/*"\n  [headers.values]\n    Cache-Control = "public, max-age=0, must-revalidate"\n';
  assert.deepEqual(ids(check(site({ 'assets/a-BdT9x2Qa.js': 'x', 'netlify.toml': toml }))), []);
});
test('firebase.json headers and unhashed static without policy', () => {
  const fb = JSON.stringify({ hosting: { headers: [{ source: '**/*.@(js|css)', headers: [{ key: 'Cache-Control', value: 'max-age=31536000' }] }, { source: '**/*.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }] } });
  const r = check(site({ 'app.js': 'x', 'logo.png': 'x', 'firebase.json': fb }));
  assert.ok(ids(r).includes('cache-static-no-policy'));
});
test('s-maxage on HTML with max-age=0 is fine', () => assert.deepEqual(ids(check(site({ _headers: '/*\n  Cache-Control: public, max-age=0, s-maxage=600, must-revalidate\n' }))), []));
test('expect-precompressed', () => assert.deepEqual(ids(check(site({ 'a.css': 'b{}'.repeat(1000), _headers: '/*\n  Cache-Control: no-cache\n' }), { expectPrecompressed: true })), ['cache-precompressed-missing']));
test('CLI exit codes and SARIF', async () => {
  const cli = { name: 'cache-pulse', version: '1.0.0', configKey: 'cachePulse', rules: RULES, tagline: 't', usage: 'u', help: '', options: {}, run: async ({ dir, config }) => check(dir, {}, config) };
  let t = io(); assert.equal(await runCli(cli, ['test/fixtures/good', '--fail-on', 'info'], t.io), 0);
  t = io(); assert.equal(await runCli(cli, ['test/fixtures/bad', '-f', 'sarif'], t.io), 1); assert.equal(JSON.parse(t.o.s).version, '2.1.0');
  t = io(); assert.equal(await runCli(cli, ['test/fixtures/none'], t.io), 2);
});
