import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
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
const SYNC_SCRIPT = join(REPO_ROOT, 'scripts', 'sync-version.mjs');
const PACKAGE_JSON_PATH = join(REPO_ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
const CURRENT_VERSION = pkg.version;
const CURRENT_REF = `v${CURRENT_VERSION}`;

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSemVer(v) {
  const match = String(v).match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) {
    throw new Error(`Invalid semver format: ${v}`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || '',
  };
}

const semver = parseSemVer(CURRENT_VERSION);
// Synthetic bumped version (increments minor, resets patch to 0)
const BUMPED_VERSION = `${semver.major}.${semver.minor + 1}.0`;
const BUMPED_REF = `v${BUMPED_VERSION}`;

// Synthetic drift version (large delta guaranteed distinct from both CURRENT_VERSION and BUMPED_VERSION)
const DRIFT_VERSION = `${semver.major + 100}.${semver.minor + 100}.${semver.patch + 100}`;
const DRIFT_REF = `v${DRIFT_VERSION}`;

function replaceNthOccurrence(str, search, replacement, n = 1) {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(search, pos)) !== -1) {
    count++;
    if (count === n) {
      return str.slice(0, pos) + replacement + str.slice(pos + search.length);
    }
    pos += search.length;
  }
  return str;
}

function runSync(args = []) {
  return spawnSync(process.execPath, [SYNC_SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
}

function createFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), 'ntg-sync-version-fixture-'));
  mkdirSync(join(tempDir, 'scripts'), { recursive: true });
  mkdirSync(join(tempDir, 'docs', 'ko'), { recursive: true });
  mkdirSync(join(tempDir, 'tests'), { recursive: true });

  const files = [
    'package.json',
    'scripts/install.sh',
    'scripts/install.ps1',
    'README.md',
    'docs/ko/README.md',
    'docs/usage.md',
    'docs/status.md',
    'docs/ko/status.md',
    'tests/publish-readiness-evidence.json',
  ];

  for (const f of files) {
    cpSync(join(REPO_ROOT, f), join(tempDir, f));
  }

  return {
    tempDir,
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
    readFile(relPath) {
      return readFileSync(join(tempDir, relPath), 'utf8');
    },
    writeFile(relPath, content) {
      writeFileSync(join(tempDir, relPath), content, 'utf8');
    },
    runSync(args = []) {
      return spawnSync(process.execPath, [SYNC_SCRIPT, '--root', tempDir, ...args], {
        encoding: 'utf8',
        cwd: tempDir,
      });
    },
  };
}

test('sync-version --check exits 0 on current repository tree', () => {
  const res = runSync(['--check']);
  assert.equal(res.status, 0, `sync-version --check failed: ${res.stderr || res.stdout}`);
  assert.match(res.stdout, /All pinned version references match package\.json/);
});

test('sync-version --help exits 0 and prints usage', () => {
  const res = runSync(['--help']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Usage:/);
});

test('sync-version unknown argument exits non-zero', () => {
  const res = runSync(['--unrecognized-flag']);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Unknown option: --unrecognized-flag/);
});

test('sync-version --check on clean isolated fixture exits 0', () => {
  const fixture = createFixture();
  try {
    const res = fixture.runSync(['--check']);
    assert.equal(res.status, 0, `Unexpected failure: ${res.stderr}`);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 1: scripts/install.sh header URL occurrence 1
test('altering install.sh header URL occurrence 1 causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('scripts/install.sh');
    const target = `https://raw.githubusercontent.com/sleegme/native-gravity/${CURRENT_REF}/scripts/install.sh`;
    const replacement = `https://raw.githubusercontent.com/sleegme/native-gravity/${DRIFT_REF}/scripts/install.sh`;
    const altered = replaceNthOccurrence(original, target, replacement, 1);
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('scripts/install.sh', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /scripts\/install\.sh/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 2: scripts/install.sh header URL occurrence 2
test('altering install.sh header URL occurrence 2 causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('scripts/install.sh');
    const target = `https://raw.githubusercontent.com/sleegme/native-gravity/${CURRENT_REF}/scripts/install.sh`;
    const replacement = `https://raw.githubusercontent.com/sleegme/native-gravity/${DRIFT_REF}/scripts/install.sh`;
    const altered = replaceNthOccurrence(original, target, replacement, 2);
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('scripts/install.sh', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /scripts\/install\.sh/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 3: scripts/install.sh header URL occurrence 3
test('altering install.sh header URL occurrence 3 causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('scripts/install.sh');
    const target = `https://raw.githubusercontent.com/sleegme/native-gravity/${CURRENT_REF}/scripts/install.sh`;
    const replacement = `https://raw.githubusercontent.com/sleegme/native-gravity/${DRIFT_REF}/scripts/install.sh`;
    const altered = replaceNthOccurrence(original, target, replacement, 3);
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('scripts/install.sh', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /scripts\/install\.sh/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 4: scripts/install.sh REF default
test('altering install.sh REF default causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('scripts/install.sh');
    const altered = original.replace(
      `REF="\${NATIVE_GRAVITY_REF:-${CURRENT_REF}}"`,
      `REF="\${NATIVE_GRAVITY_REF:-${DRIFT_REF}}"`
    );
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('scripts/install.sh', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /scripts\/install\.sh/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 5: scripts/install.ps1 header URL occurrence 1
test('altering install.ps1 header URL occurrence 1 causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('scripts/install.ps1');
    const target = `https://raw.githubusercontent.com/sleegme/native-gravity/${CURRENT_REF}/scripts/install.ps1`;
    const replacement = `https://raw.githubusercontent.com/sleegme/native-gravity/${DRIFT_REF}/scripts/install.ps1`;
    const altered = replaceNthOccurrence(original, target, replacement, 1);
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('scripts/install.ps1', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /scripts\/install\.ps1/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 6: scripts/install.ps1 header URL occurrence 2
test('altering install.ps1 header URL occurrence 2 causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('scripts/install.ps1');
    const target = `https://raw.githubusercontent.com/sleegme/native-gravity/${CURRENT_REF}/scripts/install.ps1`;
    const replacement = `https://raw.githubusercontent.com/sleegme/native-gravity/${DRIFT_REF}/scripts/install.ps1`;
    const altered = replaceNthOccurrence(original, target, replacement, 2);
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('scripts/install.ps1', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /scripts\/install\.ps1/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 7: scripts/install.ps1 header URL occurrence 3
test('altering install.ps1 header URL occurrence 3 causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('scripts/install.ps1');
    const target = `https://raw.githubusercontent.com/sleegme/native-gravity/${CURRENT_REF}/scripts/install.ps1`;
    const replacement = `https://raw.githubusercontent.com/sleegme/native-gravity/${DRIFT_REF}/scripts/install.ps1`;
    const altered = replaceNthOccurrence(original, target, replacement, 3);
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('scripts/install.ps1', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /scripts\/install\.ps1/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 8: scripts/install.ps1 ref default
test('altering install.ps1 ref default causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('scripts/install.ps1');
    const altered = original.replace(
      `$ref = if ($env:NATIVE_GRAVITY_REF) { $env:NATIVE_GRAVITY_REF } else { '${CURRENT_REF}' }`,
      `$ref = if ($env:NATIVE_GRAVITY_REF) { $env:NATIVE_GRAVITY_REF } else { '${DRIFT_REF}' }`
    );
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('scripts/install.ps1', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /scripts\/install\.ps1/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 9: README.md install.sh URL
test('altering README.md install.sh URL causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('README.md');
    const altered = original.replace(
      `https://raw.githubusercontent.com/sleegme/native-gravity/${CURRENT_REF}/scripts/install.sh`,
      `https://raw.githubusercontent.com/sleegme/native-gravity/${DRIFT_REF}/scripts/install.sh`
    );
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('README.md', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /README\.md/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 10: README.md install.ps1 URL
test('altering README.md install.ps1 URL causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('README.md');
    const altered = original.replace(
      `https://raw.githubusercontent.com/sleegme/native-gravity/${CURRENT_REF}/scripts/install.ps1`,
      `https://raw.githubusercontent.com/sleegme/native-gravity/${DRIFT_REF}/scripts/install.ps1`
    );
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('README.md', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /README\.md/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 11: docs/ko/README.md install.sh URL
test('altering docs/ko/README.md install.sh URL causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('docs/ko/README.md');
    const altered = original.replace(
      `https://raw.githubusercontent.com/sleegme/native-gravity/${CURRENT_REF}/scripts/install.sh`,
      `https://raw.githubusercontent.com/sleegme/native-gravity/${DRIFT_REF}/scripts/install.sh`
    );
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('docs/ko/README.md', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /docs\/ko\/README\.md/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 12: docs/ko/README.md install.ps1 URL
test('altering docs/ko/README.md install.ps1 URL causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('docs/ko/README.md');
    const altered = original.replace(
      `https://raw.githubusercontent.com/sleegme/native-gravity/${CURRENT_REF}/scripts/install.ps1`,
      `https://raw.githubusercontent.com/sleegme/native-gravity/${DRIFT_REF}/scripts/install.ps1`
    );
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('docs/ko/README.md', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /docs\/ko\/README\.md/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy: docs/usage.md "Current release" line
test('altering docs/usage.md current release line causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('docs/usage.md');
    const altered = original.replace(
      `Current release: version ${CURRENT_VERSION},`,
      `Current release: version ${DRIFT_VERSION},`
    );
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('docs/usage.md', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /docs\/usage\.md/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 13: docs/usage.md install.sh URL
test('altering docs/usage.md install.sh URL causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('docs/usage.md');
    const altered = original.replace(
      `https://raw.githubusercontent.com/sleegme/native-gravity/${CURRENT_REF}/scripts/install.sh`,
      `https://raw.githubusercontent.com/sleegme/native-gravity/${DRIFT_REF}/scripts/install.sh`
    );
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('docs/usage.md', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /docs\/usage\.md/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 14: docs/usage.md install.ps1 URL
test('altering docs/usage.md install.ps1 URL causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('docs/usage.md');
    const altered = original.replace(
      `https://raw.githubusercontent.com/sleegme/native-gravity/${CURRENT_REF}/scripts/install.ps1`,
      `https://raw.githubusercontent.com/sleegme/native-gravity/${DRIFT_REF}/scripts/install.ps1`
    );
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('docs/usage.md', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /docs\/usage\.md/);
  } finally {
    fixture.cleanup();
  }
});

// Pinned copy 15: tests/publish-readiness-evidence.json version field
test('altering tests/publish-readiness-evidence.json causes --check to exit non-zero', () => {
  const fixture = createFixture();
  try {
    const original = fixture.readFile('tests/publish-readiness-evidence.json');
    const altered = original.replace(`"version": "${CURRENT_VERSION}"`, `"version": "${DRIFT_VERSION}"`);
    assert.notEqual(original, altered, 'pattern must be replaced in fixture');
    fixture.writeFile('tests/publish-readiness-evidence.json', altered);

    const res = fixture.runSync(['--check']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /tests\/publish-readiness-evidence\.json/);
  } finally {
    fixture.cleanup();
  }
});

test('running sync-version updates all pinned copies when package.json version changes', () => {
  const fixture = createFixture();
  try {
    // Bump version in fixture's package.json to BUMPED_VERSION
    const fixturePkg = JSON.parse(fixture.readFile('package.json'));
    fixturePkg.version = BUMPED_VERSION;
    fixture.writeFile('package.json', JSON.stringify(fixturePkg, null, 2) + '\n');

    // Pre-check should detect drift
    const preCheck = fixture.runSync(['--check']);
    assert.notEqual(preCheck.status, 0);

    // Run sync-version without --check to perform update
    const syncRes = fixture.runSync([]);
    assert.equal(syncRes.status, 0, `sync-version update failed: ${syncRes.stderr}`);
    assert.match(syncRes.stdout, new RegExp(`Synced 8 file\\(s\\) to package\\.json version ${escapeRegExp(BUMPED_VERSION)}`));

    // Post-check should now succeed
    const postCheck = fixture.runSync(['--check']);
    assert.equal(postCheck.status, 0, `post-sync --check failed: ${postCheck.stderr}`);

    // Verify install.sh content
    const installSh = fixture.readFile('scripts/install.sh');
    assert.ok(
      installSh.includes(`https://raw.githubusercontent.com/sleegme/native-gravity/${BUMPED_REF}/scripts/install.sh`),
      `install.sh header URL must be ${BUMPED_REF}`
    );
    assert.ok(
      installSh.includes(`REF="\${NATIVE_GRAVITY_REF:-${BUMPED_REF}}"`),
      `install.sh REF default must be ${BUMPED_REF}`
    );
    assert.ok(!installSh.includes(CURRENT_REF), `install.sh must have no ${CURRENT_REF} left`);

    // Verify install.ps1 content
    const installPs1 = fixture.readFile('scripts/install.ps1');
    assert.ok(
      installPs1.includes(`https://raw.githubusercontent.com/sleegme/native-gravity/${BUMPED_REF}/scripts/install.ps1`),
      `install.ps1 header URL must be ${BUMPED_REF}`
    );
    assert.ok(
      installPs1.includes(`$ref = if ($env:NATIVE_GRAVITY_REF) { $env:NATIVE_GRAVITY_REF } else { '${BUMPED_REF}' }`),
      `install.ps1 ref default must be ${BUMPED_REF}`
    );
    assert.ok(!installPs1.includes(CURRENT_REF), `install.ps1 must have no ${CURRENT_REF} left`);

    // Verify README.md
    const readme = fixture.readFile('README.md');
    assert.ok(readme.includes(`/${BUMPED_REF}/scripts/install.sh`));
    assert.ok(readme.includes(`/${BUMPED_REF}/scripts/install.ps1`));
    assert.ok(!readme.includes(CURRENT_REF));

    // Verify docs/ko/README.md
    const koReadme = fixture.readFile('docs/ko/README.md');
    assert.ok(koReadme.includes(`/${BUMPED_REF}/scripts/install.sh`));
    assert.ok(koReadme.includes(`/${BUMPED_REF}/scripts/install.ps1`));
    assert.ok(!koReadme.includes(CURRENT_REF));

    // Verify docs/usage.md
    const usage = fixture.readFile('docs/usage.md');
    assert.ok(usage.includes(`/${BUMPED_REF}/scripts/install.sh`));
    assert.ok(usage.includes(`/${BUMPED_REF}/scripts/install.ps1`));
    assert.ok(!usage.includes(CURRENT_REF));

    // Verify tests/publish-readiness-evidence.json
    const evidence = JSON.parse(fixture.readFile('tests/publish-readiness-evidence.json'));
    assert.equal(evidence.version, BUMPED_VERSION);

    // Verify status headers
    for (const statusPath of ['docs/status.md', 'docs/ko/status.md']) {
      const status = fixture.readFile(statusPath);
      assert.ok(
        status.includes(`**Native Gravity**: ${BUMPED_VERSION}`),
        `${statusPath} must show ${BUMPED_VERSION}`
      );
      assert.ok(
        !status.includes(`**Native Gravity**: ${CURRENT_VERSION}`),
        `${statusPath} must have no stale ${CURRENT_VERSION} header`
      );
    }
  } finally {
    fixture.cleanup();
  }
});

test('bumping package.json and running sync-version satisfies installer and evidence assertions with no collision', () => {
  // Ensure synthetic bump version is distinct from current version
  assert.notEqual(BUMPED_VERSION, CURRENT_VERSION, 'bumped version must differ from current version');
  assert.notEqual(BUMPED_REF, CURRENT_REF, 'bumped ref must differ from current ref');
  assert.notEqual(DRIFT_VERSION, CURRENT_VERSION, 'drift version must differ from current version');
  assert.notEqual(DRIFT_VERSION, BUMPED_VERSION, 'drift version must differ from bumped version');

  const fixture = createFixture();
  try {
    const fixturePkg = JSON.parse(fixture.readFile('package.json'));
    fixturePkg.version = BUMPED_VERSION;
    fixture.writeFile('package.json', JSON.stringify(fixturePkg, null, 2) + '\n');

    // Run sync-version
    const syncRes = fixture.runSync([]);
    assert.equal(syncRes.status, 0);

    // Verify installer assertion matches against updated install.sh
    const installShContent = fixture.readFile('scripts/install.sh');
    assert.match(
      installShContent,
      new RegExp(`https://raw\\.githubusercontent\\.com/sleegme/native-gravity/${escapeRegExp(BUMPED_REF)}/scripts/install\\.sh`),
      `must document ${BUMPED_REF} raw URL in install.sh`
    );

    // Verify installer assertion matches against updated install.ps1
    const installPs1Content = fixture.readFile('scripts/install.ps1');
    assert.match(
      installPs1Content,
      new RegExp(`https://raw\\.githubusercontent\\.com/sleegme/native-gravity/${escapeRegExp(BUMPED_REF)}/scripts/install\\.ps1`),
      `must document ${BUMPED_REF} raw URL in install.ps1`
    );

    // Verify evidence record assertion matches package.json version
    const evidence = JSON.parse(fixture.readFile('tests/publish-readiness-evidence.json'));
    const updatedPkg = JSON.parse(fixture.readFile('package.json'));
    assert.equal(evidence.package_name, 'native-gravity');
    assert.equal(evidence.version, updatedPkg.version);
    assert.equal(evidence.version, BUMPED_VERSION);
  } finally {
    fixture.cleanup();
  }
});
