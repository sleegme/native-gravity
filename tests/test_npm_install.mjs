import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const INSTALLER_SCRIPT = join(REPO_ROOT, 'scripts', 'npm-install.mjs');
const LIVE_HOME = homedir();
const LIVE_GEMINI = join(LIVE_HOME, '.gemini');

function createStubAgyScript() {
  return `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import process from 'node:process';

const logFile = process.env.STUB_AGY_LOG_FILE;
if (logFile) {
  appendFileSync(logFile, JSON.stringify({
    argv: process.argv.slice(2),
    env_home: process.env.HOME,
    timestamp: Date.now(),
  }) + '\\n');
}

const args = process.argv.slice(2);
const first = args[0];

if (first === '--version') {
  if (process.env.STUB_AGY_VERSION_EXIT && process.env.STUB_AGY_VERSION_EXIT !== '0') {
    process.exit(Number(process.env.STUB_AGY_VERSION_EXIT));
  }
  const ver = process.env.STUB_AGY_VERSION || '1.3.0';
  process.stdout.write(ver + '\\n');
  process.exit(0);
}

if (first === 'plugin') {
  const sub = args[1];
  if (sub === 'uninstall') {
    if (process.env.STUB_AGY_UNINSTALL_EXIT && process.env.STUB_AGY_UNINSTALL_EXIT !== '0') {
      const exitCode = Number(process.env.STUB_AGY_UNINSTALL_EXIT);
      process.stderr.write(process.env.STUB_AGY_UNINSTALL_ERR || 'uninstall failed\\n');
      process.exit(exitCode);
    }
    process.stdout.write(process.env.STUB_AGY_UNINSTALL_OUT || 'Uninstalled native-gravity\\n');
    process.exit(0);
  }
  if (sub === 'install') {
    if (process.env.STUB_AGY_INSTALL_EXIT && process.env.STUB_AGY_INSTALL_EXIT !== '0') {
      const exitCode = Number(process.env.STUB_AGY_INSTALL_EXIT);
      process.stderr.write(process.env.STUB_AGY_INSTALL_ERR || 'install failed\\n');
      process.exit(exitCode);
    }
    process.stdout.write(process.env.STUB_AGY_INSTALL_OUT || 'Installed plugin\\n');
    process.exit(0);
  }
  if (sub === 'list') {
    if (process.env.STUB_AGY_LIST_EXIT && process.env.STUB_AGY_LIST_EXIT !== '0') {
      const exitCode = Number(process.env.STUB_AGY_LIST_EXIT);
      process.stderr.write(process.env.STUB_AGY_LIST_ERR || 'list failed\\n');
      process.exit(exitCode);
    }
    const listOut = process.env.STUB_AGY_LIST_OUT !== undefined
      ? process.env.STUB_AGY_LIST_OUT
      : JSON.stringify([{ name: 'native-gravity', enabled: true }]);
    process.stdout.write(listOut + '\\n');
    process.exit(0);
  }
}

process.stderr.write('Unknown stub agy command: ' + args.join(' ') + '\\n');
process.exit(1);
`;
}

function createHarness() {
  const tempDir = mkdtempSync(join(tmpdir(), 'ntg-npm-install-test-'));
  const tempHome = join(tempDir, 'home');
  mkdirSync(tempHome, { recursive: true });

  const binDir = join(tempDir, 'bin');
  mkdirSync(binDir, { recursive: true });

  const emptyBinDir = join(tempDir, 'empty-bin');
  mkdirSync(emptyBinDir, { recursive: true });

  const agyPath = join(binDir, 'agy');
  writeFileSync(agyPath, createStubAgyScript(), 'utf8');
  chmodSync(agyPath, 0o755);

  const logFile = join(tempDir, 'agy-invocations.jsonl');

  function runInstaller(args = [], extraEnv = {}, runOptions = {}) {
    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      HOME: tempHome,
      STUB_AGY_LOG_FILE: logFile,
      ...extraEnv,
    };
    delete env.NTG_RUNNER_CHAIN;
    delete env.NTG_SUPERVISOR_LEDGER;
    delete env.NTG_SUPERVISOR_PID;

    return spawnSync(process.execPath, [INSTALLER_SCRIPT, ...args], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
      ...runOptions,
    });
  }

  function runInstallerWithoutAgy(args = [], extraEnv = {}) {
    const env = {
      ...process.env,
      PATH: emptyBinDir,
      HOME: tempHome,
      STUB_AGY_LOG_FILE: logFile,
      ...extraEnv,
    };
    delete env.NTG_RUNNER_CHAIN;
    delete env.NTG_SUPERVISOR_LEDGER;
    delete env.NTG_SUPERVISOR_PID;

    return spawnSync(process.execPath, [INSTALLER_SCRIPT, ...args], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
    });
  }

  function readInvocations() {
    if (!existsSync(logFile)) return [];
    const content = readFileSync(logFile, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }

  function assertNoLiveGeminiTouched() {
    const invocations = readInvocations();
    for (const inv of invocations) {
      assert.equal(inv.env_home, tempHome, 'stub agy received temporary HOME');
      assert.notEqual(inv.env_home, LIVE_HOME, 'stub agy never received live HOME');
      assert.notEqual(inv.env_home, LIVE_GEMINI, 'stub agy never received live .gemini');
    }
  }

  function cleanup() {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors in tests
    }
  }

  return {
    tempDir,
    tempHome,
    binDir,
    emptyBinDir,
    logFile,
    runInstaller,
    runInstallerWithoutAgy,
    readInvocations,
    assertNoLiveGeminiTouched,
    cleanup,
  };
}

test('fresh install: default invocation uninstalls first (exiting 0), then installs, then verifies', () => {
  const h = createHarness();
  try {
    const res = h.runInstaller([]);
    assert.equal(res.status, 0, `failed with stderr: ${res.stderr}`);

    const calls = h.readInvocations();
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[0].argv, ['--version']);
    assert.deepEqual(calls[1].argv, ['plugin', 'uninstall', 'native-gravity']);
    assert.deepEqual(calls[2].argv, ['plugin', 'install', REPO_ROOT]);
    assert.deepEqual(calls[3].argv, ['plugin', 'list', '--json']);

    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('fresh install: install command uninstalls first, then installs, then verifies', () => {
  const h = createHarness();
  try {
    const res = h.runInstaller(['install']);
    assert.equal(res.status, 0, `failed with stderr: ${res.stderr}`);

    const calls = h.readInvocations();
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[0].argv, ['--version']);
    assert.deepEqual(calls[1].argv, ['plugin', 'uninstall', 'native-gravity']);
    assert.deepEqual(calls[2].argv, ['plugin', 'install', REPO_ROOT]);
    assert.deepEqual(calls[3].argv, ['plugin', 'list', '--json']);

    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('upgrade: reinstall and update --no-self-update execute unconditional uninstall then install', () => {
  for (const args of [['reinstall'], ['update', '--no-self-update']]) {
    const h = createHarness();
    try {
      const res = h.runInstaller(args);
      assert.equal(res.status, 0, `args ${args.join(' ')} failed with stderr: ${res.stderr}`);

      const calls = h.readInvocations();
      assert.equal(calls.length, 4);
      assert.deepEqual(calls[0].argv, ['--version']);
      assert.deepEqual(calls[1].argv, ['plugin', 'uninstall', 'native-gravity']);
      assert.deepEqual(calls[2].argv, ['plugin', 'install', REPO_ROOT]);
      assert.deepEqual(calls[3].argv, ['plugin', 'list', '--json']);

      h.assertNoLiveGeminiTouched();
    } finally {
      h.cleanup();
    }
  }
});

test('list verification success: parsed array with enabled native-gravity succeeds', () => {
  const h = createHarness();
  try {
    const mockList = [
      { name: 'other-plugin', enabled: true },
      { name: 'native-gravity', enabled: true, version: '1.1.0' },
    ];
    const res = h.runInstaller([], {
      STUB_AGY_LIST_OUT: JSON.stringify(mockList),
    });
    assert.equal(res.status, 0, `failed with stderr: ${res.stderr}`);
    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('list verification failure: missing native-gravity entry exits non-zero with clear message', () => {
  const h = createHarness();
  try {
    const mockList = [
      { name: 'other-plugin', enabled: true },
    ];
    const res = h.runInstaller([], {
      STUB_AGY_LIST_OUT: JSON.stringify(mockList),
    });
    assert.notEqual(res.status, 0);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Plugin verification failed: 'native-gravity' not found in 'agy plugin list --json'\./);
    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('list verification failure: native-gravity entry with enabled false exits non-zero with clear message', () => {
  const h = createHarness();
  try {
    const mockList = [
      { name: 'native-gravity', enabled: false },
    ];
    const res = h.runInstaller([], {
      STUB_AGY_LIST_OUT: JSON.stringify(mockList),
    });
    assert.notEqual(res.status, 0);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Plugin verification failed: 'native-gravity' is not enabled in 'agy plugin list --json'\./);
    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('list verification failure: non-array list output exits non-zero with clear message', () => {
  const h = createHarness();
  try {
    const res = h.runInstaller([], {
      STUB_AGY_LIST_OUT: JSON.stringify({ name: 'native-gravity', enabled: true }),
    });
    assert.notEqual(res.status, 0);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Plugin verification failed: 'agy plugin list --json' did not return a JSON array\./);
    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('list verification failure: invalid JSON list output exits non-zero with clear message', () => {
  const h = createHarness();
  try {
    const res = h.runInstaller([], {
      STUB_AGY_LIST_OUT: 'INVALID_JSON_OUTPUT',
    });
    assert.notEqual(res.status, 0);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Plugin verification failed: could not parse 'agy plugin list --json' output as JSON/);
    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('missing agy (ENOENT) exits 1 with documented message', () => {
  const h = createHarness();
  try {
    const res = h.runInstallerWithoutAgy([]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Native Gravity requires Antigravity CLI \(`agy`\) on PATH\./);
    assert.match(res.stderr, /Install AGY first: https:\/\/antigravity\.google\/docs\/cli\/install\//);
  } finally {
    h.cleanup();
  }
});

test('agy below 1.3.0 exits 1 with upgrade message', () => {
  const h = createHarness();
  try {
    const res = h.runInstaller([], {
      STUB_AGY_VERSION: '1.2.9',
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Native Gravity requires AGY >= 1\.3\.0 \(found 1\.2\.9\)\. Upgrade: https:\/\/antigravity\.google\/download/);
  } finally {
    h.cleanup();
  }
});

test('pre-release 1.3.0-pre rejected with exit 1', () => {
  const h = createHarness();
  try {
    const res = h.runInstaller([], {
      STUB_AGY_VERSION: '1.3.0-pre',
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Native Gravity requires AGY >= 1\.3\.0 \(found 1\.3\.0-pre\)\. Upgrade: https:\/\/antigravity\.google\/download/);
  } finally {
    h.cleanup();
  }
});

test('unknown argument exits 2 with usage on stderr', () => {
  const h = createHarness();
  try {
    const res = h.runInstaller(['unknown-arg']);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Unknown argument: unknown-arg/);
    assert.match(res.stderr, /Usage:\s+native-gravity \[command\]/);
  } finally {
    h.cleanup();
  }
});

test('extra arguments exit 2 with usage on stderr', () => {
  const h = createHarness();
  try {
    const res = h.runInstaller(['install', 'extra']);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Unexpected arguments: install extra/);
    assert.match(res.stderr, /Usage:\s+native-gravity \[command\]/);
  } finally {
    h.cleanup();
  }
});

test('help flags (-h, --help, help) exit 0 with usage on stdout', () => {
  const h = createHarness();
  try {
    for (const flag of ['-h', '--help', 'help']) {
      const res = h.runInstaller([flag]);
      assert.equal(res.status, 0, `flag ${flag} returned ${res.status}`);
      assert.match(res.stdout, /Usage:\s+native-gravity \[command\]/);
    }
  } finally {
    h.cleanup();
  }
});

test('version flags (-v, --version, version) exit 0 with version on stdout', () => {
  const h = createHarness();
  try {
    for (const flag of ['-v', '--version', 'version']) {
      const res = h.runInstaller([flag]);
      assert.equal(res.status, 0, `flag ${flag} returned ${res.status}`);
      assert.match(res.stdout.trim(), /^\d+\.\d+\.\d+.*$/);
    }
  } finally {
    h.cleanup();
  }
});

test('uninstall failure is fatal and halts before install', () => {
  const h = createHarness();
  try {
    const res = h.runInstaller([], {
      STUB_AGY_UNINSTALL_EXIT: '3',
      STUB_AGY_UNINSTALL_ERR: 'permission denied',
    });
    assert.equal(res.status, 3);

    const calls = h.readInvocations();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].argv, ['--version']);
    assert.deepEqual(calls[1].argv, ['plugin', 'uninstall', 'native-gravity']);
    // install and list verification must not be called
  } finally {
    h.cleanup();
  }
});

test('install failure is fatal and halts before verification', () => {
  const h = createHarness();
  try {
    const res = h.runInstaller([], {
      STUB_AGY_INSTALL_EXIT: '4',
      STUB_AGY_INSTALL_ERR: 'corrupt package',
    });
    assert.equal(res.status, 4);

    const calls = h.readInvocations();
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0].argv, ['--version']);
    assert.deepEqual(calls[1].argv, ['plugin', 'uninstall', 'native-gravity']);
    assert.deepEqual(calls[2].argv, ['plugin', 'install', REPO_ROOT]);
    // list verification must not be called
  } finally {
    h.cleanup();
  }
});

test('npm pack --dry-run exits 0 and tarball file list includes scripts/npm-install.mjs and plugin files', () => {
  const res = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);

  let packData;
  try {
    packData = JSON.parse(res.stdout);
  } catch (err) {
    assert.fail(`Could not parse npm pack --dry-run --json output: ${err.message}`);
  }

  const pkgInfo = Array.isArray(packData) ? packData[0] : (packData['native-gravity'] || Object.values(packData)[0]);
  assert.ok(pkgInfo && Array.isArray(pkgInfo.files), 'npm pack JSON must contain files array');
  const filePaths = pkgInfo.files.map((f) => f.path);

  const requiredFiles = [
    'scripts/npm-install.mjs',
    'plugin.json',
    'hooks.json',
    'agents/bobcat.md',
    'rules/harness.md',
    'rules/orchestration.md',
    'skills/ntg/SKILL.md',
    'tools/ctx',
    'tools/git-snap',
    'tools/wf.py',
  ];

  for (const req of requiredFiles) {
    assert.ok(
      filePaths.includes(req),
      `tarball files list must include '${req}' (found: ${filePaths.filter((p) => p.includes(req)).join(', ') || 'none'})`
    );
  }
});

test('integration: npm pack to tarball, npm install into temporary prefix, run installed native-gravity bin', () => {
  const integrationDir = mkdtempSync(join(tmpdir(), 'ntg-npm-integration-'));
  try {
    const packDir = join(integrationDir, 'pack');
    mkdirSync(packDir, { recursive: true });

    const packRes = spawnSync('npm', ['pack', '--pack-destination', packDir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(packRes.status, 0, `npm pack failed: ${packRes.stderr}`);

    const tarballs = readdirSync(packDir).filter((f) => f.endsWith('.tgz'));
    assert.ok(tarballs.length > 0, 'tarball should exist in pack destination');
    const tarballPath = join(packDir, tarballs[0]);

    const prefixDir = join(integrationDir, 'prefix');
    mkdirSync(prefixDir, { recursive: true });
    writeFileSync(
      join(prefixDir, 'package.json'),
      JSON.stringify({ name: 'consumer-test', version: '1.0.0' }),
      'utf8'
    );

    const installRes = spawnSync(
      'npm',
      ['install', '--no-audit', '--no-fund', '--ignore-scripts', tarballPath],
      {
        cwd: prefixDir,
        encoding: 'utf8',
      }
    );
    assert.equal(installRes.status, 0, `npm install into prefix failed: ${installRes.stderr}`);

    const binPath = join(prefixDir, 'node_modules', '.bin', 'native-gravity');
    assert.ok(existsSync(binPath), `bin symlink must exist at ${binPath}`);

    const stubBinDir = join(integrationDir, 'stub-bin');
    mkdirSync(stubBinDir, { recursive: true });
    const stubAgyPath = join(stubBinDir, 'agy');
    writeFileSync(stubAgyPath, createStubAgyScript(), 'utf8');
    chmodSync(stubAgyPath, 0o755);

    const integrationLog = join(integrationDir, 'integration-agy-calls.jsonl');
    const tempHome = join(integrationDir, 'temp-home');
    mkdirSync(tempHome, { recursive: true });

    const env = {
      ...process.env,
      PATH: `${stubBinDir}:${process.env.PATH}`,
      HOME: tempHome,
      STUB_AGY_LOG_FILE: integrationLog,
    };
    delete env.NTG_RUNNER_CHAIN;
    delete env.NTG_SUPERVISOR_LEDGER;
    delete env.NTG_SUPERVISOR_PID;

    const runRes = spawnSync(binPath, [], {
      cwd: prefixDir,
      env,
      encoding: 'utf8',
    });
    assert.equal(runRes.status, 0, `running bin failed: status=${runRes.status}\nstderr: ${runRes.stderr}\nstdout: ${runRes.stdout}`);

    // Verify stub agy invocations
    assert.ok(existsSync(integrationLog), 'integration log file must exist');
    const calls = readFileSync(integrationLog, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    assert.equal(calls.length, 4, 'expected 4 agy invocations: version, uninstall, install, list');
    assert.deepEqual(calls[0].argv, ['--version']);
    assert.deepEqual(calls[1].argv, ['plugin', 'uninstall', 'native-gravity']);

    assert.equal(calls[2].argv[0], 'plugin');
    assert.equal(calls[2].argv[1], 'install');
    const installedPkgRoot = calls[2].argv[2];
    assert.ok(
      existsSync(join(installedPkgRoot, 'plugin.json')),
      `installed packageRoot '${installedPkgRoot}' must contain plugin.json`
    );
    assert.ok(
      existsSync(join(installedPkgRoot, 'package.json')),
      `installed packageRoot '${installedPkgRoot}' must contain package.json`
    );
    assert.ok(
      installedPkgRoot.includes('node_modules'),
      `packageRoot '${installedPkgRoot}' must resolve inside node_modules`
    );

    assert.deepEqual(calls[3].argv, ['plugin', 'list', '--json']);

    for (const call of calls) {
      assert.equal(call.env_home, tempHome, 'call must use temp HOME');
      assert.notEqual(call.env_home, LIVE_HOME, 'call must never use live HOME');
      assert.notEqual(call.env_home, LIVE_GEMINI, 'call must never use live .gemini');
    }
  } finally {
    rmSync(integrationDir, { recursive: true, force: true });
  }
});
