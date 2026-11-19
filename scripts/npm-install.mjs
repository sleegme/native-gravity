#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PACKAGE_NAME = '@sleeg/ntg';
const INSTALL_SH_URL = 'https://raw.githubusercontent.com/sleegme/native-gravity/main/scripts/install.sh';
const INSTALL_PS1_URL = 'https://raw.githubusercontent.com/sleegme/native-gravity/main/scripts/install.ps1';
const POSTINSTALL_STAMP_FILE = '.ntg-postinstall-applied';

function readPackageJson(root = packageRoot) {
  try {
    return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function getVersion(root = packageRoot) {
  const pkg = readPackageJson(root);
  return pkg?.version || '0.0.0';
}

function getPackageName(root = packageRoot) {
  const pkg = readPackageJson(root);
  return typeof pkg?.name === 'string' && pkg.name.trim() ? pkg.name.trim() : DEFAULT_PACKAGE_NAME;
}

function hasPostinstallStamp(root = packageRoot) {
  const stampPath = join(root, POSTINSTALL_STAMP_FILE);
  if (!existsSync(stampPath)) return false;
  try {
    return readFileSync(stampPath, 'utf8').trim() === getVersion(root);
  } catch {
    return false;
  }
}

function writePostinstallStamp(root = packageRoot) {
  try {
    writeFileSync(join(root, POSTINSTALL_STAMP_FILE), `${getVersion(root)}\n`, 'utf8');
  } catch {
    // ignore stamp write errors (e.g., read-only install locations)
  }
}

function printUsage(stream = process.stdout) {
  const usage = `Native Gravity installer

Usage:
  native-gravity [command]
  ntg [command]

Commands:
  install                 Install Native Gravity plugin via Antigravity CLI (default)
  reinstall               Perform clean reinstall (uninstall first, then install)
  update [--no-self-update]
                          Upgrade to the latest release (npm, Bun, curl, or irm),
                          then clean reinstall
  -h, --help, help        Show this help message
  -v, --version, version  Show version information
`;
  stream.write(usage);
}

const MIN_AGY = [1, 3, 0];

function checkAgyCli({ allowMissing = false, env = process.env } = {}) {
  const warnOrExit = (lines, exitCode = 1) => {
    if (allowMissing) {
      console.error(
        `Native Gravity: Antigravity CLI (\`agy\` >= ${MIN_AGY.join('.')}) not available on PATH during postinstall; run \`ntg\` or \`native-gravity\` after installing AGY.`
      );
      return false;
    }
    for (const line of lines) console.error(line);
    process.exit(exitCode);
  };

  const check = spawnSync('agy', ['--version'], { encoding: 'utf8', env });
  if (check.error) {
    if (check.error.code === 'ENOENT') {
      return warnOrExit([
        'Native Gravity requires Antigravity CLI (`agy`) on PATH.',
        'Install AGY first: https://antigravity.google/docs/cli/install/',
      ], 1);
    }
    return warnOrExit(['Could not execute `agy --version`. Check your Antigravity CLI installation.'], check.status ?? 1);
  }
  if (check.status !== 0) {
    return warnOrExit(['Could not execute `agy --version`. Check your Antigravity CLI installation.'], check.status ?? 1);
  }
  const out = (check.stdout ?? '').trim();
  const match = out.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-((0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(\+([0-9a-zA-Z-]+(\.[0-9a-zA-Z-]+)*))?$/);
  if (!match) {
    return warnOrExit([
      `Could not determine AGY version from \`agy --version\` output: ${JSON.stringify(out)}`,
      `Native Gravity requires AGY >= ${MIN_AGY.join('.')}. Upgrade: https://antigravity.google/download`,
    ], 1);
  }
  const found = [Number(match[1]), Number(match[2]), Number(match[3])];
  const below = found[0] < MIN_AGY[0]
    || (found[0] === MIN_AGY[0] && (found[1] < MIN_AGY[1] || (found[1] === MIN_AGY[1] && found[2] < MIN_AGY[2])))
    || (match[4] !== undefined && found[0] === MIN_AGY[0] && found[1] === MIN_AGY[1] && found[2] === MIN_AGY[2]);
  if (below) {
    return warnOrExit([
      `Native Gravity requires AGY >= ${MIN_AGY.join('.')} (found ${out}). Upgrade: https://antigravity.google/download`,
    ], 1);
  }
  return true;
}

function runCommand(cmd, cmdArgs, { env = process.env, stdio = 'inherit' } = {}) {
  try {
    const result = spawnSync(cmd, cmdArgs, { stdio, env });
    if (stdio !== 'inherit' && result.stdout && result.stdout.length > 0) {
      process.stderr.write(result.stdout);
    }
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

function verifyPluginInstalled({ env = process.env } = {}) {
  const check = spawnSync('agy', ['plugin', 'list', '--json'], { encoding: 'utf8', env });
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

function installDataHomes(env = process.env, home = homedir(), platform = process.platform) {
  const homes = [];
  if (env.LOCALAPPDATA) homes.push({ home: resolve(env.LOCALAPPDATA), shell: 'ps1' });
  const sharedHomes = [env.XDG_DATA_HOME, join(home, '.local', 'share')];
  for (const path of sharedHomes) {
    if (!path) continue;
    const resolved = resolve(path);
    if (homes.some((entry) => entry.home === resolved)) continue;
    homes.push({ home: resolved, shell: platform === 'win32' ? 'ps1' : 'sh' });
  }
  return homes;
}

function findScriptInstall(scriptPath, env = process.env, home = homedir(), platform = process.platform) {
  for (const candidate of scriptPathCandidates(scriptPath)) {
    const root = resolve(dirname(candidate), '..');
    const parent = dirname(root);
    if (basename(parent) !== 'native-gravity') continue;
    const dataHome = dirname(parent);
    const match = installDataHomes(env, home, platform).find((entry) => entry.home === dataHome);
    if (match) return { root, dataHome, shell: match.shell };
  }
  return null;
}

function isInstalledPackageContext(
  scriptPath = fileURLToPath(import.meta.url),
  env = process.env,
  home = homedir(),
  platform = process.platform
) {
  if (env.NTG_FORCE_POSTINSTALL === '1') return true;
  if (findNodeModulesRoots(scriptPath).length > 0) return true;
  const candidates = scriptPathCandidates(scriptPath);
  const bunGlobalRoots = [resolve(join(home, '.bun'), 'install', 'global')];
  if (env.BUN_INSTALL) bunGlobalRoots.push(resolve(env.BUN_INSTALL, 'install', 'global'));
  if (candidates.some((candidate) => bunGlobalRoots.some((root) => isPathInside(candidate, root)))) {
    return true;
  }
  if (findScriptInstall(scriptPath, env, home, platform)) return true;
  return false;
}

function ensureBunGlobalTrusted({ env = process.env, home = homedir() } = {}) {
  const candidates = [resolve(join(home, '.bun'), 'install', 'global', 'package.json')];
  if (env.BUN_INSTALL) {
    candidates.push(resolve(env.BUN_INSTALL, 'install', 'global', 'package.json'));
  }
  const requiredTrusted = ['native-gravity', '@sleeg/ntg'];
  let updatedAny = false;
  for (const pkgPath of [...new Set(candidates)]) {
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) continue;
      const existing = Array.isArray(pkg.trustedDependencies) ? [...pkg.trustedDependencies] : [];
      let changed = !Array.isArray(pkg.trustedDependencies);
      for (const name of requiredTrusted) {
        if (!existing.includes(name)) {
          existing.push(name);
          changed = true;
        }
      }
      if (changed) {
        pkg.trustedDependencies = existing;
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
        updatedAny = true;
      }
    } catch {
      // best-effort: never block installation if Bun's global manifest cannot be updated
    }
  }
  return updatedAny;
}

function detectInstallMethod(scriptPath = fileURLToPath(import.meta.url), env = process.env, home = homedir(), platform = process.platform) {
  const candidates = scriptPathCandidates(scriptPath);
  const bunGlobalRoots = [resolve(join(home, '.bun'), 'install', 'global')];
  if (env.BUN_INSTALL) bunGlobalRoots.push(resolve(env.BUN_INSTALL, 'install', 'global'));
  if (candidates.some((candidate) => bunGlobalRoots.some((root) => isPathInside(candidate, root)))) {
    return { type: 'package', manager: 'bun' };
  }
  if (candidates.some((candidate) => findNodeModulesRoots(candidate).length > 0)) {
    return { type: 'package', manager: 'npm' };
  }
  const scriptInstall = findScriptInstall(scriptPath, env, home, platform);
  if (scriptInstall) return { type: 'script', ...scriptInstall };
  return { type: 'package', manager: 'npm' };
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

function buildSelfUpdateCommand(packageManager, packageName, env = process.env, platform = process.platform) {
  const packageSpec = `${packageName}@latest`;
  const args = packageManager === 'bun'
    ? ['add', '-g', packageSpec]
    : ['install', '-g', packageSpec];
  const override = env.NTG_SELF_UPDATE_CMD ? splitCommand(env.NTG_SELF_UPDATE_CMD) : null;
  if (override) return { cmd: override[0], args: [...override.slice(1), ...args] };
  // Node >= 18.20 / 20.12 refuses to spawn .cmd files without a shell (CVE-2024-27980).
  // The args are fixed constants, so running npm.cmd through the shell is safe.
  if (packageManager === 'npm' && platform === 'win32') return { cmd: 'npm.cmd', args, shell: true };
  return { cmd: packageManager, args };
}

function scriptInstallOneLiner(shell) {
  return shell === 'ps1'
    ? `irm ${INSTALL_PS1_URL} | iex`
    : `curl -fsSL ${INSTALL_SH_URL} | sh`;
}

function buildScriptInstallCommand(shell, env = process.env) {
  const override = env[shell === 'ps1' ? 'NTG_INSTALL_PS1_CMD' : 'NTG_INSTALL_SH_CMD'];
  if (override) {
    const parts = splitCommand(override);
    if (parts) return { cmd: parts[0], args: parts.slice(1) };
  }
  return shell === 'ps1'
    ? { cmd: 'powershell', args: ['-c', scriptInstallOneLiner('ps1')] }
    : { cmd: 'sh', args: ['-c', scriptInstallOneLiner('sh')] };
}

function compareVersions(left, right) {
  const leftParts = String(left ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (leftParts[i] ?? 0) - (rightParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function scriptInstallVersion(script) {
  return readPackageJson(resolve(dirname(script), '..'))?.version ?? '0.0.0';
}

function resolveScriptInstallScript(scriptPath, options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const current = findScriptInstall(scriptPath, env, home, platform);
  if (!current) return scriptPath;

  const candidates = [join(current.root, 'scripts', 'npm-install.mjs')];
  try {
    for (const entry of readdirSync(join(current.dataHome, 'native-gravity'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const script = join(current.dataHome, 'native-gravity', entry.name, 'scripts', 'npm-install.mjs');
      if (existsSync(script)) candidates.push(script);
    }
  } catch {
    // the install root is missing: fall back to the running script
  }

  const unique = [...new Set(candidates.map((candidate) => resolve(candidate)))];
  unique.sort((left, right) => compareVersions(scriptInstallVersion(right), scriptInstallVersion(left)));
  return unique.find((candidate) => existsSync(candidate)) ?? scriptPath;
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
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const spawn = options.spawnSync ?? spawnSync;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  const oldVersion = getVersion(root);
  const packageName = resolveUpdatePackageName(root, scriptPath);
  const installMethod = detectInstallMethod(scriptPath, env, home, platform);
  const isScriptInstall = installMethod.type === 'script';
  const command = isScriptInstall
    ? buildScriptInstallCommand(installMethod.shell, env)
    : buildSelfUpdateCommand(installMethod.manager, packageName, env, platform);
  const commandLine = [command.cmd, ...command.args].join(' ');
  const upgradeVia = isScriptInstall
    ? `${installMethod.shell === 'ps1' ? 'PowerShell' : 'curl'} installer: ${scriptInstallOneLiner(installMethod.shell)}`
    : `${installMethod.manager}: ${commandLine}`;

  stdout.write(`Upgrading ${packageName} with ${upgradeVia}\n`);

  const spawnEnv = { ...env, NTG_SKIP_POSTINSTALL: '1' };
  const result = spawn(command.cmd, command.args, { stdio: 'inherit', env: spawnEnv, shell: command.shell === true });
  if (result.error) {
    stderr.write(`Self-update failed: could not run '${command.cmd}': ${result.error.message}\n`);
    return { ok: false, status: 1 };
  }
  if (result.status !== 0) {
    const status = result.status ?? 1;
    stderr.write(`Self-update failed: '${commandLine}' exited with code ${status}\n`);
    return { ok: false, status };
  }

  const freshScript = isScriptInstall
    ? resolveScriptInstallScript(scriptPath, { env, home, platform })
    : resolveInstalledScript(scriptPath, getPackageName(root));
  const freshVersion = readPackageJson(resolve(dirname(freshScript), '..'))?.version ?? 'unknown';
  stdout.write(`Updated ${packageName} ${oldVersion} -> ${freshVersion}\n`);
  return {
    ok: true,
    status: 0,
    scriptPath: freshScript,
    packageName,
    packageManager: isScriptInstall ? null : installMethod.manager,
    installMethod,
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
  if (result.installMethod?.type === 'script') return 0;
  return runReinstallChild(result.scriptPath);
}

function runPostinstall(options = {}) {
  const scriptPath = options.scriptPath ?? fileURLToPath(import.meta.url);
  const root = options.packageRoot ?? packageRoot;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const stdio = options.stdio ?? 'inherit';

  if (env.NTG_SKIP_POSTINSTALL === '1') return 0;
  ensureBunGlobalTrusted({ env, home });
  if (!isInstalledPackageContext(scriptPath, env, home, platform)) return 0;
  if (hasPostinstallStamp(root)) return 0;
  if (!checkAgyCli({ allowMissing: true, env })) return 0;

  runCommand('agy', ['plugin', 'uninstall', 'native-gravity'], { env, stdio });
  runCommand('agy', ['plugin', 'install', root], { env, stdio });
  verifyPluginInstalled({ env });
  writePostinstallStamp(root);
  return 0;
}

function ensureInstalledPluginApplied(options = {}) {
  const scriptPath = options.scriptPath ?? fileURLToPath(import.meta.url);
  const root = options.packageRoot ?? packageRoot;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;

  if (env.NODE_TEST_CONTEXT || env.SKIP_LIVE_TESTS === '1' || env.NTG_SKIP_POSTINSTALL === '1') {
    return false;
  }
  if (!isInstalledPackageContext(scriptPath, env, home, platform)) return false;
  if (hasPostinstallStamp(root)) return false;
  runPostinstall({ scriptPath, packageRoot: root, env, home, platform, stdio: ['ignore', 'pipe', 'inherit'] });
  return true;
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
    } else if (arg === '--postinstall' || arg === 'postinstall') {
      command = 'postinstall';
    } else {
      console.error(`Unknown argument: ${arg}\n`);
      printUsage(process.stderr);
      process.exit(2);
    }
  } else if (args.length === 2 && args[0] === 'update' && args[1] === '--no-self-update') {
    command = 'update';
    noSelfUpdate = true;
  } else if (args.length === 2 && args[0] === 'install' && args[1] === '--postinstall') {
    command = 'postinstall';
  } else {
    console.error(`Unexpected arguments: ${args.join(' ')}\n`);
    printUsage(process.stderr);
    process.exit(2);
  }

  if (command === 'postinstall') {
    process.exit(runPostinstall());
  }

  if (command === 'update' && !noSelfUpdate) {
    process.exit(runUpdate());
  }

  ensureBunGlobalTrusted();
  checkAgyCli();

  runCommand('agy', ['plugin', 'uninstall', 'native-gravity']);
  runCommand('agy', ['plugin', 'install', packageRoot]);
  verifyPluginInstalled();
  writePostinstallStamp(packageRoot);
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
  buildScriptInstallCommand,
  buildSelfUpdateCommand,
  detectInstallMethod,
  ensureBunGlobalTrusted,
  ensureInstalledPluginApplied,
  getPackageName,
  getVersion,
  isInstalledPackageContext,
  resolveInstalledScript,
  resolveScriptInstallScript,
  resolveUpdatePackageName,
  runPostinstall,
  runSelfUpdate,
};

if (isMainModule()) {
  main();
}
