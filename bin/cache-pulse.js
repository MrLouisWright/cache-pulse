#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mainCli, check, RULES, SITE_OPTIONS, SITE_HELP } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
mainCli({
  name: 'cache-pulse', version: pkg.version, configKey: 'cachePulse', rules: RULES,
  tagline: 'check caching and precompression in your static hosting config',
  usage: 'Usage: cache-pulse [site-dir] [options]',
  help: `${SITE_HELP}Caching
      --expect-precompressed   Require .br/.gz siblings for text assets even if none exist yet
`,
  options: { ...SITE_OPTIONS, 'expect-precompressed': { type: 'boolean' } },
  run: async ({ dir, values: o, config, configFile }) => check(dir, { cli: o, expectPrecompressed: o['expect-precompressed'] || undefined, toolVersion: pkg.version }, config, configFile),
});
