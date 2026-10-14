# Changelog

## 1.0.0 (2026-10-14)

First release, by Louis Wright.

- Reads Cache-Control, Vary, Set-Cookie and Content-Encoding from `_headers` (Netlify, Cloudflare Pages), `vercel.json`, `netlify.toml`, `firebase.json` and `serve.json`; most specific rule wins.
- Fingerprint detection for Vite, webpack, Rollup, Next.js, Astro, SvelteKit, Nuxt and CRA output, plus `hashedPaths`.
- Checks: long + immutable on fingerprinted assets, revalidation on HTML, no long cache on unfingerprinted files, no-store, Vary: *, Set-Cookie on static files, Content-Encoding on binary files.
- Precompressed `.br`/`.gz` siblings: missing or stale (decompressed and compared).
- Text/JSON/SARIF/Markdown output, `--fail-on`, exit codes 0/1/2, allowlist with expiry, severity overrides.
- Composite GitHub Action with job summary.
