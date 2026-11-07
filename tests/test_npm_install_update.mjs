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

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const INSTALLER_SCRIPT = join(REPO_ROOT, 'scripts', 'npm-install.mjs');
const INSTALLER_SOURCE = readFileSync(INSTALLER_SCRIPT, 'utf8');

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

function createHarness() {
  const tempDir = mkdtempSync(join(tmpdir(), 'ntg-npm-update-test-'));
  const tempHome = join(tempDir, 'home');
  const binDir = join(tempDir, 'bin');
  mkdirSync(tempHome, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const agyPath = join(binDir, 'agy');
  writeFileSync(agyPath, createStubAgyScript(), 'utf8');
  chmodSync(agyPath, 0o755);

  const upgradeStubPath = join(tempDir, 'upgrade-stub.mjs');
  writeFileSync(upgradeStubPath, createUpgradeStubScript(), 'utf8');

  const agyLog = join(tempDir, 'agy-invocations.jsonl');
  const upgradeLog = join(tempDir, 'upgrade-invocations.jsonl');

  function createFakeInstall({ manager = 'npm', packageName = 'native-gravity', version = '1.1.2', alias = false } = {}) {
    const modulesRoot = manager === 'bun'
      ? join(tempHome, '.bun', 'install', 'global', 'node_modules')
      : join(tempHome, '.npm-global', 'lib', 'node_modules');
    const root = join(modulesRoot, packageName);
    const scriptPath = join(root, 'scripts', 'npm-install.mjs');
    mkdirSync(dirname(scriptPath), { recursive: true });
    writeFileSync(scriptPath, INSTALLER_SOURCE, 'utf8');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: packageName, version }, null, 2) + '\n');
    if (alias) {
      const aliasRoot = join(modulesRoot, '@sleeg', 'ntg');
      mkdirSync(aliasRoot, { recursive: true });
      writeFileSync(join(aliasRoot, 'package.json'), JSON.stringify({ name: '@sleeg/ntg', version: '1.1.1' }, null, 2) + '\n');
    }
    return { root, scriptPath, pkgPath: join(root, 'package.json') };
  }

  function runUpdate(install, extraArgs = [], extraEnv = {}) {
    const env = {
      ...process.env,
      HOME: tempHome,
      PATH: `${binDir}:${process.env.PATH}`,
      STUB_AGY_LOG_FILE: agyLog,
      STUB_UPGRADE_LOG_FILE: upgradeLog,
      NTG_SELF_UPDATE_CMD: `${process.execPath} ${upgradeStubPath}`,
      ...extraEnv,
    };
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
    upgradeStubPath,
    agyLog,
    upgradeLog,
    createFakeInstall,
    runUpdate,
    readAgyCalls: () => readLog(agyLog),
    readUpgradeCalls: () => readLog(upgradeLog),
    cleanup,
  };
}

test('update via bun global install runs bun add -g and prints old -> new version', () => {
  const h = createHarness();
  try {
    const install = h.createFakeInstall({ manager: 'bun', version: '1.1.2' });
    const res = h.runUpdate(install, [], {
      STUB_UPGRADE_PACKAGE_JSON: install.pkgPath,
      STUB_UPGRADE_NEW_VERSION: '1.1.3',
    });
    assert.equal(res.status, 0, `failed with stderr: ${res.stderr}`);

    const upgrades = h.readUpgradeCalls();
    assert.equal(upgrades.length, 1);
    assert.deepEqual(upgrades[0].argv, ['add', '-g', 'native-gravity@latest']);
    assert.equal(upgrades[0].env_home, h.tempHome);

    assert.match(res.stdout, /Upgrading native-gravity with bun: .* add -g native-gravity@latest/);
    assert.match(res.stdout, /Updated native-gravity 1\.1\.2 -> 1\.1\.3/);

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
    const install = h.createFakeInstall({ manager: 'npm', version: '1.1.2' });
    const res = h.runUpdate(install, [], {
      STUB_UPGRADE_PACKAGE_JSON: install.pkgPath,
      STUB_UPGRADE_NEW_VERSION: '2.0.0',
    });
    assert.equal(res.status, 0, `failed with stderr: ${res.stderr}`);

    const upgrades = h.readUpgradeCalls();
    assert.equal(upgrades.length, 1);
    assert.deepEqual(upgrades[0].argv, ['install', '-g', 'native-gravity@latest']);
    assert.match(res.stdout, /Upgrading native-gravity with npm: .* install -g native-gravity@latest/);
    assert.match(res.stdout, /Updated native-gravity 1\.1\.2 -> 2\.0\.0/);

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
