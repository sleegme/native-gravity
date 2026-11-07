#!/usr/bin/env node
// Forwards to the native-gravity installer CLI with the same arguments.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('native-gravity/package.json'));
const result = spawnSync(process.execPath, [join(root, 'scripts/npm-install.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) {
  console.error(`ntg: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
