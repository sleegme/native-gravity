import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  buildSelfUpdateCommand,
  bunGlobalManifestPaths,
  detectBunGlobalConflicts,
  formatUpdateRecoveryGuidance,
  isLocalPackageSpecifier,
  normalizeVersion,
  resolveRegistryLatestVersion,
  runSelfUpdate,
} from '../scripts/npm-install.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const INSTALLER_SCRIPT = join(REPO_ROOT, 'scripts', 'npm-install.mjs');
const INSTALLER_SOURCE = readFileSync(INSTALLER_SCRIPT, 'utf8');
const OLD_VERSION = '0.0.1-old';
const NEW_VERSION = '0.0.2-new';

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createStubAgyScript() {
  return `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import process from 'node:process';

const logFile = process.env.STUB_AGY_LOG_FILE;
if (logFile) {
  appendFileSync(logFile, JSON.stringify({
    argv: process.argv.slice(2),
    env_home: process.env.HOME,
  }) + '\\n');
}

const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write((process.env.STUB_AGY_VERSION || '1.3.0') + '\\n');
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'uninstall') {
  process.stdout.write('Uninstalled native-gravity\\n');
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'install') {
  process.stdout.write('Installed plugin\\n');
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'list') {
  process.stdout.write(JSON.stringify([{ name: 'native-gravity', enabled: true }]) + '\\n');
  process.exit(0);
}

process.stderr.write('Unknown stub agy command: ' + args.join(' ') + '\\n');
process.exit(1);
`;
}

function createUpgradeStubScript() {
  return `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const logFile = process.env.STUB_UPGRADE_LOG_FILE;
if (logFile) {
  appendFileSync(logFile, JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    env_home: process.env.HOME,
  }) + '\\n');
}

if (process.env.STUB_UPGRADE_EXIT && process.env.STUB_UPGRADE_EXIT !== '0') {
  process.stderr.write(process.env.STUB_UPGRADE_ERR || 'upgrade failed\\n');
  process.exit(Number(process.env.STUB_UPGRADE_EXIT));
}

const pkgPath = process.env.STUB_UPGRADE_PACKAGE_JSON;
const newVersion = process.env.STUB_UPGRADE_NEW_VERSION;
if (pkgPath && newVersion) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\\n');
}

const rewritePath = process.env.STUB_UPGRADE_SCRIPT_PATH;
const marker = process.env.STUB_RESPAWN_MARKER;
if (rewritePath && marker) {
  writeFileSync(rewritePath, "#!/usr/bin/env node\\nimport { writeFileSync } from 'node:fs';\\nwriteFileSync(process.env.STUB_RESPAWN_MARKER, JSON.stringify(process.argv.slice(2)));\\nprocess.stdout.write('fresh cli ran\\\\n');\\n");
}

process.stdout.write('upgrade stub ok\\n');
`;
}

function createInstallStubScript() {
  return `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const logFile = process.env.STUB_INSTALL_LOG_FILE;
if (logFile) {
  appendFileSync(logFile, JSON.stringify({
    argv: process.argv.slice(2),
    env_home: process.env.HOME,
  }) + '\\n');
}

if (process.env.STUB_INSTALL_EXIT && process.env.STUB_INSTALL_EXIT !== '0') {
  process.stderr.write(process.env.STUB_INSTALL_ERR || 'installer failed\\n');
  process.exit(Number(process.env.STUB_INSTALL_EXIT));
}

const target = process.env.STUB_INSTALL_TARGET_ROOT;
const source = process.env.STUB_INSTALL_SOURCE_PATH;
const version = process.env.STUB_INSTALL_VERSION;
if (target && source && version) {
  mkdirSync(join(target, 'scripts'), { recursive: true });
  cpSync(source, join(target, 'scripts', 'npm-install.mjs'));
  writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'native-gravity', version }, null, 2) + '\\n');
  const handoff = spawnSync(process.execPath, [join(target, 'scripts', 'npm-install.mjs')], { stdio: 'inherit', env: process.env });
  process.exit(handoff.status ?? 1);
}

process.stdout.write('installer stub ok\\n');
`;
}

function createWrongInstallStubScript() {
  return `#!/usr/bin/env node
process.stderr.write('wrong installer path selected\\n');
process.exit(9);
`;
}

function createHarness() {
  const tempDir = mkdtempSync(join(tmpdir(), 'ntg-npm-update-test-'));
  const tempHome = join(tempDir, 'home');
  const tempLocalAppData = join(tempDir, 'localappdata');
  const binDir = join(tempDir, 'bin');
  mkdirSync(tempHome, { recursive: true });
  mkdirSync(tempLocalAppData, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const agyPath = join(binDir, 'agy');
  writeFileSync(agyPath, createStubAgyScript(), 'utf8');
  chmodSync(agyPath, 0o755);

  const upgradeStubPath = join(tempDir, 'upgrade-stub.mjs');
  writeFileSync(upgradeStubPath, createUpgradeStubScript(), 'utf8');

  const installStubPath = join(tempDir, 'install-stub.mjs');
  writeFileSync(installStubPath, createInstallStubScript(), 'utf8');

  const wrongInstallStubPath = join(tempDir, 'wrong-install-stub.mjs');
  writeFileSync(wrongInstallStubPath, createWrongInstallStubScript(), 'utf8');

  const agyLog = join(tempDir, 'agy-invocations.jsonl');
  const upgradeLog = join(tempDir, 'upgrade-invocations.jsonl');
  const installLog = join(tempDir, 'install-invocations.jsonl');

  function createFakeInstall({ manager = 'npm', packageName = 'native-gravity', version = OLD_VERSION, alias = false } = {}) {
    let root;
    if (manager === 'bun') {
      root = join(tempHome, '.bun', 'install', 'global', 'node_modules', packageName);
    } else if (manager === 'npm') {
      root = join(tempHome, '.npm-global', 'lib', 'node_modules', packageName);
    } else if (manager === 'sh') {
      root = join(tempHome, '.local', 'share', 'native-gravity', `v${version}`);
    } else if (manager === 'ps1') {
      root = join(tempLocalAppData, 'native-gravity', `v${version}`);
    } else {
      throw new Error(`unknown manager: ${manager}`);
    }
    const scriptPath = join(root, 'scripts', 'npm-install.mjs');
    mkdirSync(dirname(scriptPath), { recursive: true });
    writeFileSync(scriptPath, INSTALLER_SOURCE, 'utf8');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: packageName, version }, null, 2) + '\n');
    if (alias) {
      const aliasRoot = join(join(tempHome, '.npm-global', 'lib', 'node_modules'), '@sleeg', 'ntg');
      mkdirSync(aliasRoot, { recursive: true });
      writeFileSync(join(aliasRoot, 'package.json'), JSON.stringify({ name: '@sleeg/ntg', version: '1.1.1' }, null, 2) + '\n');
    }
    return { root, scriptPath, pkgPath: join(root, 'package.json') };
  }

  function runUpdate(install, extraArgs = [], extraEnv = {}) {
    const env = { ...process.env };
    if (!('XDG_DATA_HOME' in extraEnv)) delete env.XDG_DATA_HOME;
    if (!('LOCALAPPDATA' in extraEnv)) delete env.LOCALAPPDATA;
    if (!('BUN_INSTALL' in extraEnv)) delete env.BUN_INSTALL;
    if (!('NTG_LATEST_VERSION' in extraEnv)) delete env.NTG_LATEST_VERSION;
    if (!('NTG_REGISTRY_LOOKUP_CMD' in extraEnv)) delete env.NTG_REGISTRY_LOOKUP_CMD;
    Object.assign(env, {
      HOME: tempHome,
      PATH: `${binDir}:${process.env.PATH}`,
      STUB_AGY_LOG_FILE: agyLog,
      STUB_UPGRADE_LOG_FILE: upgradeLog,
      STUB_INSTALL_LOG_FILE: installLog,
      NTG_SELF_UPDATE_CMD: `${process.execPath} ${upgradeStubPath}`,
      NTG_INSTALL_SH_CMD: `${process.execPath} ${installStubPath}`,
      NTG_INSTALL_PS1_CMD: `${process.execPath} ${installStubPath}`,
      ...extraEnv,
    });
    delete env.NTG_RUNNER_CHAIN;
    delete env.NTG_SUPERVISOR_LEDGER;
    delete env.NTG_SUPERVISOR_PID;

    return spawnSync(process.execPath, [install.scriptPath, 'update', ...extraArgs], {
      cwd: install.root,
      env,
      encoding: 'utf8',
    });
  }

  function readLog(file) {
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }

  function cleanup() {
    rmSync(tempDir, { recursive: true, force: true });
  }

  return {
    tempHome,
    tempLocalAppData,
    upgradeStubPath,
    installStubPath,
    wrongInstallStubPath,
    agyLog,
    upgradeLog,
    installLog,
    createFakeInstall,
    runUpdate,
    readAgyCalls: () => readLog(agyLog),
    readUpgradeCalls: () => readLog(upgradeLog),
    readInstallCalls: () => readLog(installLog),
    cleanup,
  };
}

test('update via bun global install runs bun add -g and prints old -> new version', () => {
  const h = createHarness();
  try {
    const install = h.createFakeInstall({ manager: 'bun', version: OLD_VERSION });
    const res = h.runUpdate(install, [], {
      STUB_UPGRADE_PACKAGE_JSON: install.pkgPath,
      STUB_UPGRADE_NEW_VERSION: NEW_VERSION,
    });
    assert.equal(res.status, 0, `failed with stderr: ${res.stderr}`);

    const upgrades = h.readUpgradeCalls();
    assert.equal(upgrades.length, 1);
    assert.deepEqual(upgrades[0].argv, ['add', '-g', 'native-gravity@latest']);
    assert.equal(upgrades[0].env_home, h.tempHome);

    assert.match(res.stdout, /Upgrading native-gravity with bun: .* add -g native-gravity@latest/);
    assert.match(
      res.stdout,
      new RegExp(`Updated native-gravity ${escapeRegExp(OLD_VERSION)} -> ${escapeRegExp(NEW_VERSION)}`)
    );

    const calls = h.readAgyCalls();
    assert.deepEqual(calls.map((call) => call.argv), [
      ['--version'],
      ['plugin', 'uninstall', 'native-gravity'],
      ['plugin', 'install', install.root],
      ['plugin', 'list', '--json'],
    ]);
  } finally {
    h.cleanup();
  }
});

test('update via npm global install runs npm install -g and prints old -> new version', () => {
  const h = createHarness();
  try {
    const install = h.createFakeInstall({ manager: 'npm', version: OLD_VERSION });
    const res = h.runUpdate(install, [], {
      STUB_UPGRADE_PACKAGE_JSON: install.pkgPath,
      STUB_UPGRADE_NEW_VERSION: NEW_VERSION,
    });
    assert.equal(res.status, 0, `failed with stderr: ${res.stderr}`);

    const upgrades = h.readUpgradeCalls();
    assert.equal(upgrades.length, 1);
    assert.deepEqual(upgrades[0].argv, ['install', '-g', 'native-gravity@latest']);
    assert.match(res.stdout, /Upgrading native-gravity with npm: .* install -g native-gravity@latest/);
    assert.match(
      res.stdout,
      new RegExp(`Updated native-gravity ${escapeRegExp(OLD_VERSION)} -> ${escapeRegExp(NEW_VERSION)}`)
    );

    const calls = h.readAgyCalls();
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[1].argv, ['plugin', 'uninstall', 'native-gravity']);
    assert.deepEqual(calls[2].argv, ['plugin', 'install', install.root]);
  } finally {
    h.cleanup();
  }
});

test('update prefers @sleeg/ntg when the alias owns the global install', () => {
  const h = createHarness();
  try {
    const install = h.createFakeInstall({ manager: 'npm', alias: true });
    const res = h.runUpdate(install);
    assert.equal(res.status, 0, `failed with stderr: ${res.stderr}`);

    const upgrades = h.readUpgradeCalls();
    assert.equal(upgrades.length, 1);
    assert.deepEqual(upgrades[0].argv, ['install', '-g', '@sleeg/ntg@latest']);
  } finally {
    h.cleanup();
  }
});

test('update stops before touching the plugin when the package upgrade fails', () => {
  const h = createHarness();
  try {
    const install = h.createFakeInstall({ manager: 'npm' });
    const res = h.runUpdate(install, [], {
      STUB_UPGRADE_EXIT: '7',
      STUB_UPGRADE_ERR: 'registry unavailable',
    });
    assert.equal(res.status, 7);
    assert.match(res.stderr, /registry unavailable/);
    assert.match(res.stderr, /Self-update failed: '.*' exited with code 7/);
    assert.equal(h.readUpgradeCalls().length, 1);
    assert.deepEqual(h.readAgyCalls(), []);
  } finally {
    h.cleanup();
  }
});

test('update --no-self-update skips the package upgrade and reinstalls in place', () => {
  const h = createHarness();
  try {
    const install = h.createFakeInstall({ manager: 'bun' });
    const res = h.runUpdate(install, ['--no-self-update']);
    assert.equal(res.status, 0, `failed with stderr: ${res.stderr}`);
    assert.deepEqual(h.readUpgradeCalls(), []);
    assert.equal(h.readAgyCalls().length, 4);
  } finally {
    h.cleanup();
  }
});

test('update re-spawns the freshly installed CLI with reinstall instead of old in-memory code', () => {
  const h = createHarness();
  try {
    const install = h.createFakeInstall({ manager: 'npm' });
    const marker = join(h.tempHome, 'respawn-marker.json');
    const res = h.runUpdate(install, [], {
      STUB_UPGRADE_SCRIPT_PATH: install.scriptPath,
      STUB_RESPAWN_MARKER: marker,
    });
    assert.equal(res.status, 0, `failed with stderr: ${res.stderr}`);
    assert.match(res.stdout, /fresh cli ran/);
    assert.ok(existsSync(marker), 'freshly installed CLI must be executed');
    assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), ['reinstall']);
    assert.deepEqual(h.readAgyCalls(), []);
  } finally {
    h.cleanup();
  }
});

test('update via curl install re-runs the sh installer and reinstalls from the new version', () => {
  const h = createHarness();
  try {
    const install = h.createFakeInstall({ manager: 'sh', version: OLD_VERSION });
    const newRoot = join(h.tempHome, '.local', 'share', 'native-gravity', `v${NEW_VERSION}`);
    const res = h.runUpdate(install, [], {
      NTG_INSTALL_SH_CMD: `${process.execPath} ${h.installStubPath}`,
      NTG_INSTALL_PS1_CMD: `${process.execPath} ${h.wrongInstallStubPath}`,
      STUB_INSTALL_TARGET_ROOT: newRoot,
      STUB_INSTALL_SOURCE_PATH: INSTALLER_SCRIPT,
      STUB_INSTALL_VERSION: NEW_VERSION,
    });
    assert.equal(res.status, 0, `failed with stderr: ${res.stderr}`);
    assert.doesNotMatch(res.stderr, /wrong installer path selected/);
    assert.equal(h.readInstallCalls().length, 1);
    assert.match(res.stdout, /Upgrading native-gravity with curl installer: curl -fsSL \S+install\.sh \| sh/);
    assert.match(
      res.stdout,
      new RegExp(`Updated native-gravity ${escapeRegExp(OLD_VERSION)} -> ${escapeRegExp(NEW_VERSION)}`)
    );

    const calls = h.readAgyCalls();
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[1].argv, ['plugin', 'uninstall', 'native-gravity']);
    assert.deepEqual(calls[2].argv, ['plugin', 'install', newRoot]);
  } finally {
    h.cleanup();
  }
});

test('update via irm install selects the PowerShell one-liner', () => {
  const h = createHarness();
  try {
    const install = h.createFakeInstall({ manager: 'ps1', version: OLD_VERSION });
    const newRoot = join(h.tempLocalAppData, 'native-gravity', `v${NEW_VERSION}`);
    const res = h.runUpdate(install, [], {
      LOCALAPPDATA: h.tempLocalAppData,
      NTG_INSTALL_SH_CMD: `${process.execPath} ${h.wrongInstallStubPath}`,
      NTG_INSTALL_PS1_CMD: `${process.execPath} ${h.installStubPath}`,
      STUB_INSTALL_TARGET_ROOT: newRoot,
      STUB_INSTALL_SOURCE_PATH: INSTALLER_SCRIPT,
      STUB_INSTALL_VERSION: NEW_VERSION,
    });
    assert.equal(res.status, 0, `failed with stderr: ${res.stderr}`);
    assert.doesNotMatch(res.stderr, /wrong installer path selected/);
    assert.equal(h.readInstallCalls().length, 1);
    assert.match(res.stdout, /Upgrading native-gravity with PowerShell installer: irm \S+install\.ps1 \| iex/);
    assert.match(
      res.stdout,
      new RegExp(`Updated native-gravity ${escapeRegExp(OLD_VERSION)} -> ${escapeRegExp(NEW_VERSION)}`)
    );

    const calls = h.readAgyCalls();
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[2].argv, ['plugin', 'install', newRoot]);
  } finally {
    h.cleanup();
  }
});

for (const manager of ['sh', 'ps1']) {
  test(`update via ${manager} install installs the plugin exactly once through the installer handoff`, () => {
    const h = createHarness();
    try {
      const install = h.createFakeInstall({ manager, version: OLD_VERSION });
      const newRoot = manager === 'ps1'
        ? join(h.tempLocalAppData, 'native-gravity', `v${NEW_VERSION}`)
        : join(h.tempHome, '.local', 'share', 'native-gravity', `v${NEW_VERSION}`);
      const res = h.runUpdate(install, [], {
        ...(manager === 'ps1' ? { LOCALAPPDATA: h.tempLocalAppData } : {}),
        STUB_INSTALL_TARGET_ROOT: newRoot,
        STUB_INSTALL_SOURCE_PATH: INSTALLER_SCRIPT,
        STUB_INSTALL_VERSION: NEW_VERSION,
      });
      assert.equal(res.status, 0, `failed with stderr: ${res.stderr}`);
      assert.equal(h.readInstallCalls().length, 1);

      const pluginInstalls = h.readAgyCalls()
        .map((call) => call.argv)
        .filter((argv) => argv[0] === 'plugin' && argv[1] === 'install');
      assert.deepEqual(pluginInstalls, [['plugin', 'install', newRoot]]);
    } finally {
      h.cleanup();
    }
  });
}

for (const manager of ['sh', 'ps1']) {
  test(`update via ${manager} install stops before reinstall when the installer fails`, () => {
    const h = createHarness();
    try {
      const install = h.createFakeInstall({ manager, version: OLD_VERSION });
      const res = h.runUpdate(install, [], {
        ...(manager === 'ps1' ? { LOCALAPPDATA: h.tempLocalAppData } : {}),
        STUB_INSTALL_EXIT: '7',
        STUB_INSTALL_ERR: 'installer unavailable',
      });
      assert.equal(res.status, 7);
      assert.match(res.stderr, /installer unavailable/);
      assert.match(res.stderr, /Self-update failed: '.*' exited with code 7/);
      assert.equal(h.readInstallCalls().length, 1);
      assert.deepEqual(h.readAgyCalls(), []);
    } finally {
      h.cleanup();
    }
  });
}

test('win32 npm self-update spawns npm.cmd so the npm shim can execute', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-win32-self-update-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'native-gravity', version: '1.0.0' }) + '\n');
    const scriptPath = join(dir, 'scripts', 'npm-install.mjs');
    const spawned = [];
    let stdout = '';
    const result = runSelfUpdate({
      scriptPath,
      packageRoot: dir,
      env: {},
      home: dir,
      platform: 'win32',
      spawnSync: (cmd, args, options) => {
        spawned.push({ cmd, args, shell: options.shell });
        return { status: 0 };
      },
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
    });

    assert.equal(result.ok, true);
    // shell: true is required: Node >= 18.20 / 20.12 refuses to spawn .cmd without it (EINVAL).
    assert.deepEqual(spawned, [{ cmd: 'npm.cmd', args: ['install', '-g', 'native-gravity@latest'], shell: true }]);
    assert.match(stdout, /Upgrading native-gravity with npm: npm\.cmd install -g native-gravity@latest/);

    assert.equal(buildSelfUpdateCommand('npm', 'native-gravity', {}, 'linux').cmd, 'npm');
    assert.equal(buildSelfUpdateCommand('npm', 'native-gravity', {}, 'linux').shell, undefined);
    assert.equal(buildSelfUpdateCommand('bun', 'native-gravity', {}, 'win32').cmd, 'bun');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeJsonFile(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

test('isLocalPackageSpecifier distinguishes local tarballs/paths from registry specifiers', () => {
  const localSpecs = [
    'native-gravity-2.1.0.tgz',
    'native-gravity-2.1.0.tgz?cache=1#sha',
    'dist/native-gravity-2.1.0.tar.gz',
    'native-gravity-2.1.0.TAR.GZ#hash',
    'file:../native-gravity',
    'file:/tmp/native-gravity',
    'link:../native-gravity',
    'portal:./native-gravity',
    './native-gravity',
    '../native-gravity',
    '/tmp/native-gravity-2.1.0.tgz',
    '~/work/native-gravity',
    '.\\native-gravity',
    '..\\native-gravity',
    'C:\\work\\native-gravity',
    'D:/work/native-gravity',
  ];
  for (const spec of localSpecs) {
    assert.equal(isLocalPackageSpecifier(spec), true, `expected local specifier to be detected: ${spec}`);
  }

  const registrySpecs = [
    '^2.1.0',
    '~2.1.0',
    '2.1.1',
    '2.1.1-rc.1',
    'latest',
    '*',
    '>=2.0.0 <3.0.0',
    'npm:native-gravity@^2.1.0',
    'https://registry.npmjs.org/native-gravity/-/native-gravity-2.1.0.tgz',
    '',
    '   ',
    null,
    undefined,
  ];
  for (const spec of registrySpecs) {
    assert.equal(isLocalPackageSpecifier(spec), false, `expected registry/non-local specifier not to trigger: ${String(spec)}`);
  }
});

test('bunGlobalManifestPaths deduplicates default ~/.bun and BUN_INSTALL paths', () => {
  const home = '/tmp/ntg-home-example';
  const defaultPath = resolve(join(home, '.bun'), 'install', 'global', 'package.json');
  assert.deepEqual(bunGlobalManifestPaths({ env: {}, home }), [defaultPath]);
  assert.deepEqual(
    bunGlobalManifestPaths({ env: { BUN_INSTALL: join(home, '.bun') }, home }),
    [defaultPath]
  );
  const customBun = '/tmp/custom-bun-install';
  assert.deepEqual(
    bunGlobalManifestPaths({ env: { BUN_INSTALL: customBun }, home }),
    [defaultPath, resolve(customBun, 'install', 'global', 'package.json')]
  );
});

test('bun update fails before upgrade when ~/.bun global manifest has duplicate native-gravity and @sleeg/ntg', () => {
  const h = createHarness();
  try {
    const install = h.createFakeInstall({ manager: 'bun', version: OLD_VERSION });
    const manifestPath = join(h.tempHome, '.bun', 'install', 'global', 'package.json');
    writeJsonFile(manifestPath, {
      dependencies: {
        'native-gravity': '^2.1.0',
      },
      optionalDependencies: {
        '@sleeg/ntg': '^2.1.0',
      },
    });

    const res = h.runUpdate(install, [], {
      STUB_UPGRADE_PACKAGE_JSON: install.pkgPath,
      STUB_UPGRADE_NEW_VERSION: NEW_VERSION,
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, new RegExp(escapeRegExp(manifestPath)));
    assert.match(res.stderr, /Duplicate packages/i);
    assert.match(res.stderr, /native-gravity/);
    assert.match(res.stderr, /@sleeg\/ntg/);
    assert.match(res.stderr, /bun remove -g native-gravity @sleeg\/ntg/);
    assert.match(res.stderr, /bun add -g native-gravity@latest/);
    assert.match(res.stderr, /ntg reinstall/);
    assert.deepEqual(h.readUpgradeCalls(), []);
    assert.deepEqual(h.readAgyCalls(), []);
  } finally {
    h.cleanup();
  }
});

test('bun update fails before upgrade when $BUN_INSTALL global manifest has duplicate packages', () => {
  const h = createHarness();
  try {
    const customBunInstall = join(h.tempHome, 'custom-bun');
    const root = join(customBunInstall, 'install', 'global', 'node_modules', 'native-gravity');
    const scriptPath = join(root, 'scripts', 'npm-install.mjs');
    mkdirSync(dirname(scriptPath), { recursive: true });
    writeFileSync(scriptPath, INSTALLER_SOURCE, 'utf8');
    writeJsonFile(join(root, 'package.json'), { name: 'native-gravity', version: OLD_VERSION });

    const manifestPath = join(customBunInstall, 'install', 'global', 'package.json');
    writeJsonFile(manifestPath, {
      devDependencies: {
        'native-gravity': '2.1.0',
      },
      peerDependencies: {
        '@sleeg/ntg': 'latest',
      },
    });

    const res = h.runUpdate({ root, scriptPath, pkgPath: join(root, 'package.json') }, [], {
      BUN_INSTALL: customBunInstall,
      STUB_UPGRADE_PACKAGE_JSON: join(root, 'package.json'),
      STUB_UPGRADE_NEW_VERSION: NEW_VERSION,
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, new RegExp(escapeRegExp(manifestPath)));
    assert.match(res.stderr, /Duplicate packages/i);
    assert.match(res.stderr, /bun remove -g native-gravity @sleeg\/ntg/);
    assert.match(res.stderr, /bun add -g native-gravity@latest/);
    assert.match(res.stderr, /ntg reinstall/);
    assert.deepEqual(h.readUpgradeCalls(), []);
    assert.deepEqual(h.readAgyCalls(), []);
  } finally {
    h.cleanup();
  }
});

for (const specifier of [
  './native-gravity-2.1.0.tgz',
  'native-gravity-2.1.0.tar.gz?v=1#hash',
  'file:/tmp/native-gravity',
  'link:../native-gravity',
  '../native-gravity',
  '/tmp/native-gravity',
]) {
  test(`bun update fails before upgrade when global manifest uses local specifier ${specifier}`, () => {
    const h = createHarness();
    try {
      const install = h.createFakeInstall({ manager: 'bun', version: OLD_VERSION });
      const manifestPath = join(h.tempHome, '.bun', 'install', 'global', 'package.json');
      writeJsonFile(manifestPath, {
        dependencies: {
          'native-gravity': specifier,
        },
      });

      const res = h.runUpdate(install, [], {
        STUB_UPGRADE_PACKAGE_JSON: install.pkgPath,
        STUB_UPGRADE_NEW_VERSION: NEW_VERSION,
      });
      assert.equal(res.status, 1);
      assert.match(res.stderr, new RegExp(escapeRegExp(manifestPath)));
      assert.match(res.stderr, new RegExp(escapeRegExp(specifier)));
      assert.match(res.stderr, /bun remove -g native-gravity/);
      assert.match(res.stderr, /bun add -g native-gravity@latest/);
      assert.match(res.stderr, /ntg reinstall/);
      assert.deepEqual(h.readUpgradeCalls(), []);
      assert.deepEqual(h.readAgyCalls(), []);
    } finally {
      h.cleanup();
    }
  });
}

test('bun symlink-escaped file:/ install (outside node_modules) still detects Bun global conflict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-bun-symlink-escape-'));
  try {
    const fakeHome = join(dir, 'home');
    const localRepo = join(dir, 'local-checkout');
    mkdirSync(join(localRepo, 'scripts'), { recursive: true });
    writeJsonFile(join(localRepo, 'package.json'), { name: 'native-gravity', version: OLD_VERSION });
    const manifestPath = join(fakeHome, '.bun', 'install', 'global', 'package.json');
    writeJsonFile(manifestPath, {
      dependencies: {
        'native-gravity': `file:${localRepo}`,
      },
    });

    const spawned = [];
    let stderr = '';
    const result = runSelfUpdate({
      scriptPath: join(localRepo, 'scripts', 'npm-install.mjs'),
      packageRoot: localRepo,
      env: {},
      home: fakeHome,
      platform: 'linux',
      spawnSync: (...args) => {
        spawned.push(args);
        return { status: 0 };
      },
      stdout: { write: () => {} },
      stderr: { write: (text) => { stderr += text; } },
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 1);
    assert.equal(result.reason, 'bun-global-conflict');
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].type, 'local-specifier');
    assert.deepEqual(spawned, []);
    assert.match(stderr, new RegExp(escapeRegExp(manifestPath)));
    assert.match(stderr, /bun remove -g native-gravity/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bun update allows normal registry specifiers and clean single @sleeg/ntg alias install', () => {
  const h = createHarness();
  try {
    const manifestPath = join(h.tempHome, '.bun', 'install', 'global', 'package.json');
    writeJsonFile(manifestPath, {
      dependencies: {
        '@sleeg/ntg': '^2.1.0',
      },
    });
    assert.deepEqual(detectBunGlobalConflicts({ env: {}, home: h.tempHome }), []);

    const install = h.createFakeInstall({ manager: 'bun', packageName: '@sleeg/ntg', version: OLD_VERSION });
    const res = h.runUpdate(install, [], {
      STUB_UPGRADE_PACKAGE_JSON: install.pkgPath,
      STUB_UPGRADE_NEW_VERSION: NEW_VERSION,
      NTG_LATEST_VERSION: NEW_VERSION,
    });
    assert.equal(res.status, 0, `expected clean single @sleeg/ntg update to succeed; stderr=${res.stderr}`);
    assert.equal(h.readUpgradeCalls().length, 1);
    assert.deepEqual(h.readUpgradeCalls()[0].argv, ['add', '-g', '@sleeg/ntg@latest']);
  } finally {
    h.cleanup();
  }
});

test('bun global combined duplicate and local tarball conflict reports both and prints recovery guidance', () => {
  const h = createHarness();
  try {
    const install = h.createFakeInstall({ manager: 'bun', version: OLD_VERSION });
    const manifestPath = join(h.tempHome, '.bun', 'install', 'global', 'package.json');
    writeJsonFile(manifestPath, {
      dependencies: {
        'native-gravity': './native-gravity-2.1.0.tgz',
        '@sleeg/ntg': 'latest',
      },
    });

    const conflicts = detectBunGlobalConflicts({ env: {}, home: h.tempHome });
    assert.equal(conflicts.length, 2);
    assert.ok(conflicts.some((c) => c.type === 'duplicate-packages'));
    assert.ok(conflicts.some((c) => c.type === 'local-specifier' && c.packageName === 'native-gravity'));

    const res = h.runUpdate(install, [], {
      STUB_UPGRADE_PACKAGE_JSON: install.pkgPath,
      STUB_UPGRADE_NEW_VERSION: NEW_VERSION,
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Duplicate packages/i);
    assert.match(res.stderr, /Local tarball\/path specifier/i);
    assert.match(res.stderr, /\.\/native-gravity-2\.1\.0\.tgz/);
    assert.match(res.stderr, /bun remove -g native-gravity @sleeg\/ntg/);
    assert.match(res.stderr, /bun add -g native-gravity@latest/);
    assert.match(res.stderr, /ntg reinstall/);
    assert.deepEqual(h.readUpgradeCalls(), []);
    assert.deepEqual(h.readAgyCalls(), []);
  } finally {
    h.cleanup();
  }
});

for (const manager of ['bun', 'npm', 'sh']) {
  test(`update fails with version-mismatch and tailored recovery guidance for ${manager} when installed version lags registry latest`, () => {
    const h = createHarness();
    try {
      const install = h.createFakeInstall({ manager, version: OLD_VERSION });
      const res = h.runUpdate(install, [], {
        NTG_LATEST_VERSION: NEW_VERSION,
      });
      assert.equal(res.status, 1);
      assert.match(res.stderr, /Update verification failed for native-gravity/);
      assert.match(res.stderr, new RegExp(`expected latest version ${escapeRegExp(NEW_VERSION)}`));
      assert.match(res.stderr, new RegExp(`installed version is ${escapeRegExp(OLD_VERSION)}`));
      assert.match(res.stderr, /ntg reinstall/);
      if (manager === 'bun') {
        assert.match(res.stderr, /bun remove -g native-gravity/);
        assert.match(res.stderr, /bun add -g native-gravity@latest/);
      } else if (manager === 'npm') {
        assert.match(res.stderr, /npm uninstall -g native-gravity/);
        assert.match(res.stderr, /npm install -g native-gravity@latest/);
      } else {
        assert.match(res.stderr, /curl -fsSL \S+install\.sh \| sh/);
      }
      assert.deepEqual(h.readAgyCalls(), []);
    } finally {
      h.cleanup();
    }
  });
}

test('runSelfUpdate unit test catches version mismatch via injected options.resolveLatestVersion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-self-update-mismatch-'));
  try {
    const pkgRoot = join(dir, 'node_modules', 'native-gravity');
    mkdirSync(join(pkgRoot, 'scripts'), { recursive: true });
    writeJsonFile(join(pkgRoot, 'package.json'), { name: 'native-gravity', version: '2.1.0' });
    const scriptPath = join(pkgRoot, 'scripts', 'npm-install.mjs');
    writeFileSync(scriptPath, '// stub\n', 'utf8');

    let stderr = '';
    let stdout = '';
    const result = runSelfUpdate({
      scriptPath,
      packageRoot: pkgRoot,
      env: {},
      home: dir,
      platform: 'linux',
      spawnSync: () => ({ status: 0 }),
      resolveLatestVersion: () => ({ version: 'v2.2.0', source: 'injected-test' }),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: (text) => { stderr += text; } },
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 1);
    assert.equal(result.reason, 'version-mismatch');
    assert.equal(result.packageName, 'native-gravity');
    assert.equal(result.oldVersion, '2.1.0');
    assert.equal(result.newVersion, '2.1.0');
    assert.equal(result.expectedVersion, '2.2.0');
    assert.doesNotMatch(stdout, /Updated native-gravity/);
    assert.match(stderr, /expected latest version 2\.2\.0, but installed version is 2\.1\.0 \(previous: 2\.1\.0\)/);
    assert.match(stderr, /npm uninstall -g native-gravity/);
    assert.match(stderr, /npm install -g native-gravity@latest/);
    assert.match(stderr, /ntg reinstall/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('update succeeds cleanly when registry latest matches installed version via NTG_LATEST_VERSION and resolveLatestVersion', () => {
  const h = createHarness();
  try {
    const install = h.createFakeInstall({ manager: 'npm', version: OLD_VERSION });
    const res = h.runUpdate(install, [], {
      STUB_UPGRADE_PACKAGE_JSON: install.pkgPath,
      STUB_UPGRADE_NEW_VERSION: NEW_VERSION,
      NTG_LATEST_VERSION: `v${NEW_VERSION}`,
    });
    assert.equal(res.status, 0, `expected matching update to succeed; stderr=${res.stderr}`);
    assert.match(
      res.stdout,
      new RegExp(`Updated native-gravity ${escapeRegExp(OLD_VERSION)} -> ${escapeRegExp(NEW_VERSION)}`)
    );
    assert.equal(h.readAgyCalls().length, 4);
  } finally {
    h.cleanup();
  }

  const dir = mkdtempSync(join(tmpdir(), 'ntg-self-update-match-'));
  try {
    const pkgRoot = join(dir, 'node_modules', 'native-gravity');
    mkdirSync(join(pkgRoot, 'scripts'), { recursive: true });
    writeJsonFile(join(pkgRoot, 'package.json'), { name: 'native-gravity', version: '2.1.0' });
    const scriptPath = join(pkgRoot, 'scripts', 'npm-install.mjs');
    writeFileSync(scriptPath, '// stub\n', 'utf8');

    let stdout = '';
    const result = runSelfUpdate({
      scriptPath,
      packageRoot: pkgRoot,
      env: {},
      home: dir,
      platform: 'linux',
      spawnSync: () => {
        writeJsonFile(join(pkgRoot, 'package.json'), { name: 'native-gravity', version: '2.2.0' });
        return { status: 0 };
      },
      resolveLatestVersion: () => '2.2.0',
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 0);
    assert.equal(result.oldVersion, '2.1.0');
    assert.equal(result.newVersion, '2.2.0');
    assert.equal(result.expectedVersion, '2.2.0');
    assert.match(stdout, /Updated native-gravity 2\.1\.0 -> 2\.2\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('offline/unavailable registry lookup fallback succeeds without crashing and warns on lookup errors', () => {
  const h = createHarness();
  try {
    for (const envValue of ['', 'offline', 'unavailable']) {
      const install = h.createFakeInstall({ manager: 'npm', version: OLD_VERSION });
      const res = h.runUpdate(install, [], {
        STUB_UPGRADE_PACKAGE_JSON: install.pkgPath,
        STUB_UPGRADE_NEW_VERSION: NEW_VERSION,
        NTG_LATEST_VERSION: envValue,
      });
      assert.equal(res.status, 0, `expected NTG_LATEST_VERSION=${JSON.stringify(envValue)} to succeed; stderr=${res.stderr}`);
      assert.match(
        res.stdout,
        new RegExp(`Updated native-gravity ${escapeRegExp(OLD_VERSION)} -> ${escapeRegExp(NEW_VERSION)}`)
      );
    }

    const failingLookupScript = join(h.tempHome, 'failing-lookup.mjs');
    writeFileSync(failingLookupScript, "process.stderr.write('registry unreachable\\n'); process.exit(2);\n", 'utf8');
    const installFailCmd = h.createFakeInstall({ manager: 'npm', version: OLD_VERSION });
    const failCmdRes = h.runUpdate(installFailCmd, [], {
      STUB_UPGRADE_PACKAGE_JSON: installFailCmd.pkgPath,
      STUB_UPGRADE_NEW_VERSION: NEW_VERSION,
      NTG_REGISTRY_LOOKUP_CMD: `${process.execPath} ${failingLookupScript}`,
    });
    assert.equal(failCmdRes.status, 0, `failing lookup cmd must be non-fatal; stderr=${failCmdRes.stderr}`);
    assert.match(failCmdRes.stderr, /Warning: could not verify latest registry version for native-gravity/);
    assert.match(failCmdRes.stderr, /registry unreachable/);
    assert.match(
      failCmdRes.stdout,
      new RegExp(`Updated native-gravity ${escapeRegExp(OLD_VERSION)} -> ${escapeRegExp(NEW_VERSION)}`)
    );

    const badOutputLookupScript = join(h.tempHome, 'bad-output-lookup.mjs');
    writeFileSync(badOutputLookupScript, "process.stdout.write('not a semver token\\n');\n", 'utf8');
    const badOut = resolveRegistryLatestVersion('native-gravity', {
      env: { NTG_REGISTRY_LOOKUP_CMD: `${process.execPath} ${badOutputLookupScript}` },
    });
    assert.equal(badOut.available, false);
    assert.equal(badOut.version, null);
    assert.equal(badOut.source, 'env-cmd');
    assert.match(badOut.error, /Invalid version output/);
  } finally {
    h.cleanup();
  }

  const dir = mkdtempSync(join(tmpdir(), 'ntg-self-update-null-resolver-'));
  try {
    const pkgRoot = join(dir, 'node_modules', 'native-gravity');
    mkdirSync(join(pkgRoot, 'scripts'), { recursive: true });
    writeJsonFile(join(pkgRoot, 'package.json'), { name: 'native-gravity', version: '2.1.0' });
    const scriptPath = join(pkgRoot, 'scripts', 'npm-install.mjs');
    writeFileSync(scriptPath, '// stub\n', 'utf8');

    let stderr = '';
    const result = runSelfUpdate({
      scriptPath,
      packageRoot: pkgRoot,
      env: {},
      home: dir,
      platform: 'linux',
      spawnSync: () => {
        writeJsonFile(join(pkgRoot, 'package.json'), { name: 'native-gravity', version: '2.2.0' });
        return { status: 0 };
      },
      resolveLatestVersion: () => null,
      stdout: { write: () => {} },
      stderr: { write: (text) => { stderr += text; } },
    });
    assert.equal(result.ok, true);
    assert.equal(result.expectedVersion, null);
    assert.equal(stderr, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveRegistryLatestVersion respects priority order and offline/test guards', () => {
  assert.equal(normalizeVersion('v2.1.0'), '2.1.0');
  assert.equal(normalizeVersion('2.1.0-beta.1'), '2.1.0-beta.1');
  assert.equal(normalizeVersion('2.1.0 extra'), null);

  assert.deepEqual(
    resolveRegistryLatestVersion('native-gravity', {
      env: { NTG_LATEST_VERSION: '1.0.0' },
      resolveLatestVersion: () => '2.3.4',
    }),
    { available: true, version: '2.3.4', source: 'injected' }
  );

  assert.deepEqual(
    resolveRegistryLatestVersion('native-gravity', {
      env: { NTG_LATEST_VERSION: '2.3.4', SKIP_LIVE_TESTS: '1' },
    }),
    { available: true, version: '2.3.4', source: 'env' }
  );

  assert.deepEqual(
    resolveRegistryLatestVersion('native-gravity', {
      env: { NTG_LATEST_VERSION: 'offline' },
    }),
    { available: false, version: null, source: 'env', reason: 'unavailable' }
  );

  assert.deepEqual(
    resolveRegistryLatestVersion('native-gravity', {
      env: { SKIP_LIVE_TESTS: '1' },
    }),
    { available: false, version: null, source: 'skipped', reason: 'offline-or-stubbed' }
  );

  assert.deepEqual(
    resolveRegistryLatestVersion('native-gravity', {
      env: {},
      skipRegistryLookup: true,
    }),
    { available: false, version: null, source: 'skipped', reason: 'offline-or-stubbed' }
  );

  const lookupDir = mkdtempSync(join(tmpdir(), 'ntg-registry-lookup-cmd-'));
  try {
    const okLookupScript = join(lookupDir, 'ok-lookup.mjs');
    writeFileSync(okLookupScript, "process.stdout.write('v2.4.0\\n');\n", 'utf8');
    const lookupCmd = `${process.execPath} ${okLookupScript}`;

    // (c) NTG_REGISTRY_LOOKUP_CMD succeeds and overrides (d) SKIP_LIVE_TESTS=1
    assert.deepEqual(
      resolveRegistryLatestVersion('native-gravity', {
        env: { NTG_REGISTRY_LOOKUP_CMD: lookupCmd, SKIP_LIVE_TESTS: '1' },
      }),
      { available: true, version: '2.4.0', source: 'env-cmd' }
    );

    // (b) NTG_LATEST_VERSION takes precedence over (c) NTG_REGISTRY_LOOKUP_CMD
    assert.deepEqual(
      resolveRegistryLatestVersion('native-gravity', {
        env: { NTG_LATEST_VERSION: '2.5.0', NTG_REGISTRY_LOOKUP_CMD: lookupCmd },
      }),
      { available: true, version: '2.5.0', source: 'env' }
    );
  } finally {
    rmSync(lookupDir, { recursive: true, force: true });
  }

  const ps1Guidance = formatUpdateRecoveryGuidance({
    reason: 'version-mismatch',
    packageName: 'native-gravity',
    installMethod: { type: 'script', shell: 'ps1' },
  });
  assert.match(ps1Guidance, /irm \S+install\.ps1 \| iex/);
  assert.match(ps1Guidance, /ntg reinstall/);
});

test('runSelfUpdate queries native-gravity version while upgrading and guiding @sleeg/ntg on alias-wrapper installs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-alias-wrapper-lookup-'));
  try {
    const modulesRoot = join(dir, '.npm-global', 'lib', 'node_modules');
    const pkgRoot = join(modulesRoot, 'native-gravity');
    const aliasRoot = join(modulesRoot, '@sleeg', 'ntg');
    mkdirSync(join(pkgRoot, 'scripts'), { recursive: true });
    mkdirSync(aliasRoot, { recursive: true });
    writeJsonFile(join(pkgRoot, 'package.json'), { name: 'native-gravity', version: '2.1.0' });
    writeJsonFile(join(aliasRoot, 'package.json'), { name: '@sleeg/ntg', version: '1.1.1' });
    const scriptPath = join(pkgRoot, 'scripts', 'npm-install.mjs');
    writeFileSync(scriptPath, '// stub\n', 'utf8');

    const spawned = [];
    const lookedUpPackages = [];
    let stderr = '';
    const mismatchResult = runSelfUpdate({
      scriptPath,
      packageRoot: pkgRoot,
      env: {},
      home: dir,
      platform: 'linux',
      spawnSync: (cmd, args) => {
        spawned.push({ cmd, args });
        return { status: 0 };
      },
      resolveLatestVersion: (lookupPkg) => {
        lookedUpPackages.push(lookupPkg);
        return '2.2.0';
      },
      stdout: { write: () => {} },
      stderr: { write: (text) => { stderr += text; } },
    });

    assert.deepEqual(spawned, [{ cmd: 'npm', args: ['install', '-g', '@sleeg/ntg@latest'] }]);
    assert.deepEqual(lookedUpPackages, ['native-gravity']);
    assert.equal(mismatchResult.ok, false);
    assert.equal(mismatchResult.reason, 'version-mismatch');
    assert.equal(mismatchResult.packageName, '@sleeg/ntg');
    assert.equal(mismatchResult.expectedVersion, '2.2.0');
    assert.match(stderr, /npm uninstall -g @sleeg\/ntg/);
    assert.match(stderr, /npm install -g @sleeg\/ntg@latest/);
    assert.match(stderr, /ntg reinstall/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('update --no-self-update succeeds cleanly even when Bun global manifest has conflicts', () => {
  const h = createHarness();
  try {
    const install = h.createFakeInstall({ manager: 'bun', version: OLD_VERSION });
    const manifestPath = join(h.tempHome, '.bun', 'install', 'global', 'package.json');
    writeJsonFile(manifestPath, {
      dependencies: {
        'native-gravity': './native-gravity-2.1.0.tgz',
        '@sleeg/ntg': '^2.1.0',
      },
    });

    const res = h.runUpdate(install, ['--no-self-update']);
    assert.equal(res.status, 0, `expected --no-self-update to bypass self-update conflict check; stderr=${res.stderr}`);
    assert.deepEqual(h.readUpgradeCalls(), []);
    assert.equal(h.readAgyCalls().length, 4);
  } finally {
    h.cleanup();
  }
});
