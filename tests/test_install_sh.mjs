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
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const INSTALL_SH = join(REPO_ROOT, 'scripts', 'install.sh');
const INSTALL_PS1 = join(REPO_ROOT, 'scripts', 'install.ps1');
const WORKTREE_NPM_INSTALL_SCRIPT = join(REPO_ROOT, 'scripts', 'npm-install.mjs');
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');
const LIVE_HOME = homedir();
const LIVE_GEMINI = join(LIVE_HOME, '.gemini');

function createStubAgyScript() {
  return `#!${process.execPath}
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

function createStubNpxScript(targetScript) {
  return `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import process from 'node:process';

const logFile = process.env.STUB_NPX_LOG_FILE;
if (logFile) {
  appendFileSync(logFile, JSON.stringify({
    argv: process.argv.slice(2),
    env_home: process.env.HOME,
    timestamp: Date.now(),
  }) + '\\n');
}

const rawArgs = process.argv.slice(2);
let forwarded = [];
let i = 0;
while (i < rawArgs.length) {
  const a = rawArgs[i];
  if (a === '--yes' || a === '-y') {
    i++;
    continue;
  }
  if (a === 'native-gravity') {
    forwarded = rawArgs.slice(i + 1);
    break;
  }
  forwarded.push(a);
  i++;
}

const target = ${JSON.stringify(targetScript)};
const res = spawnSync(process.execPath, [target, ...forwarded], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(res.status ?? 0);
`;
}

function createStubBunxScript(targetScript) {
  return `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import process from 'node:process';

const logFile = process.env.STUB_BUNX_LOG_FILE;
if (logFile) {
  appendFileSync(logFile, JSON.stringify({
    argv: process.argv.slice(2),
    env_home: process.env.HOME,
    timestamp: Date.now(),
  }) + '\\n');
}

const rawArgs = process.argv.slice(2);
let forwarded = [];
if (rawArgs[0] === 'native-gravity') {
  forwarded = rawArgs.slice(1);
} else {
  forwarded = rawArgs;
}

const target = ${JSON.stringify(targetScript)};
const res = spawnSync(process.execPath, [target, ...forwarded], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(res.status ?? 0);
`;
}

function createHarness() {
  const tempDir = mkdtempSync(join(tmpdir(), 'ntg-install-sh-test-'));
  const tempHome = join(tempDir, 'home');
  mkdirSync(tempHome, { recursive: true });

  const binDir = join(tempDir, 'bin');
  mkdirSync(binDir, { recursive: true });

  const bunOnlyBinDir = join(tempDir, 'bun-bin');
  mkdirSync(bunOnlyBinDir, { recursive: true });

  const emptyBinDir = join(tempDir, 'empty-bin');
  mkdirSync(emptyBinDir, { recursive: true });

  const agyLogFile = join(tempDir, 'agy-invocations.jsonl');
  const npxLogFile = join(tempDir, 'npx-invocations.jsonl');
  const bunxLogFile = join(tempDir, 'bunx-invocations.jsonl');

  // Stub agy in binDir, bunOnlyBinDir, and emptyBinDir
  const stubAgy = createStubAgyScript();
  for (const dir of [binDir, bunOnlyBinDir, emptyBinDir]) {
    const agyPath = join(dir, 'agy');
    writeFileSync(agyPath, stubAgy, 'utf8');
    chmodSync(agyPath, 0o755);
  }

  // Stub npx in binDir
  const stubNpx = createStubNpxScript(WORKTREE_NPM_INSTALL_SCRIPT);
  const npxPath = join(binDir, 'npx');
  writeFileSync(npxPath, stubNpx, 'utf8');
  chmodSync(npxPath, 0o755);

  // Stub bunx in binDir and bunOnlyBinDir
  const stubBunx = createStubBunxScript(WORKTREE_NPM_INSTALL_SCRIPT);
  const bunxInBin = join(binDir, 'bunx');
  writeFileSync(bunxInBin, stubBunx, 'utf8');
  chmodSync(bunxInBin, 0o755);

  const bunxInBunOnly = join(bunOnlyBinDir, 'bunx');
  writeFileSync(bunxInBunOnly, stubBunx, 'utf8');
  chmodSync(bunxInBunOnly, 0o755);

  function runScript(args, targetBinDir, extraEnv = {}, runOptions = {}) {
    const env = {
      ...process.env,
      PATH: targetBinDir,
      HOME: tempHome,
      STUB_AGY_LOG_FILE: agyLogFile,
      STUB_NPX_LOG_FILE: npxLogFile,
      STUB_BUNX_LOG_FILE: bunxLogFile,
      ...extraEnv,
    };
    delete env.NTG_RUNNER_CHAIN;
    delete env.NTG_SUPERVISOR_LEDGER;
    delete env.NTG_SUPERVISOR_PID;

    return spawnSync(INSTALL_SH, args, {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
      ...runOptions,
    });
  }

  function runInstallSh(args = [], extraEnv = {}, runOptions = {}) {
    return runScript(args, binDir, extraEnv, runOptions);
  }

  function runInstallShWithBun(args = [], extraEnv = {}, runOptions = {}) {
    return runScript(args, bunOnlyBinDir, extraEnv, runOptions);
  }

  function runInstallShWithoutRuntimes(args = [], extraEnv = {}, runOptions = {}) {
    return runScript(args, emptyBinDir, extraEnv, runOptions);
  }

  function readLog(filePath) {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }

  function readAgyInvocations() {
    return readLog(agyLogFile);
  }

  function readNpxInvocations() {
    return readLog(npxLogFile);
  }

  function readBunxInvocations() {
    return readLog(bunxLogFile);
  }

  function assertNoLiveGeminiTouched() {
    for (const inv of [...readAgyInvocations(), ...readNpxInvocations(), ...readBunxInvocations()]) {
      assert.equal(inv.env_home, tempHome, 'stub received temporary HOME');
      assert.notEqual(inv.env_home, LIVE_HOME, 'stub never received live HOME');
      assert.notEqual(inv.env_home, LIVE_GEMINI, 'stub never received live .gemini');
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
    bunOnlyBinDir,
    emptyBinDir,
    runInstallSh,
    runInstallShWithBun,
    runInstallShWithoutRuntimes,
    readAgyInvocations,
    readNpxInvocations,
    readBunxInvocations,
    assertNoLiveGeminiTouched,
    cleanup,
  };
}

test('sh -n scripts/install.sh exits 0', () => {
  const res = spawnSync('sh', ['-n', INSTALL_SH], { encoding: 'utf8' });
  assert.equal(res.status, 0, `sh -n failed: ${res.stderr}`);
});

test('scripts/install.sh is executable (mode 0755)', () => {
  const st = statSync(INSTALL_SH);
  assert.notEqual(st.mode & 0o111, 0, 'scripts/install.sh must have executable bits set');
});

test('scripts/install.sh documents versioned and main raw URLs in header', () => {
  const content = readFileSync(INSTALL_SH, 'utf8');
  assert.match(
    content,
    /https:\/\/raw\.githubusercontent\.com\/sleegme\/native-gravity\/v1\.1\.0\/scripts\/install\.sh/,
    'must document v1.1.0 raw URL'
  );
  assert.match(
    content,
    /https:\/\/raw\.githubusercontent\.com\/sleegme\/native-gravity\/main\/scripts\/install\.sh/,
    'must document main raw URL'
  );
});

test('offline harness test: drives scripts/install.sh via stub npx against stub agy end-to-end', () => {
  const h = createHarness();
  try {
    const res = h.runInstallSh([]);
    assert.equal(res.status, 0, `install.sh failed with stderr: ${res.stderr}`);

    // Verify stub npx was invoked with --yes and package name
    const npxCalls = h.readNpxInvocations();
    assert.equal(npxCalls.length, 1);
    assert.deepEqual(npxCalls[0].argv, ['--yes', 'native-gravity']);

    // Verify stub agy calls: version check, uninstall, install, list verification
    const agyCalls = h.readAgyInvocations();
    assert.equal(agyCalls.length, 4);
    assert.deepEqual(agyCalls[0].argv, ['--version']);
    assert.deepEqual(agyCalls[1].argv, ['plugin', 'uninstall', 'native-gravity']);
    assert.deepEqual(agyCalls[2].argv, ['plugin', 'install', REPO_ROOT]);
    assert.deepEqual(agyCalls[3].argv, ['plugin', 'list', '--json']);

    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('offline harness test: clear failure message and non-zero exit when neither node/npx nor bun/bunx is present', () => {
  const h = createHarness();
  try {
    const res = h.runInstallShWithoutRuntimes([]);
    assert.notEqual(res.status, 0);
    assert.equal(res.status, 1);
    assert.match(
      res.stderr,
      /Native Gravity requires Node\.js \(npx\) or Bun \(bunx\) on PATH to run the installer\./
    );
    assert.match(
      res.stderr,
      /Please install Node\.js \(>=18\): https:\/\/nodejs\.org\/ or Bun: https:\/\/bun\.sh\//
    );

    // No agy or runner calls should have occurred
    assert.equal(h.readAgyInvocations().length, 0);
    assert.equal(h.readNpxInvocations().length, 0);
    assert.equal(h.readBunxInvocations().length, 0);

    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('offline harness test: bunx executes shared core against stub agy when bunx is present and npx is not', () => {
  const h = createHarness();
  try {
    const res = h.runInstallShWithBun([]);
    assert.equal(res.status, 0, `install.sh with bun failed with stderr: ${res.stderr}`);

    // Verify stub bunx was invoked with package name
    const bunxCalls = h.readBunxInvocations();
    assert.equal(bunxCalls.length, 1);
    assert.deepEqual(bunxCalls[0].argv, ['native-gravity']);

    // Verify stub agy calls executed end-to-end
    const agyCalls = h.readAgyInvocations();
    assert.equal(agyCalls.length, 4);
    assert.deepEqual(agyCalls[0].argv, ['--version']);
    assert.deepEqual(agyCalls[1].argv, ['plugin', 'uninstall', 'native-gravity']);
    assert.deepEqual(agyCalls[2].argv, ['plugin', 'install', REPO_ROOT]);
    assert.deepEqual(agyCalls[3].argv, ['plugin', 'list', '--json']);

    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('offline harness test: argument forwarding through scripts/install.sh', () => {
  const h = createHarness();
  try {
    // --help forwarded
    const helpRes = h.runInstallSh(['--help']);
    assert.equal(helpRes.status, 0);
    assert.match(helpRes.stdout, /Usage:\s+native-gravity \[command\]/);

    // --version forwarded
    const verRes = h.runInstallSh(['--version']);
    assert.equal(verRes.status, 0);
    assert.match(verRes.stdout, /^1\.1\.0/);

    // reinstall subcommand forwarded
    const reinstallRes = h.runInstallSh(['reinstall']);
    assert.equal(reinstallRes.status, 0);

    // unexpected argument forwarded and exits 2
    const badRes = h.runInstallSh(['unknown-arg']);
    assert.equal(badRes.status, 2);
    assert.match(badRes.stderr, /Unknown argument: unknown-arg/);

    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('scripts/install.ps1 consistency check and optional pwsh parse check', () => {
  assert.ok(existsSync(INSTALL_PS1), 'scripts/install.ps1 must exist');
  const content = readFileSync(INSTALL_PS1, 'utf8');

  // Verify documented URLs
  assert.match(
    content,
    /https:\/\/raw\.githubusercontent\.com\/sleegme\/native-gravity\/v1\.1\.0\/scripts\/install\.ps1/,
    'must document v1.1.0 raw URL'
  );
  assert.match(
    content,
    /https:\/\/raw\.githubusercontent\.com\/sleegme\/native-gravity\/main\/scripts\/install\.ps1/,
    'must document main raw URL'
  );

  // Verify core invocation and missing npx check
  assert.match(content, /Get-Command\s+npx/i, 'must verify npx availability');
  assert.match(content, /npx\s+--yes\s+native-gravity/, 'must invoke npx --yes native-gravity');
  assert.match(
    content,
    /Native Gravity requires Node\.js \(npx\) on PATH to run the installer\./,
    'must contain clear failure message for missing npx'
  );

  // If pwsh exists on PATH, perform AST parse check without runtime execution
  const pwshCheck = spawnSync('which', ['pwsh'], { encoding: 'utf8' });
  if (pwshCheck.status === 0) {
    const parseResult = spawnSync('pwsh', [
      '-NoProfile',
      '-Command',
      `$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${INSTALL_PS1}', [ref]$null, [ref]$errors); if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_ }; exit 1 } exit 0`,
    ], { encoding: 'utf8' });
    assert.equal(parseResult.status, 0, `pwsh parse check failed: ${parseResult.stderr}`);
  }
});

test('package.json files array includes installer scripts', () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
  assert.ok(Array.isArray(pkg.files), 'package.json files must be an array');
  assert.ok(pkg.files.includes('scripts/install.sh'), 'package.json files must include scripts/install.sh');
  assert.ok(pkg.files.includes('scripts/install.ps1'), 'package.json files must include scripts/install.ps1');
});
