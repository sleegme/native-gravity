#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function getVersion() {
  try {
    const pkgPath = resolve(packageRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg.version || '0.4.3';
  } catch {
    return '0.4.3';
  }
}

function printUsage(stream = process.stdout) {
  const usage = `Native Gravity installer

Usage:
  native-gravity [command]

Commands:
  install                 Install Native Gravity plugin via Antigravity CLI (default)
  reinstall, update       Perform clean reinstall (uninstall first, then install)
  -h, --help, help        Show this help message
  -v, --version, version  Show version information
`;
  stream.write(usage);
}

function checkAgyCli() {
  const check = spawnSync('agy', ['--version'], { stdio: 'ignore' });
  if (check.error) {
    if (check.error.code === 'ENOENT') {
      console.error('Native Gravity requires Antigravity CLI (`agy`) on PATH.');
      console.error('Install AGY first: https://antigravity.google/docs/cli/install/');
      process.exit(1);
    }
    console.error('Could not execute `agy --version`. Check your Antigravity CLI installation.');
    process.exit(check.status ?? 1);
  }
  if (check.status !== 0) {
    console.error('Could not execute `agy --version`. Check your Antigravity CLI installation.');
    process.exit(check.status ?? 1);
  }
}

function runCommand(cmd, cmdArgs) {
  try {
    const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit' });
    if (result.error) {
      console.error(`Failed to execute '${cmd}': ${result.error.message}`);
      process.exit(1);
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  } catch (err) {
    console.error(`Failed to execute '${cmd}': ${err.message}`);
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);
  let subcommand = 'install';

  if (args.length === 0) {
    subcommand = 'install';
  } else if (args.length === 1) {
    const arg = args[0];
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      printUsage(process.stdout);
      process.exit(0);
    } else if (arg === '--version' || arg === '-v' || arg === 'version') {
      console.log(getVersion());
      process.exit(0);
    } else if (arg === 'install') {
      subcommand = 'install';
    } else if (arg === 'reinstall' || arg === 'update') {
      subcommand = 'reinstall';
    } else {
      console.error(`Unknown argument: ${arg}\n`);
      printUsage(process.stderr);
      process.exit(2);
    }
  } else {
    console.error(`Unexpected arguments: ${args.join(' ')}\n`);
    printUsage(process.stderr);
    process.exit(2);
  }

  checkAgyCli();

  if (subcommand === 'reinstall') {
    runCommand('agy', ['plugin', 'uninstall', 'native-gravity']);
  }

  runCommand('agy', ['plugin', 'install', packageRoot]);
}

main();
