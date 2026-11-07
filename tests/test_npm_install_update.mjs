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
import { buildSelfUpdateCommand, runSelfUpdate } from '../scripts/npm-install.mjs';

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
