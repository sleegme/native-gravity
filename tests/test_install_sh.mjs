import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
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
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');
const LIVE_HOME = homedir();
const LIVE_GEMINI = join(LIVE_HOME, '.gemini');

function findSystemBinary(name) {
  const res = spawnSync('which', [name], { encoding: 'utf8' });
  if (res.status === 0 && res.stdout.trim()) {
    return res.stdout.trim();
  }
  for (const dir of ['/usr/bin', '/bin', '/usr/local/bin']) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

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

function createStubBunScript() {
  return `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const res = spawnSync(process.execPath, process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
});
process.exit(res.status ?? 0);
`;
}

function createStubWgetScript() {
  return `#!${process.execPath}
import { copyFileSync, existsSync } from 'node:fs';
import process from 'node:process';

const args = process.argv.slice(2);
let outFile = null;
let url = null;

let i = 0;
while (i < args.length) {
  if (args[i] === '-qO' || args[i] === '-O') {
    outFile = args[i + 1];
    i += 2;
  } else {
    url = args[i];
    i++;
  }
}

if (!outFile || !url) {
  process.stderr.write('wget stub: missing args\\n');
  process.exit(1);
}

if (url.startsWith('file://')) {
  const src = url.slice(7);
  if (!existsSync(src)) {
    process.stderr.write('wget stub: file not found: ' + src + '\\n');
    process.exit(1);
  }
  copyFileSync(src, outFile);
  process.exit(0);
}

process.stderr.write('wget stub: unsupported non-file URL: ' + url + '\\n');
process.exit(1);
`;
}

function createReleaseArchive(targetDir, ref = 'v1.1.1') {
  const staging = join(targetDir, 'staging');
  const prefix = join(staging, `native-gravity-${ref}`);
  mkdirSync(prefix, { recursive: true });

  for (const item of ['package.json', 'plugin.json', 'hooks.json']) {
    cpSync(join(REPO_ROOT, item), join(prefix, item));
  }
  for (const d of ['scripts', 'agents', 'rules', 'skills', 'tools']) {
    cpSync(join(REPO_ROOT, d), join(prefix, d), { recursive: true });
  }

  const archivePath = join(targetDir, `release-${ref}.tar.gz`);
  const res = spawnSync('tar', ['-czf', archivePath, '-C', staging, `native-gravity-${ref}`]);
  if (res.status !== 0) {
    throw new Error(`Failed to create release tarball: ${res.stderr}`);
  }
  return archivePath;
}

function createHarness() {
  const tempDir = mkdtempSync(join(tmpdir(), 'ntg-install-sh-test-'));
  const tempHome = join(tempDir, 'home');
  mkdirSync(tempHome, { recursive: true });

  const archivePath = createReleaseArchive(tempDir, 'v1.1.1');
  const archiveUrl = `file://${archivePath}`;

  const binDir = join(tempDir, 'bin');
  mkdirSync(binDir, { recursive: true });

  const bunOnlyBinDir = join(tempDir, 'bun-bin');
  mkdirSync(bunOnlyBinDir, { recursive: true });

  const wgetBinDir = join(tempDir, 'wget-bin');
  mkdirSync(wgetBinDir, { recursive: true });

  const missingRuntimesBinDir = join(tempDir, 'no-runtime-bin');
  mkdirSync(missingRuntimesBinDir, { recursive: true });

  const missingTarBinDir = join(tempDir, 'no-tar-bin');
  mkdirSync(missingTarBinDir, { recursive: true });

  const missingDownloaderBinDir = join(tempDir, 'no-dl-bin');
  mkdirSync(missingDownloaderBinDir, { recursive: true });

  const agyLogFile = join(tempDir, 'agy-invocations.jsonl');

  // Locate system utilities needed for shell scripts
  const systemTar = findSystemBinary('tar');
  const systemCurl = findSystemBinary('curl');
  const systemMkdir = findSystemBinary('mkdir');
  const systemRm = findSystemBinary('rm');
  const systemMv = findSystemBinary('mv');
  const systemCp = findSystemBinary('cp');
  const systemGzip = findSystemBinary('gzip');
  const systemSh = findSystemBinary('sh');

  assert.ok(systemTar, 'tar must be available on host');
  assert.ok(systemCurl, 'curl must be available on host');
  assert.ok(systemMkdir, 'mkdir must be available on host');
  assert.ok(systemRm, 'rm must be available on host');
  assert.ok(systemMv, 'mv must be available on host');
  assert.ok(systemCp, 'cp must be available on host');

  const stubAgy = createStubAgyScript();
  const stubBun = createStubBunScript();
  const stubWget = createStubWgetScript();

  function populateBaseUtils(targetDir) {
    // Stub agy
    const agyPath = join(targetDir, 'agy');
    writeFileSync(agyPath, stubAgy, 'utf8');
    chmodSync(agyPath, 0o755);

    // Basic filesystem tools
    symlinkSync(systemMkdir, join(targetDir, 'mkdir'));
    symlinkSync(systemRm, join(targetDir, 'rm'));
    symlinkSync(systemMv, join(targetDir, 'mv'));
    symlinkSync(systemCp, join(targetDir, 'cp'));
    if (systemGzip) symlinkSync(systemGzip, join(targetDir, 'gzip'));
    if (systemSh) symlinkSync(systemSh, join(targetDir, 'sh'));
  }

  // 1. binDir: node + tar + curl + agy (NO npx, NO npm, NO bunx, NO bun)
  populateBaseUtils(binDir);
  symlinkSync(process.execPath, join(binDir, 'node'));
  symlinkSync(systemTar, join(binDir, 'tar'));
  symlinkSync(systemCurl, join(binDir, 'curl'));

  // 2. bunOnlyBinDir: bun + tar + curl + agy (NO node, NO npx, NO npm, NO bunx)
  populateBaseUtils(bunOnlyBinDir);
  writeFileSync(join(bunOnlyBinDir, 'bun'), stubBun, 'utf8');
  chmodSync(join(bunOnlyBinDir, 'bun'), 0o755);
  symlinkSync(systemTar, join(bunOnlyBinDir, 'tar'));
  symlinkSync(systemCurl, join(bunOnlyBinDir, 'curl'));

  // 3. wgetBinDir: node + tar + wget + agy (NO curl, NO npx, NO npm, NO bunx)
  populateBaseUtils(wgetBinDir);
  symlinkSync(process.execPath, join(wgetBinDir, 'node'));
  symlinkSync(systemTar, join(wgetBinDir, 'tar'));
  writeFileSync(join(wgetBinDir, 'wget'), stubWget, 'utf8');
  chmodSync(join(wgetBinDir, 'wget'), 0o755);

  // 4. missingRuntimesBinDir: tar + curl + agy (NO node, NO bun)
  populateBaseUtils(missingRuntimesBinDir);
  symlinkSync(systemTar, join(missingRuntimesBinDir, 'tar'));
  symlinkSync(systemCurl, join(missingRuntimesBinDir, 'curl'));

  // 5. missingTarBinDir: node + curl + agy (NO tar)
  populateBaseUtils(missingTarBinDir);
  symlinkSync(process.execPath, join(missingTarBinDir, 'node'));
  symlinkSync(systemCurl, join(missingTarBinDir, 'curl'));

  // 6. missingDownloaderBinDir: node + tar + agy (NO curl, NO wget)
  populateBaseUtils(missingDownloaderBinDir);
  symlinkSync(process.execPath, join(missingDownloaderBinDir, 'node'));
  symlinkSync(systemTar, join(missingDownloaderBinDir, 'tar'));

  function runScript(args, targetBinDir, extraEnv = {}, runOptions = {}) {
    const env = {
      PATH: targetBinDir,
      HOME: tempHome,
      STUB_AGY_LOG_FILE: agyLogFile,
      NATIVE_GRAVITY_ARCHIVE_URL: archiveUrl,
      ...extraEnv,
    };
    delete env.NTG_RUNNER_CHAIN;
    delete env.NTG_SUPERVISOR_LEDGER;
    delete env.NTG_SUPERVISOR_PID;
    delete env.NTG_BULLDOZER_NO_SHELL;
    delete env.NTG_BULLDOZER_CONVERSATION_FILE;

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

  function runInstallShWithWget(args = [], extraEnv = {}, runOptions = {}) {
    return runScript(args, wgetBinDir, extraEnv, runOptions);
  }

  function runInstallShWithoutRuntimes(args = [], extraEnv = {}, runOptions = {}) {
    return runScript(args, missingRuntimesBinDir, extraEnv, runOptions);
  }

  function runInstallShWithoutTar(args = [], extraEnv = {}, runOptions = {}) {
    return runScript(args, missingTarBinDir, extraEnv, runOptions);
  }

  function runInstallShWithoutDownloader(args = [], extraEnv = {}, runOptions = {}) {
    return runScript(args, missingDownloaderBinDir, extraEnv, runOptions);
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

  function assertNoLiveGeminiTouched() {
    for (const inv of readAgyInvocations()) {
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
    archivePath,
    archiveUrl,
    binDir,
    bunOnlyBinDir,
    wgetBinDir,
    missingRuntimesBinDir,
    missingTarBinDir,
    missingDownloaderBinDir,
    runInstallSh,
    runInstallShWithBun,
    runInstallShWithWget,
    runInstallShWithoutRuntimes,
    runInstallShWithoutTar,
    runInstallShWithoutDownloader,
    readAgyInvocations,
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
    'must document v1.1.1 raw URL'
  );
  assert.match(
    content,
    /https:\/\/raw\.githubusercontent\.com\/sleegme\/native-gravity\/main\/scripts\/install\.sh/,
    'must document main raw URL'
  );
  assert.match(
    content,
    /Forwarding arguments:/,
    'must document forwarding arguments'
  );
});

test('acceptance: install.sh succeeds with PATH containing no npx, npm or bunx (only node, tar, curl, agy)', () => {
  const h = createHarness();
  try {
    const entries = readdirSync(h.binDir);
    assert.ok(!entries.includes('npx'), 'binDir must not contain npx');
    assert.ok(!entries.includes('npm'), 'binDir must not contain npm');
    assert.ok(!entries.includes('bunx'), 'binDir must not contain bunx');
    assert.ok(!entries.includes('bun'), 'binDir must not contain bun');

    const res = h.runInstallSh([]);
    assert.equal(res.status, 0, `install.sh failed with stderr: ${res.stderr}`);

    const expectedTarget = join(h.tempHome, '.local', 'share', 'native-gravity', 'v1.1.1');
    assert.ok(existsSync(expectedTarget), `target directory must exist: ${expectedTarget}`);
    assert.ok(existsSync(join(expectedTarget, 'package.json')), 'target directory has package.json');
    assert.ok(existsSync(join(expectedTarget, 'scripts', 'npm-install.mjs')), 'target directory has npm-install.mjs');

    const agyCalls = h.readAgyInvocations();
    assert.equal(agyCalls.length, 4);
    assert.deepEqual(agyCalls[0].argv, ['--version']);
    assert.deepEqual(agyCalls[1].argv, ['plugin', 'uninstall', 'native-gravity']);
    assert.deepEqual(agyCalls[2].argv, ['plugin', 'install', expectedTarget]);
    assert.deepEqual(agyCalls[3].argv, ['plugin', 'list', '--json']);

    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('offline harness test: bun runner executes shared core against stub agy when bun is present and node is not', () => {
  const h = createHarness();
  try {
    const entries = readdirSync(h.bunOnlyBinDir);
    assert.ok(!entries.includes('node'), 'bunOnlyBinDir must not contain node');
    assert.ok(!entries.includes('npx'), 'bunOnlyBinDir must not contain npx');
    assert.ok(!entries.includes('npm'), 'bunOnlyBinDir must not contain npm');
    assert.ok(!entries.includes('bunx'), 'bunOnlyBinDir must not contain bunx');
    assert.ok(entries.includes('bun'), 'bunOnlyBinDir must contain bun');

    const res = h.runInstallShWithBun([]);
    assert.equal(res.status, 0, `install.sh with bun failed with stderr: ${res.stderr}`);

    const expectedTarget = join(h.tempHome, '.local', 'share', 'native-gravity', 'v1.1.1');
    assert.ok(existsSync(expectedTarget), `target directory must exist: ${expectedTarget}`);

    const agyCalls = h.readAgyInvocations();
    assert.equal(agyCalls.length, 4);
    assert.deepEqual(agyCalls[0].argv, ['--version']);
    assert.deepEqual(agyCalls[1].argv, ['plugin', 'uninstall', 'native-gravity']);
    assert.deepEqual(agyCalls[2].argv, ['plugin', 'install', expectedTarget]);
    assert.deepEqual(agyCalls[3].argv, ['plugin', 'list', '--json']);

    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('offline harness test: wget fallback executes shared core when curl is absent', () => {
  const h = createHarness();
  try {
    const entries = readdirSync(h.wgetBinDir);
    assert.ok(!entries.includes('curl'), 'wgetBinDir must not contain curl');
    assert.ok(entries.includes('wget'), 'wgetBinDir must contain wget');

    const res = h.runInstallShWithWget([]);
    assert.equal(res.status, 0, `install.sh with wget failed with stderr: ${res.stderr}`);

    const expectedTarget = join(h.tempHome, '.local', 'share', 'native-gravity', 'v1.1.1');
    assert.ok(existsSync(expectedTarget), `target directory must exist: ${expectedTarget}`);

    const agyCalls = h.readAgyInvocations();
    assert.equal(agyCalls.length, 4);
    assert.deepEqual(agyCalls[2].argv, ['plugin', 'install', expectedTarget]);

    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('offline harness test: clear failure message and exit 1 when neither node nor bun is present', () => {
  const h = createHarness();
  try {
    const res = h.runInstallShWithoutRuntimes([]);
    assert.equal(res.status, 1);
    assert.match(
      res.stderr,
      /Native Gravity requires Node\.js \(>=18\) or Bun on PATH/
    );
    assert.equal(h.readAgyInvocations().length, 0);
    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('offline harness test: clear failure message and exit 1 when tar is missing', () => {
  const h = createHarness();
  try {
    const res = h.runInstallShWithoutTar([]);
    assert.equal(res.status, 1);
    assert.match(
      res.stderr,
      /Native Gravity installer requires 'tar' on PATH/
    );
    assert.equal(h.readAgyInvocations().length, 0);
    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('offline harness test: clear failure message and exit 1 when neither curl nor wget is present', () => {
  const h = createHarness();
  try {
    const res = h.runInstallShWithoutDownloader([]);
    assert.equal(res.status, 1);
    assert.match(
      res.stderr,
      /Native Gravity installer requires 'curl' or 'wget' on PATH/
    );
    assert.equal(h.readAgyInvocations().length, 0);
    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('offline harness test: download failure exits non-zero and prints message containing failed URL', () => {
  const h = createHarness();
  try {
    const fakeUrl = 'file:///path/does/not/exist/release-fake.tar.gz';
    const res = h.runInstallSh([], { NATIVE_GRAVITY_ARCHIVE_URL: fakeUrl });
    assert.notEqual(res.status, 0);
    assert.equal(res.status, 1);
    assert.match(
      res.stderr,
      new RegExp(`Failed to download Native Gravity archive from ${fakeUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    );
    assert.equal(h.readAgyInvocations().length, 0);
    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('offline harness test: re-run replaces existing target directory cleanly and atomically', () => {
  const h = createHarness();
  try {
    const res1 = h.runInstallSh([]);
    assert.equal(res1.status, 0);

    const targetDir = join(h.tempHome, '.local', 'share', 'native-gravity', 'v1.1.1');
    assert.ok(existsSync(targetDir));

    // Place a marker file to verify clean replacement
    const markerFile = join(targetDir, 'canary-marker.txt');
    writeFileSync(markerFile, 'old-version-data', 'utf8');
    assert.ok(existsSync(markerFile));

    // Re-run installer
    const res2 = h.runInstallSh(['reinstall']);
    assert.equal(res2.status, 0);

    // Marker must no longer exist because directory was replaced atomically
    assert.ok(!existsSync(markerFile), 're-run must atomically replace target directory');
    assert.ok(existsSync(join(targetDir, 'package.json')), 're-run directory contains fresh files');

    h.assertNoLiveGeminiTouched();
  } finally {
    h.cleanup();
  }
});

test('offline harness test: custom NATIVE_GRAVITY_REF sets persistent directory to ref', () => {
  const h = createHarness();
  try {
    // Create archive for custom ref
    const customArchive = createReleaseArchive(h.tempDir, 'main');
    const customUrl = `file://${customArchive}`;

    const res = h.runInstallSh([], {
      NATIVE_GRAVITY_REF: 'main',
      NATIVE_GRAVITY_ARCHIVE_URL: customUrl,
    });
    assert.equal(res.status, 0, `install.sh failed with stderr: ${res.stderr}`);

    const expectedTarget = join(h.tempHome, '.local', 'share', 'native-gravity', 'main');
    assert.ok(existsSync(expectedTarget), `target directory must exist: ${expectedTarget}`);

    const agyCalls = h.readAgyInvocations();
    assert.equal(agyCalls[2].argv[2], expectedTarget);

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
    'must document v1.1.1 raw URL'
  );
  assert.match(
    content,
    /https:\/\/raw\.githubusercontent\.com\/sleegme\/native-gravity\/main\/scripts\/install\.ps1/,
    'must document main raw URL'
  );

  // Verify runner and prerequisites checks
  assert.match(content, /Get-Command\s+node/i, 'must verify node availability');
  assert.match(content, /Get-Command\s+bun/i, 'must verify bun availability');
  assert.match(content, /Get-Command\s+tar/i, 'must check tar availability');
  assert.match(
    content,
    /Native Gravity requires Node\.js \(>=18\) or Bun on PATH to run the installer\./,
    'must contain clear failure message for missing runtimes'
  );

  // Verify download and persistent target directory logic
  assert.match(content, /codeload\.github\.com\/sleegme\/native-gravity/, 'must use codeload release archives');
  assert.match(content, /\$env:LOCALAPPDATA/i, 'must support LOCALAPPDATA');
  assert.match(content, /native-gravity/, 'must use native-gravity target directory');
  assert.match(content, /@args/, 'must forward arguments via @args');
  assert.match(content, /exit \$LASTEXITCODE/, 'must propagate exit code');

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
