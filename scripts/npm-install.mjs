#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'install';

if (!['install', 'reinstall'].includes(mode) || process.argv.length > 3) {
  console.error('Usage: native-gravity [install|reinstall]');
  process.exit(2);
}

const agyCheck = spawnSync('agy', ['--version'], { stdio: 'ignore' });

if (agyCheck.error?.code === 'ENOENT') {
  console.error('Native Gravity requires Antigravity CLI (`agy`) on PATH.');
  console.error('Install AGY first: https://antigravity.google/docs/cli/install/');
  process.exit(1);
}

if (agyCheck.status !== 0) {
  console.error('Could not execute `agy --version`. Check your Antigravity CLI installation.');
  process.exit(agyCheck.status ?? 1);
}

if (mode === 'reinstall') {
  spawnSync('agy', ['plugin', 'uninstall', 'native-gravity'], { stdio: 'inherit' });
}

const install = spawnSync('agy', ['plugin', 'install', packageRoot], { stdio: 'inherit' });

if (install.error) {
  console.error(`Failed to start Antigravity CLI: ${install.error.message}`);
  process.exit(1);
}

process.exit(install.status ?? 1);
