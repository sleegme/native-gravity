#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PACKAGE_NAME = '@sleeg/ntg';

function readPackageJson(root = packageRoot) {
  try {
    return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function getVersion(root = packageRoot) {
  const pkg = readPackageJson(root);
  return pkg?.version || '1.1.0';
}

function getPackageName(root = packageRoot) {
  const pkg = readPackageJson(root);
  return typeof pkg?.name === 'string' && pkg.name.trim() ? pkg.name.trim() : DEFAULT_PACKAGE_NAME;
}

function printUsage(stream = process.stdout) {
  const usage = `Native Gravity installer

Usage:
  native-gravity [command]

Commands:
  install                 Install Native Gravity plugin via Antigravity CLI (default)
  reinstall               Perform clean reinstall (uninstall first, then install)
  update [--no-self-update]
                          Upgrade the package to latest, then clean reinstall
  -h, --help, help        Show this help message
  -v, --version, version  Show version information
`;
  stream.write(usage);
}

const MIN_AGY = [1, 3, 0];

function checkAgyCli() {
  const check = spawnSync('agy', ['--version'], { encoding: 'utf8' });
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
  const out = (check.stdout ?? '').trim();
  const match = out.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-((0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(\+([0-9a-zA-Z-]+(\.[0-9a-zA-Z-]+)*))?$/);
  if (!match) {
    console.error(`Could not determine AGY version from \`agy --version\` output: ${JSON.stringify(out)}`);
    console.error(`Native Gravity requires AGY >= ${MIN_AGY.join('.')}. Upgrade: https://antigravity.google/download`);
    process.exit(1);
  }
  const found = [Number(match[1]), Number(match[2]), Number(match[3])];
  const below = found[0] < MIN_AGY[0]
    || (found[0] === MIN_AGY[0] && (found[1] < MIN_AGY[1] || (found[1] === MIN_AGY[1] && found[2] < MIN_AGY[2])))
    || (match[4] !== undefined && found[0] === MIN_AGY[0] && found[1] === MIN_AGY[1] && found[2] === MIN_AGY[2]);
  if (below) {
    console.error(`Native Gravity requires AGY >= ${MIN_AGY.join('.')} (found ${out}). Upgrade: https://antigravity.google/download`);
    process.exit(1);
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

function verifyPluginInstalled() {
  const check = spawnSync('agy', ['plugin', 'list', '--json'], { encoding: 'utf8' });
  if (check.error) {
    console.error(`Failed to execute 'agy plugin list --json': ${check.error.message}`);
    process.exit(1);
  }
  if (check.status !== 0) {
    console.error(`'agy plugin list --json' exited with code ${check.status ?? 1}`);
    process.exit(check.status ?? 1);
  }
  let plugins;
  try {
    plugins = JSON.parse(check.stdout ?? '');
  } catch (err) {
    console.error(`Plugin verification failed: could not parse 'agy plugin list --json' output as JSON: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(plugins)) {
    console.error("Plugin verification failed: 'agy plugin list --json' did not return a JSON array.");
    process.exit(1);
  }
  const match = plugins.find((item) => item && typeof item === 'object' && item.name === 'native-gravity');
  if (!match) {
    console.error("Plugin verification failed: 'native-gravity' not found in 'agy plugin list --json'.");
    process.exit(1);
  }
  if (match.enabled !== true) {
    console.error("Plugin verification failed: 'native-gravity' is not enabled in 'agy plugin list --json'.");
    process.exit(1);
  }
}

function scriptPathCandidates(scriptPath) {
  const candidates = [resolve(scriptPath)];
  try {
    const real = realpathSync(scriptPath);
    if (real !== candidates[0]) candidates.push(real);
  } catch {
    // keep the unresolved path
  }
  return candidates;
}

function isPathInside(target, parent) {
  const rel = relative(resolve(parent), resolve(target));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function detectPackageManager(scriptPath = fileURLToPath(import.meta.url), env = process.env, home = homedir()) {
  const bunGlobalRoots = [resolve(join(home, '.bun'), 'install', 'global')];
  if (env.BUN_INSTALL) bunGlobalRoots.push(resolve(env.BUN_INSTALL, 'install', 'global'));
  return scriptPathCandidates(scriptPath).some((candidate) => bunGlobalRoots.some((root) => isPathInside(candidate, root)))
    ? 'bun'
    : 'npm';
}

function findNodeModulesRoots(scriptPath) {
  const roots = [];
  for (const candidate of scriptPathCandidates(scriptPath)) {
    let dir = dirname(candidate);
    while (true) {
      if (basename(dir) === 'node_modules' && !roots.includes(dir)) roots.push(dir);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return roots;
}

function resolveUpdatePackageName(root = packageRoot, scriptPath = fileURLToPath(import.meta.url)) {
  const ownName = getPackageName(root);
  if (ownName.startsWith('@')) return ownName;
  const resolvedRoot = resolve(root);
  for (const modulesRoot of findNodeModulesRoots(scriptPath)) {
    const rel = relative(modulesRoot, resolvedRoot);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue;
    if (existsSync(join(modulesRoot, '@sleeg', 'ntg', 'package.json'))) return '@sleeg/ntg';
    const aliasRoot = dirname(modulesRoot);
    if (basename(aliasRoot) === 'ntg'
      && basename(dirname(aliasRoot)) === '@sleeg'
      && existsSync(join(aliasRoot, 'package.json'))) {
      return '@sleeg/ntg';
    }
  }
  return ownName;
}

function splitCommand(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((part) => typeof part === 'string')) {
        return parsed;
      }
    } catch {
      // fall through to whitespace splitting
    }
  }
  return trimmed.split(/\s+/);
}

function buildSelfUpdateCommand(packageManager, packageName, env = process.env) {
  const packageSpec = `${packageName}@latest`;
  const args = packageManager === 'bun'
    ? ['add', '-g', packageSpec]
    : ['install', '-g', packageSpec];
  const override = env.NTG_SELF_UPDATE_CMD ? splitCommand(env.NTG_SELF_UPDATE_CMD) : null;
  if (!override) return { cmd: packageManager, args };
  return { cmd: override[0], args: [...override.slice(1), ...args] };
}

function resolveInstalledScript(scriptPath, packageName) {
  const candidates = scriptPathCandidates(scriptPath);
  for (const modulesRoot of findNodeModulesRoots(scriptPath)) {
    candidates.push(join(modulesRoot, packageName, 'scripts', 'npm-install.mjs'));
    candidates.push(join(modulesRoot, '@sleeg', 'ntg', 'node_modules', 'native-gravity', 'scripts', 'npm-install.mjs'));
    candidates.push(join(modulesRoot, 'native-gravity', 'scripts', 'npm-install.mjs'));
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function runSelfUpdate(options = {}) {
  const scriptPath = options.scriptPath ?? fileURLToPath(import.meta.url);
  const root = options.packageRoot ?? packageRoot;
  const env = options.env ?? process.env;
  const spawn = options.spawnSync ?? spawnSync;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  const oldVersion = getVersion(root);
  const packageName = resolveUpdatePackageName(root, scriptPath);
  const packageManager = detectPackageManager(scriptPath, env);
  const command = buildSelfUpdateCommand(packageManager, packageName, env);
  const commandLine = [command.cmd, ...command.args].join(' ');

  stdout.write(`Upgrading ${packageName} with ${packageManager}: ${commandLine}\n`);

  const result = spawn(command.cmd, command.args, { stdio: 'inherit', env });
  if (result.error) {
    stderr.write(`Self-update failed: could not run '${command.cmd}': ${result.error.message}\n`);
    return { ok: false, status: 1 };
  }
  if (result.status !== 0) {
    const status = result.status ?? 1;
    stderr.write(`Self-update failed: '${commandLine}' exited with code ${status}\n`);
    return { ok: false, status };
  }

  const freshScript = resolveInstalledScript(scriptPath, getPackageName(root));
  const freshVersion = readPackageJson(resolve(dirname(freshScript), '..'))?.version ?? 'unknown';
  stdout.write(`Updated ${packageName} ${oldVersion} -> ${freshVersion}\n`);
  return {
    ok: true,
    status: 0,
    scriptPath: freshScript,
    packageName,
    packageManager,
    oldVersion,
    newVersion: freshVersion,
  };
}

function runReinstallChild(scriptPath, spawn = spawnSync, stderr = process.stderr) {
  const result = spawn(process.execPath, [scriptPath, 'reinstall'], { stdio: 'inherit' });
  if (result.error) {
    stderr.write(`Failed to execute '${process.execPath} ${scriptPath} reinstall': ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

function runUpdate() {
  const result = runSelfUpdate();
  if (!result.ok) return result.status;
  return runReinstallChild(result.scriptPath);
}

function main() {
  const args = process.argv.slice(2);
  let command = 'install';
  let noSelfUpdate = false;

  if (args.length === 0) {
    // default invocation
  } else if (args.length === 1) {
    const arg = args[0];
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      printUsage(process.stdout);
      process.exit(0);
    } else if (arg === '--version' || arg === '-v' || arg === 'version') {
      console.log(getVersion());
      process.exit(0);
    } else if (arg === 'install' || arg === 'reinstall' || arg === 'update') {
      command = arg;
    } else {
      console.error(`Unknown argument: ${arg}\n`);
      printUsage(process.stderr);
      process.exit(2);
    }
  } else if (args.length === 2 && args[0] === 'update' && args[1] === '--no-self-update') {
    command = 'update';
    noSelfUpdate = true;
  } else {
    console.error(`Unexpected arguments: ${args.join(' ')}\n`);
    printUsage(process.stderr);
    process.exit(2);
  }

  if (command === 'update' && !noSelfUpdate) {
    process.exit(runUpdate());
  }

  checkAgyCli();

  runCommand('agy', ['plugin', 'uninstall', 'native-gravity']);
  runCommand('agy', ['plugin', 'install', packageRoot]);
  verifyPluginInstalled();
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const scriptPath = fileURLToPath(import.meta.url);
    return resolve(process.argv[1]) === resolve(scriptPath)
      || (existsSync(process.argv[1])
        && existsSync(scriptPath)
        && realpathSync(process.argv[1]) === realpathSync(scriptPath));
  } catch {
    return false;
  }
}

export {
  buildSelfUpdateCommand,
  detectPackageManager,
  getPackageName,
  getVersion,
  resolveInstalledScript,
  resolveUpdatePackageName,
  runSelfUpdate,
};

if (isMainModule()) {
  main();
}
