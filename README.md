# cache-pulse

[![npm version](https://img.shields.io/npm/v/cache-pulse.svg)](https://www.npmjs.com/package/cache-pulse) [![CI](https://github.com/MrLouisWright/cache-pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/MrLouisWright/cache-pulse/actions/workflows/ci.yml) [![Node](https://img.shields.io/node/v/cache-pulse.svg)](https://nodejs.org) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Check that your static hosting config caches the right things: fingerprinted assets for a year, HTML revalidated, and nothing stale after a deploy.

Caching is the cheapest performance win and the easiest to get backwards. Fingerprinted bundles (`index-BdT9x2Qa.js`) should be cached for a year with `immutable`; HTML and unfingerprinted files (`/styles.css`, `/logo.png`) must revalidate, or visitors keep yesterday's site. `cache-pulse` reads the header rules in your build output or repo (`_headers`, `vercel.json`, `netlify.toml`, `firebase.json`, `serve.json`), resolves the `Cache-Control` that applies to every file, and reports the mistakes, grouped by the header rule that causes them.

CLI, library and GitHub Action. Node.js 18+, **zero runtime dependencies**. Works on any static build output (Astro, Next.js `output: 'export'`, Eleventy, Hugo, Jekyll, Docusaurus, VitePress, plain HTML) and runs offline: point it at the folder your build writes. By Louis Wright.

## Features

- **Fingerprinted assets:** content-hashed file names and framework output folders (`_next/static`, `_astro`, `_app/immutable`, `_nuxt`, CRA `static/js`) need `max-age=31536000, immutable`; short, missing, `no-cache` and `no-store` policies are reported.
- **HTML:** cached without revalidation or `immutable` is high severity; `s-maxage` for the CDN with `max-age=0` for browsers is accepted.
- **Unfingerprinted files:** `immutable` or a max-age over a week on `/styles.css` or `/app.js` means users do not see deploys; missing policies are noted.
- **Pitfalls:** `Vary: *`, `Set-Cookie` on static files (no CDN caching), `Content-Encoding` on images and fonts.
- **Compression:** when the build ships `.br`/`.gz` files, every text asset over 1.4 kB should have one, and each is decompressed and compared with the original to catch stale copies.

### Scope

Performance caching and compression only. Security headers (CSP, HSTS, X-Frame-Options and friends) are deliberately out of scope; use a security-header checker for those. cache-pulse reads config files and does not request a live site.

## Rules

| Rule | Default severity | What it means |
|---|---|---|
| `cache-hashed-short` | high | Fingerprinted asset is not cached long (max-age under 1 year, no-cache or no-store) |
| `cache-unhashed-immutable` | high | Unfingerprinted file is cached for a long time or immutable (users keep stale versions) |
| `cache-html-long` | high | HTML is cached without revalidation (deploys will not show up) |
| `cache-precompressed-stale` | high | Precompressed .gz/.br file does not match the original |
| `cache-hashed-missing` | medium | Fingerprinted asset has no Cache-Control at all |
| `cache-no-store-static` | medium | no-store on a static asset disables all caching |
| `cache-vary-star` | medium | Vary: * makes responses uncacheable |
| `cache-set-cookie-static` | medium | Set-Cookie on static assets prevents shared caching |
| `cache-precompressed-missing` | medium | Text asset lacks a precompressed .br/.gz sibling while others have one |
| `cache-encoding-on-binary` | medium | Content-Encoding set on already-compressed files (images, fonts, archives) |
| `cache-hashed-not-immutable` | low | Fingerprinted asset with long max-age but no immutable |
| `cache-static-no-policy` | low | Unfingerprinted static asset has no Cache-Control (heuristic caching) |
| `cache-html-no-policy` | info | HTML has no explicit Cache-Control |
| `cache-config-missing` | info | No hosting header config found (_headers, vercel.json, netlify.toml, firebase.json, serve.json) |
| `allowlist-expired` | medium | An allowlist entry is past its `expires` date |
| `allowlist-unused` | info | An allowlist entry matched nothing |

## Install and run

```bash
npx cache-pulse dist
npx cache-pulse . --include '/assets/**'
npx cache-pulse public --expect-precompressed --fail-on medium
```

Pages are mapped to URLs the way static hosts serve them: `index.html` → `/`, `blog/index.html` → `/blog/`, `about.html` → `/about.html` (or `/about` with `--clean-urls`). Pass `--base-url` with your public URL, or let it be inferred from canonical / `og:url` tags. Meta-refresh redirect stubs and `404.html` are skipped. `X-Robots-Tag` and `Link` headers are read from Netlify/Cloudflare `_headers` and `vercel.json`.

### Sample output

```text
cache-pulse — /workspace/cache-pulse/test/fixtures/bad
5 file(s) (2 fingerprinted), 4 header rule(s)

HIGH     assets/app.3f2a9c1b.js.gz assets/app.3f2a9c1b.js.gz does not decompress to the current assets/app.3f2a9c1b.js [cache-precompressed-stale]
HIGH     vercel.json:3 HTML /index.html is cached for 86400s (public, max-age=86400) [cache-html-long]
HIGH     vercel.json:4 Fingerprinted /assets/app.3f2a9c1b.js is cached only 3600s (public, max-age=3600) (+1 more file(s) with the same rule) [cache-hashed-short]
HIGH     vercel.json:5 Unfingerprinted /styles.css is cached immutable (public, max-age=31536000, immutable) [cache-unhashed-immutable]
MEDIUM   styles.css styles.css (3 KB) has no .br or .gz sibling [cache-precompressed-missing]
MEDIUM   vercel.json:4 Vary: * on /assets/app.3f2a9c1b.js (+1 more file(s) with the same rule) [cache-vary-star]
```

## Options

```text
cache-pulse 1.0.0 — check caching and precompression in your static hosting config

Usage: cache-pulse [site-dir] [options]

Site
      --base-url <url>        Public URL of the site, e.g. https://example.com (default: inferred from canonical/og:url)
      --include <globs>       Only check these pages (file or URL path globs, comma-separated)
      --exclude <globs>       Skip these pages
      --clean-urls            Pages are served without .html (about.html -> /about)
Caching
      --expect-precompressed   Require .br/.gz siblings for text assets even if none exist yet

Common
  -c, --config <file>     JSON config (default: .cache-pulse.json or "cachePulse" in package.json)
  -f, --format <fmt>      text (default) | json | sarif | markdown
      --json <file>       Also write a JSON report
      --sarif <file>      Also write SARIF 2.1.0
      --markdown <file>   Also write Markdown (e.g. for a job summary)
      --fail-on <sev>     critical | high | medium | low | info | none (default: high)
      --list-rules        Print rules and default severities
      --no-fixes          Hide fix suggestions in text output
      --no-color          Disable colours
  -v, --version / -h, --help

Exit codes: 0 = passed, 1 = findings at or above --fail-on, 2 = usage, config or read error.
```

## Configuration and allowlist

Options can live in `.cache-pulse.json` (or a `"cachePulse"` key in `package.json`, or `--config <file>`):

```json
{
  "failOn": "medium",
  "severity": {
    "cache-hashed-short": "low"
  },
  "allowlist": [
    {
      "rule": "cache-unhashed-immutable",
      "subject": "/fonts/inter-4.0.woff2",
      "reason": "Version in the file name, never changes",
      "expires": "2027-03-31"
    }
  ],
  "maxHtmlAge": 300,
  "maxUnhashedAge": 3600,
  "hashedPaths": [
    "/fonts/*-v[0-9]*.woff2"
  ],
  "expectPrecompressed": true
}
```

- **`severity`** changes a rule's severity, or turns it `"off"`.
- **`allowlist`** entries suppress matching findings. Each needs a `reason` and matches on any combination of `rule`, `file`, `subject` (globs with `*`) and `match` (a substring of the message). Add `expires` (`YYYY-MM-DD`) so the exception is time-boxed: once it lapses the finding comes back along with an `allowlist-expired` finding (medium). Entries that no longer match anything are reported as `allowlist-unused` (info).

Config can also set `baseUrl`, `include`, `exclude` and `cleanUrls`. The config file is looked up in the site directory first, then in the current directory, so `.cache-pulse.json` can live at your repository root. Other keys: `maxHtmlAge` (seconds, default 600), `maxUnhashedAge` (default one week), `hashedPaths` (globs to treat as fingerprinted), `expectPrecompressed`, `minCompressSize`, plus `baseUrl`, `include`, `exclude` and `cleanUrls`.

## Output and exit codes

- `--format text` (default), `json`, `sarif` (SARIF 2.1.0 for GitHub code scanning) or `markdown` (for job summaries and PR comments). `--json`, `--sarif` and `--markdown` write extra report files in the same run.
- `--fail-on <severity>` sets the threshold (`critical`, `high`, `medium`, `low`, `info`, `none`; default `high`).
- Exit codes: **0** passed, **1** findings at or above `--fail-on`, **2** usage, config or read error.

## GitHub Action

```yaml
permissions:
  contents: read
  security-events: write   # only needed for the SARIF upload
jobs:
  cache-pulse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with: { persist-credentials: false }
      - run: npm ci && npm run build   # produce the static site first
      - uses: MrLouisWright/cache-pulse@v1
        with:
          path: dist
          fail-on: high
          sarif: cache-pulse.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with: { sarif_file: cache-pulse.sarif }
```

| Input | Description | Default |
|---|---|---|
| `path` | Built site directory (e.g. dist, public, _site) | `.` |
| `base-url` | Public URL of the site, e.g. https://example.com | |
| `fail-on` | Failure threshold | `high` |
| `config` | Config file path | |
| `sarif` / `json` | Write SARIF / JSON report to this path | |
| `job-summary` | Add the Markdown report to the job summary | `true` |
| `args` | Extra CLI arguments | |

The action runs the bundled CLI with Node 20; it has no dependencies to install. Pin it to a commit SHA if your policy requires it.

## Library

```js
import { check, isHashed, parseCacheControl } from "cache-pulse";
isHashed("/assets/index-BdT9x2Qa.js"); // true
parseCacheControl("public, max-age=31536000, immutable").immutable; // true
```

Types are included.

## Requirements

Node.js 18 or newer. Zero runtime dependencies.

## Support

If this project is useful to you, you can support its development with a donation: [Buy me a coffee](https://donate.stripe.com/aFa00lek3cvX4Ds2Fk9EI0b). It helps keep these tools maintained, documented and free for everyone.

## Credit (optional)

Free to use under MIT, no attribution required. If cache-pulse helps you, a link back is appreciated:

```html
<a href="https://louiswright.co.uk">Built with cache-pulse by Louis Wright</a>
```

```markdown
[![Built with cache-pulse by Louis Wright](https://img.shields.io/badge/built%20with-cache--pulse-blue)](https://louiswright.co.uk)
```

## Licence

MIT © Louis Wright ([Louis Wright](https://github.com/MrLouisWright))
