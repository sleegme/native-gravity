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
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const NTG_PACKAGE_NAMES = ['native-gravity', '@sleeg/ntg'];
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function normalizeVersion(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^v(?=\d)/, '');
  if (!trimmed || !SEMVER_RE.test(trimmed)) return null;
  return trimmed;
}

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

function bunGlobalManifestPaths({ env = process.env, home = homedir() } = {}) {
  const candidates = [resolve(join(home, '.bun'), 'install', 'global', 'package.json')];
  if (env.BUN_INSTALL) {
    candidates.push(resolve(env.BUN_INSTALL, 'install', 'global', 'package.json'));
  }
  return [...new Set(candidates)];
}

function isLocalPackageSpecifier(specifier) {
  if (typeof specifier !== 'string') return false;
  const trimmed = specifier.trim();
  if (!trimmed) return false;

  if (/^(?:file|link|portal):/i.test(trimmed)) return true;
  if (trimmed === '.' || trimmed === '..') return true;
  if (/^(?:\.\.?[\\/]|\/|~[\\/]|[a-zA-Z]:[\\/])/.test(trimmed)) return true;

  const withoutQueryOrHash = trimmed.split(/[?#]/, 1)[0];
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && /\.(?:tgz|tar\.gz)$/i.test(withoutQueryOrHash)) {
    return true;
  }
  return false;
}

function detectBunGlobalConflicts({ env = process.env, home = homedir() } = {}) {
  const conflicts = [];
  for (const manifestPath of bunGlobalManifestPaths({ env, home })) {
    if (!existsSync(manifestPath)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) continue;

    const entries = [];
    for (const section of DEPENDENCY_SECTIONS) {
      const deps = pkg[section];
      if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
      for (const name of NTG_PACKAGE_NAMES) {
        if (Object.prototype.hasOwnProperty.call(deps, name) && deps[name] !== undefined) {
          entries.push({ name, specifier: deps[name], section });
        }
      }
    }

    if (entries.length === 0) continue;

    const foundNames = new Set(entries.map((entry) => entry.name));
    if (foundNames.has('native-gravity') && foundNames.has('@sleeg/ntg')) {
      conflicts.push({
        type: 'duplicate-packages',
        manifestPath,
        packages: ['native-gravity', '@sleeg/ntg'],
        entries,
      });
    }

    for (const entry of entries) {
      if (isLocalPackageSpecifier(entry.specifier)) {
        conflicts.push({
          type: 'local-specifier',
          manifestPath,
          packageName: entry.name,
          specifier: entry.specifier,
          section: entry.section,
        });
      }
    }
  }
  return conflicts;
}

function ensureBunGlobalTrusted({ env = process.env, home = homedir() } = {}) {
  let updatedAny = false;
  for (const pkgPath of bunGlobalManifestPaths({ env, home })) {
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) continue;
      const existing = Array.isArray(pkg.trustedDependencies) ? [...pkg.trustedDependencies] : [];
      let changed = !Array.isArray(pkg.trustedDependencies);
      for (const name of NTG_PACKAGE_NAMES) {
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

function resolveRegistryLatestVersion(packageName, options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  if (typeof options.resolveLatestVersion === 'function') {
    let resolved;
    try {
      resolved = options.resolveLatestVersion(packageName, { env, platform });
    } catch (err) {
      return {
        available: false,
        version: null,
        source: 'injected',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (resolved == null) {
      return { available: false, version: null, source: 'injected', reason: 'unavailable' };
    }
    if (typeof resolved === 'string') {
      const trimmed = resolved.trim();
      if (!trimmed) {
        return { available: false, version: null, source: 'injected', reason: 'unavailable' };
      }
      const version = normalizeVersion(trimmed);
      if (!version) {
        return {
          available: false,
          version: null,
          source: 'injected',
          error: `Invalid version returned by resolver: ${JSON.stringify(resolved)}`,
        };
      }
      return { available: true, version, source: 'injected' };
    }
    if (typeof resolved === 'object') {
      const source = typeof resolved.source === 'string' && resolved.source ? resolved.source : 'injected';
      if (resolved.available === false || resolved.version == null || String(resolved.version).trim() === '') {
        return {
          available: false,
          version: null,
          source,
          ...(resolved.reason ? { reason: resolved.reason } : { reason: 'unavailable' }),
          ...(resolved.error ? { error: resolved.error } : {}),
        };
      }
      const version = normalizeVersion(String(resolved.version));
      if (!version) {
        return {
          available: false,
          version: null,
          source,
          error: resolved.error || `Invalid version returned by resolver: ${JSON.stringify(resolved.version)}`,
        };
      }
      return { available: true, version, source };
    }
    return {
      available: false,
      version: null,
      source: 'injected',
      error: `Unsupported resolver result type: ${typeof resolved}`,
    };
  }

  if (Object.prototype.hasOwnProperty.call(env, 'NTG_LATEST_VERSION') && env.NTG_LATEST_VERSION !== undefined) {
    const raw = String(env.NTG_LATEST_VERSION).trim();
    const lowered = raw.toLowerCase();
    if (!raw || lowered === 'offline' || lowered === 'unavailable') {
      return { available: false, version: null, source: 'env', reason: 'unavailable' };
    }
    const version = normalizeVersion(raw);
    if (!version) {
      return {
        available: false,
        version: null,
        source: 'env',
        error: `Invalid NTG_LATEST_VERSION value: ${JSON.stringify(raw)}`,
      };
    }
    return { available: true, version, source: 'env' };
  }

  if (typeof env.NTG_REGISTRY_LOOKUP_CMD === 'string' && env.NTG_REGISTRY_LOOKUP_CMD.trim() !== '') {
    const parts = splitCommand(env.NTG_REGISTRY_LOOKUP_CMD);
    if (!parts) {
      return {
        available: false,
        version: null,
        source: 'env-cmd',
        error: 'Empty NTG_REGISTRY_LOOKUP_CMD override',
      };
    }
    const lookupRes = spawnSync(parts[0], [...parts.slice(1), packageName], {
      encoding: 'utf8',
      env,
      timeout: 10000,
    });
    if (lookupRes.error) {
      return { available: false, version: null, source: 'env-cmd', error: lookupRes.error.message };
    }
    if (lookupRes.status !== 0) {
      const errMsg = (lookupRes.stderr ?? '').trim() || `Lookup command exited with code ${lookupRes.status ?? 1}`;
      return { available: false, version: null, source: 'env-cmd', error: errMsg };
    }
    const rawOut = String(lookupRes.stdout ?? '').trim();
    const version = normalizeVersion(rawOut);
    if (!version) {
      return {
        available: false,
        version: null,
        source: 'env-cmd',
        error: `Invalid version output from NTG_REGISTRY_LOOKUP_CMD: ${JSON.stringify(rawOut)}`,
      };
    }
    return { available: true, version, source: 'env-cmd' };
  }

  if (
    options.skipRegistryLookup === true
    || env.SKIP_LIVE_TESTS === '1'
    || Boolean(env.NODE_TEST_CONTEXT)
    || Boolean(env.NTG_SELF_UPDATE_CMD)
    || Boolean(env.NTG_INSTALL_SH_CMD)
    || Boolean(env.NTG_INSTALL_PS1_CMD)
    || typeof options.spawnSync === 'function'
  ) {
    return { available: false, version: null, source: 'skipped', reason: 'offline-or-stubbed' };
  }

  const npmCmd = platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmRes = spawnSync(npmCmd, ['view', packageName, 'version'], {
    encoding: 'utf8',
    env,
    shell: platform === 'win32',
    timeout: 10000,
  });
  if (!npmRes.error && npmRes.status === 0) {
    const npmVersion = normalizeVersion(npmRes.stdout ?? '');
    if (npmVersion) {
      return { available: true, version: npmVersion, source: 'npm-view' };
    }
  }
  const npmError = npmRes.error
    ? npmRes.error.message
    : npmRes.status === 0
      ? `npm view returned invalid version: ${JSON.stringify((npmRes.stdout ?? '').trim())}`
      : ((npmRes.stderr ?? '').trim() || `npm view exited with code ${npmRes.status ?? 1}`);

  const fetchScript = [
    '(async () => {',
    '  const pkg = process.argv[1];',
    "  const res = await fetch('https://registry.npmjs.org/' + encodeURIComponent(pkg) + '/latest', { signal: AbortSignal.timeout(8000) });",
    '  if (res.ok) {',
    '    const data = await res.json();',
    "    if (typeof data?.version === 'string' && data.version.trim()) {",
    "      process.stdout.write(data.version.trim() + '\\n');",
    '      return;',
    '    }',
    '  }',
    "  if (pkg.startsWith('@')) {",
    "    const alt = await fetch('https://registry.npmjs.org/' + encodeURIComponent(pkg), {",
    "      headers: { accept: 'application/vnd.npm.install-v1+json' },",
    '      signal: AbortSignal.timeout(8000),',
    '    });',
    '    if (alt.ok) {',
    '      const data = await alt.json();',
    "      const latest = data?.['dist-tags']?.latest;",
    "      if (typeof latest === 'string' && latest.trim()) {",
    "        process.stdout.write(latest.trim() + '\\n');",
    '        return;',
    '      }',
    '    }',
    '    process.stderr.write(`HTTP ${alt.status}\\n`);',
    '    process.exit(1);',
    '  }',
    '  process.stderr.write(`HTTP ${res.status}\\n`);',
    '  process.exit(1);',
    '})().catch((err) => {',
    "  process.stderr.write((err?.message || String(err)) + '\\n');",
    '  process.exit(1);',
    '});',
  ].join('\n');

  const fetchRes = spawnSync(process.execPath, ['-e', fetchScript, packageName], {
    encoding: 'utf8',
    env,
    timeout: 10000,
  });
  if (!fetchRes.error && fetchRes.status === 0) {
    const fetchedVersion = normalizeVersion(fetchRes.stdout ?? '');
    if (fetchedVersion) {
      return { available: true, version: fetchedVersion, source: 'registry-fetch' };
    }
  }
  const fetchError = fetchRes.error
    ? fetchRes.error.message
    : fetchRes.status === 0
      ? `registry fetch returned invalid version: ${JSON.stringify((fetchRes.stdout ?? '').trim())}`
      : ((fetchRes.stderr ?? '').trim() || `registry fetch exited with code ${fetchRes.status ?? 1}`);

  return {
    available: false,
    version: null,
    source: 'registry',
    error: `npm view failed (${npmError}); registry fetch failed (${fetchError})`,
  };
}

function formatBunGlobalConflictDiagnostics(conflicts) {
  const lines = ['Self-update aborted: conflicting Bun global dependency configuration detected.'];
  for (const conflict of conflicts) {
    if (conflict.type === 'duplicate-packages') {
      const entrySummary = conflict.entries
        .map((entry) => `${entry.name}=${JSON.stringify(entry.specifier)} (${entry.section})`)
        .join(', ');
      lines.push(
        `- Duplicate packages in ${conflict.manifestPath}: both 'native-gravity' and '@sleeg/ntg' are present (${entrySummary}).`
      );
    } else if (conflict.type === 'local-specifier') {
      lines.push(
        `- Local tarball/path specifier in ${conflict.manifestPath} (${conflict.section}): ${conflict.packageName}=${JSON.stringify(conflict.specifier)}.`
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

function formatUpdateRecoveryGuidance({
  reason,
  packageName = DEFAULT_PACKAGE_NAME,
  installMethod,
  conflicts = [],
} = {}) {
  const lines = ['To recover safely, run:'];
  if (reason === 'bun-global-conflict') {
    const hasDuplicate = conflicts.some((conflict) => conflict.type === 'duplicate-packages');
    const removePackages = hasDuplicate
      ? [...NTG_PACKAGE_NAMES]
      : [...new Set(conflicts.map((conflict) => conflict.packageName).filter(Boolean))];
    const toRemove = removePackages.length > 0 ? removePackages : [packageName];
    lines.push(`  bun remove -g ${toRemove.join(' ')}`);
    lines.push(`  bun add -g ${packageName}@latest`);
    lines.push('  ntg reinstall');
    return `${lines.join('\n')}\n`;
  }

  if (installMethod?.type === 'script') {
    const shell = installMethod.shell === 'ps1' ? 'ps1' : 'sh';
    lines.push(`  ${scriptInstallOneLiner(shell)}`);
    lines.push('  ntg reinstall');
    return `${lines.join('\n')}\n`;
  }

  if (installMethod?.manager === 'bun') {
    lines.push(`  bun remove -g ${packageName}`);
    lines.push(`  bun add -g ${packageName}@latest`);
    lines.push('  ntg reinstall');
    return `${lines.join('\n')}\n`;
  }

  lines.push(`  npm uninstall -g ${packageName}`);
  lines.push(`  npm install -g ${packageName}@latest`);
  lines.push('  ntg reinstall');
  return `${lines.join('\n')}\n`;
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

  const shouldCheckBunConflicts = installMethod.manager === 'bun'
    || (installMethod.type === 'package' && findNodeModulesRoots(scriptPath).length === 0);
  if (shouldCheckBunConflicts) {
    const conflicts = detectBunGlobalConflicts({ env, home });
    if (conflicts.length > 0) {
      stderr.write(formatBunGlobalConflictDiagnostics(conflicts));
      stderr.write(formatUpdateRecoveryGuidance({
        reason: 'bun-global-conflict',
        packageName,
        installMethod,
        conflicts,
      }));
      return {
        ok: false,
        status: 1,
        reason: 'bun-global-conflict',
        packageName,
        packageManager: isScriptInstall ? null : installMethod.manager,
        installMethod,
        oldVersion,
        conflicts,
      };
    }
  }

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
  const freshPkg = readPackageJson(resolve(dirname(freshScript), '..'));
  const freshVersion = freshPkg?.version ?? 'unknown';
  const versionLookupPackageName = (typeof freshPkg?.name === 'string' && freshPkg.name.trim())
    ? freshPkg.name.trim()
    : getPackageName(root);

  const latestLookup = resolveRegistryLatestVersion(versionLookupPackageName, {
    env,
    platform,
    resolveLatestVersion: options.resolveLatestVersion,
    skipRegistryLookup: options.skipRegistryLookup,
    spawnSync: options.spawnSync,
  });
  const expectedVersion = latestLookup.available ? latestLookup.version : null;
  if (!latestLookup.available && latestLookup.error) {
    stderr.write(
      `Warning: could not verify latest registry version for ${versionLookupPackageName} (${latestLookup.error}); skipping post-update version check.\n`
    );
  }

  const normalizedFreshVersion = normalizeVersion(freshVersion)
    ?? String(freshVersion ?? '').trim().replace(/^v(?=\d)/, '');
  const normalizedExpectedVersion = expectedVersion
    ? (normalizeVersion(expectedVersion) ?? expectedVersion)
    : null;

  if (normalizedExpectedVersion && normalizedFreshVersion !== normalizedExpectedVersion) {
    stderr.write(
      `Update verification failed for ${packageName}: expected latest version ${normalizedExpectedVersion}, but installed version is ${freshVersion} (previous: ${oldVersion}).\n`
    );
    stderr.write(formatUpdateRecoveryGuidance({
      reason: 'version-mismatch',
      packageName,
      installMethod,
      oldVersion,
      newVersion: freshVersion,
      expectedVersion: normalizedExpectedVersion,
    }));
    return {
      ok: false,
      status: 1,
      reason: 'version-mismatch',
      scriptPath: freshScript,
      packageName,
      packageManager: isScriptInstall ? null : installMethod.manager,
      installMethod,
      oldVersion,
      newVersion: freshVersion,
      expectedVersion: normalizedExpectedVersion,
    };
  }

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
    expectedVersion: normalizedExpectedVersion,
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
  bunGlobalManifestPaths,
  detectBunGlobalConflicts,
  detectInstallMethod,
  ensureBunGlobalTrusted,
  ensureInstalledPluginApplied,
  formatUpdateRecoveryGuidance,
  getPackageName,
  getVersion,
  isInstalledPackageContext,
  isLocalPackageSpecifier,
  normalizeVersion,
  resolveInstalledScript,
  resolveRegistryLatestVersion,
  resolveScriptInstallScript,
  resolveUpdatePackageName,
  runPostinstall,
  runSelfUpdate,
};

if (isMainModule()) {
  main();
}
