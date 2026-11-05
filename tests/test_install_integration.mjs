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
const LIVE_HOME = homedir();
const LIVE_GEMINI = join(LIVE_HOME, '.gemini');

function createStubAgyScript() {
  return `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import process from 'node:process';

const logFile = process.env.STUB_AGY_LOG_FILE;
if (logFile) {
  appendFileSync(
    logFile,
    JSON.stringify({
      argv: process.argv.slice(2),
      env_home: process.env.HOME,
      timestamp: Date.now(),
    }) + '\\n'
  );
}

const args = process.argv.slice(2);
const first = args[0];

if (first === '--version') {
  const ver = process.env.STUB_AGY_VERSION || '1.3.0';
  process.stdout.write(ver + '\\n');
  process.exit(0);
}

if (first === 'plugin') {
  const sub = args[1];
  if (sub === 'uninstall') {
    process.stdout.write('Uninstalled native-gravity\\n');
    process.exit(0);
  }
  if (sub === 'install') {
    process.stdout.write('Installed plugin\\n');
    process.exit(0);
  }
  if (sub === 'list') {
    const listOut = JSON.stringify([{ name: 'native-gravity', enabled: true }]);
    process.stdout.write(listOut + '\\n');
    process.exit(0);
  }
}

process.stderr.write('Unknown stub agy command: ' + args.join(' ') + '\\n');
process.exit(1);
`;
}

test('offline integration test: npm pack -> npm install into prefix -> run .bin/native-gravity -> verify stub agy -> rerun upgrade', () => {
  const tempPackDir = mkdtempSync(join(tmpdir(), 'ntg-int-pack-'));
  const tempPrefix = mkdtempSync(join(tmpdir(), 'ntg-int-prefix-'));
  const tempHome = mkdtempSync(join(tmpdir(), 'ntg-int-home-'));
  const stubBinDir = mkdtempSync(join(tmpdir(), 'ntg-int-stub-bin-'));

  try {
    // 1. Pack repo using npm pack into a temporary directory
    const packRes = spawnSync('npm', ['pack', '--pack-destination', tempPackDir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(packRes.status, 0, `npm pack failed: ${packRes.stderr}`);
    const tarballFileName = packRes.stdout.trim().split('\n').pop().trim();
    const tarballPath = join(tempPackDir, tarballFileName);
    assert.ok(existsSync(tarballPath), `Packed tarball must exist at: ${tarballPath}`);

    // 2. Install generated tarball into a temporary prefix using npm install --no-audit --no-fund --ignore-scripts
    writeFileSync(
      join(tempPrefix, 'package.json'),
      JSON.stringify({ name: 'consumer-test', private: true, version: '1.0.0' }),
      'utf8'
    );
    const installRes = spawnSync(
      'npm',
      ['install', '--prefix', tempPrefix, '--no-audit', '--no-fund', '--ignore-scripts', tarballPath],
      { encoding: 'utf8' }
    );
    assert.equal(installRes.status, 0, `npm install into prefix failed: ${installRes.stderr}`);

    // 3. Locate .bin/native-gravity inside prefix node_modules/.bin/
    const binPath = join(tempPrefix, 'node_modules', '.bin', 'native-gravity');
    assert.ok(existsSync(binPath), `.bin/native-gravity must exist at: ${binPath}`);

    // 4. Create stub agy in temporary bin directory
    const agyStubPath = join(stubBinDir, 'agy');
    writeFileSync(agyStubPath, createStubAgyScript(), 'utf8');
    chmodSync(agyStubPath, 0o755);

    const logFile = join(tempHome, 'agy-invocations.jsonl');

    function readAgyInvocations() {
      if (!existsSync(logFile)) return [];
      return readFileSync(logFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    }

    // 5. Run .bin/native-gravity with temporary HOME and PATH
    const liveGeminiMtimeBefore = existsSync(LIVE_GEMINI) ? statSync(LIVE_GEMINI).mtimeMs : null;

    const runEnv = {
      ...process.env,
      PATH: `${stubBinDir}:${process.env.PATH}`,
      HOME: tempHome,
      STUB_AGY_LOG_FILE: logFile,
    };
    delete runEnv.NTG_RUNNER_CHAIN;
    delete runEnv.NTG_SUPERVISOR_LEDGER;
    delete runEnv.NTG_SUPERVISOR_PID;

    const firstRun = spawnSync(binPath, [], {
      env: runEnv,
      encoding: 'utf8',
    });
    assert.equal(firstRun.status, 0, `first run of .bin/native-gravity failed: ${firstRun.stderr}`);

    // Verify live ~/.gemini and live HOME are never touched
    if (liveGeminiMtimeBefore !== null) {
      assert.equal(
        statSync(LIVE_GEMINI).mtimeMs,
        liveGeminiMtimeBefore,
        'live ~/.gemini mtime must not be modified'
      );
    } else {
      assert.ok(!existsSync(LIVE_GEMINI), 'live ~/.gemini must not have been created');
    }

    // Verify stub agy calls:
    // 1) --version
    // 2) plugin uninstall native-gravity
    // 3) plugin install <installedPkgRoot> (asserts plugin.json and package.json exist inside installedPkgRoot)
    // 4) plugin list --json (verification of plugin enabled status)
    const firstCalls = readAgyInvocations();
    assert.equal(firstCalls.length, 4, `expected 4 stub agy calls on first install, got ${firstCalls.length}`);
    assert.deepEqual(firstCalls[0].argv, ['--version']);
    assert.deepEqual(firstCalls[1].argv, ['plugin', 'uninstall', 'native-gravity']);
    assert.equal(firstCalls[2].argv[0], 'plugin');
    assert.equal(firstCalls[2].argv[1], 'install');
    const installedPkgRoot = firstCalls[2].argv[2];
    assert.ok(
      existsSync(join(installedPkgRoot, 'plugin.json')),
      `plugin.json must exist in installed package root: ${installedPkgRoot}`
    );
    assert.ok(
      existsSync(join(installedPkgRoot, 'package.json')),
      `package.json must exist in installed package root: ${installedPkgRoot}`
    );
    assert.deepEqual(firstCalls[3].argv, ['plugin', 'list', '--json']);

    // 6. Re-run .bin/native-gravity in the prefix to assert clean upgrade / re-run succeeds without error
    const secondRun = spawnSync(binPath, [], {
      env: runEnv,
      encoding: 'utf8',
    });
    assert.equal(secondRun.status, 0, `second run of .bin/native-gravity failed: ${secondRun.stderr}`);

    const allCalls = readAgyInvocations();
    assert.equal(allCalls.length, 8, `expected 8 total stub agy calls after upgrade re-run, got ${allCalls.length}`);
    assert.deepEqual(allCalls[4].argv, ['--version']);
    assert.deepEqual(allCalls[5].argv, ['plugin', 'uninstall', 'native-gravity']);
    assert.equal(allCalls[6].argv[0], 'plugin');
    assert.equal(allCalls[6].argv[1], 'install');
    assert.equal(allCalls[6].argv[2], installedPkgRoot);
    assert.deepEqual(allCalls[7].argv, ['plugin', 'list', '--json']);
  } finally {
    rmSync(tempPackDir, { recursive: true, force: true });
    rmSync(tempPrefix, { recursive: true, force: true });
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(stubBinDir, { recursive: true, force: true });
  }
});

test('npm pack --dry-run: files list contains expected packaged files', () => {
  const packRes = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(packRes.status, 0, `npm pack --dry-run failed: ${packRes.stderr}`);
  const parsed = JSON.parse(packRes.stdout);
  const data = Array.isArray(parsed) ? parsed[0] : (parsed['native-gravity'] || Object.values(parsed)[0]);
  assert.ok(data && Array.isArray(data.files), 'dry-run output must contain files array');
  const filePaths = data.files.map((f) => f.path);

  const expectedKeyFiles = [
    'scripts/npm-install.mjs',
    'scripts/install.sh',
    'scripts/install.ps1',
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

  for (const expected of expectedKeyFiles) {
    assert.ok(
      filePaths.includes(expected),
      `npm pack files list must include: ${expected}`
    );
  }
});

test('package.json metadata completeness: required fields are present and valid', () => {
  const pkgPath = join(REPO_ROOT, 'package.json');
  assert.ok(existsSync(pkgPath), 'package.json must exist');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  const requiredFields = [
    'name',
    'version',
    'description',
    'license',
    'type',
    'bin',
    'files',
    'engines',
    'keywords',
    'repository',
    'bugs',
    'homepage',
    'publishConfig',
  ];

  for (const field of requiredFields) {
    assert.ok(pkg[field] !== undefined, `package.json missing required metadata field: ${field}`);
  }

  assert.equal(pkg.name, 'native-gravity');
  assert.equal(pkg.version, '1.1.0');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'MIT');
  assert.equal(typeof pkg.bin, 'object');
  assert.equal(pkg.bin['native-gravity'], 'scripts/npm-install.mjs');
  assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0);
  assert.ok(pkg.engines && typeof pkg.engines.node === 'string');
  assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.length > 0);
  assert.ok(pkg.repository && typeof pkg.repository.url === 'string');
  assert.ok(pkg.bugs && typeof pkg.bugs.url === 'string');
  assert.ok(typeof pkg.homepage === 'string' && pkg.homepage.length > 0);
  assert.deepEqual(pkg.publishConfig, { access: 'public' });
});

test('relative markdown links: all target files exist relative to doc directory', () => {
  const docs = [
    'README.md',
    'docs/ko/README.md',
    'docs/usage.md',
    'docs/ko/usage.md',
  ];

  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let totalLinksChecked = 0;

  for (const docRel of docs) {
    const docPath = join(REPO_ROOT, docRel);
    assert.ok(existsSync(docPath), `Doc file must exist: ${docRel}`);
    const content = readFileSync(docPath, 'utf8');

    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      const linkTarget = match[2].trim();
      // Skip absolute URLs, mailto, and in-page hash-only anchors
      if (
        linkTarget.startsWith('http://') ||
        linkTarget.startsWith('https://') ||
        linkTarget.startsWith('mailto:') ||
        linkTarget.startsWith('#')
      ) {
        continue;
      }
      // Strip anchor portion (e.g. README.md#installation -> README.md)
      const targetWithoutAnchor = linkTarget.split('#')[0];
      if (!targetWithoutAnchor) {
        continue;
      }
      const resolvedTarget = resolve(dirname(docPath), targetWithoutAnchor);
      assert.ok(
        existsSync(resolvedTarget),
        `Broken relative link in ${docRel}: '${linkTarget}' resolved to non-existent path '${resolvedTarget}'`
      );
      totalLinksChecked++;
    }
  }

  assert.ok(totalLinksChecked > 0, `Expected to validate relative links, checked ${totalLinksChecked}`);
});

test('no export NTG: documentation files contain neither export NTG nor $NTG/', () => {
  const docs = [
    'README.md',
    'docs/ko/README.md',
    'docs/usage.md',
    'docs/ko/usage.md',
  ];

  for (const docRel of docs) {
    const docPath = join(REPO_ROOT, docRel);
    assert.ok(existsSync(docPath), `Doc file must exist: ${docRel}`);
    const content = readFileSync(docPath, 'utf8');

    assert.ok(
      !content.includes('export NTG'),
      `${docRel} contains forbidden string 'export NTG'`
    );
    assert.ok(
      !content.includes('$NTG/'),
      `${docRel} contains forbidden string '$NTG/'`
    );
  }
});

test('publish readiness evidence record: matches schema and dry-run pack output', () => {
  const evidencePath = join(REPO_ROOT, 'tests', 'publish-readiness-evidence.json');
  assert.ok(existsSync(evidencePath), `Evidence file must exist at ${evidencePath}`);

  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));

  assert.equal(evidence.package_name, 'native-gravity');
  assert.equal(evidence.version, '1.1.0');
  assert.ok(typeof evidence.registry_404_observation === 'string');
  assert.match(
    evidence.registry_404_observation,
    /npm package 'native-gravity' unclaimed \(404 Not Found\) observed on registry\.npmjs\.org on 2026-11-05 pre-lane; network_at_test_time=false/
  );
  assert.equal(evidence.package_metadata_complete, true);
  assert.ok(Array.isArray(evidence.npm_pack_dry_run_files));
  assert.ok(evidence.npm_pack_dry_run_files.length > 0);

  // Validate that key files are in the evidence record
  const keyFiles = [
    'scripts/npm-install.mjs',
    'scripts/install.sh',
    'scripts/install.ps1',
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

  for (const kf of keyFiles) {
    assert.ok(
      evidence.npm_pack_dry_run_files.includes(kf),
      `publish readiness record must list ${kf}`
    );
  }
});
