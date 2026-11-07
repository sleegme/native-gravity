import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
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
const SYNC_SCRIPT = join(REPO_ROOT, 'scripts', 'sync-version.mjs');
const PACKAGE_JSON_PATH = join(REPO_ROOT, 'package.json');
const RELEASE_CONFIG_PATH = join(REPO_ROOT, 'release-please-config.json');
const RELEASE_MANIFEST_PATH = join(REPO_ROOT, '.release-please-manifest.json');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'release-please.yml');
const CHANGELOG_PATH = join(REPO_ROOT, 'CHANGELOG.md');
const VERSIONING_DOC_PATH = join(REPO_ROOT, 'docs', 'versioning.md');
const VERSION_FILE_PATH = join(REPO_ROOT, 'VERSION');

const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
const CURRENT_VERSION = pkg.version;
const CURRENT_REF = `v${CURRENT_VERSION}`;

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
const BUMPED_VERSION = `${semver.major}.${semver.minor + 1}.0`;
const BUMPED_REF = `v${BUMPED_VERSION}`;

let yamlParse = null;
try {
  const yamlMod = await import('yaml');
  yamlParse = yamlMod.parse ?? yamlMod.default?.parse;
} catch {
  yamlParse = null;
}

function parseYamlSafely(raw) {
  if (yamlParse) {
    return yamlParse(raw);
  }
  // Basic structural fallback when yaml package is unavailable
  const doc = {};
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kvMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (kvMatch && !line.startsWith(' ')) {
      doc[kvMatch[1]] = kvMatch[2] || {};
    }
  }
  return doc;
}

function createFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), 'ntg-release-please-fixture-'));
  mkdirSync(join(tempDir, 'scripts'), { recursive: true });
  mkdirSync(join(tempDir, 'docs', 'ko'), { recursive: true });
  mkdirSync(join(tempDir, 'tests'), { recursive: true });

  const filesToCopy = [
    'package.json',
    '.release-please-manifest.json',
    'scripts/sync-version.mjs',
    'scripts/install.sh',
    'scripts/install.ps1',
    'README.md',
    'docs/ko/README.md',
    'docs/usage.md',
    'docs/status.md',
    'docs/ko/status.md',
    'tests/publish-readiness-evidence.json',
  ];

  for (const f of filesToCopy) {
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
      const scriptPath = join(tempDir, 'scripts', 'sync-version.mjs');
      return spawnSync(process.execPath, [scriptPath, '--root', tempDir, ...args], {
        encoding: 'utf8',
        cwd: tempDir,
      });
    },
  };
}

describe('release-please configuration (release-please-config.json)', () => {
  it('exists and is valid JSON', () => {
    assert.ok(existsSync(RELEASE_CONFIG_PATH), 'release-please-config.json must exist');
    const raw = readFileSync(RELEASE_CONFIG_PATH, 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw), 'release-please-config.json must be valid JSON');
  });

  it('configures package "." with release-type "node" and package-name "native-gravity"', () => {
    const config = JSON.parse(readFileSync(RELEASE_CONFIG_PATH, 'utf8'));
    assert.ok(config.packages && typeof config.packages === 'object', 'packages object required');
    const rootPkg = config.packages['.'];
    assert.ok(rootPkg, 'root package "." must be defined in packages');
    assert.equal(rootPkg['release-type'], 'node', 'release-type must be "node"');
    assert.equal(rootPkg['package-name'], 'native-gravity', 'package-name must be "native-gravity"');
    assert.equal(rootPkg['changelog-path'], 'CHANGELOG.md', 'changelog-path must be "CHANGELOG.md"');
  });

  it('includes tests/publish-readiness-evidence.json in extra-files', () => {
    const config = JSON.parse(readFileSync(RELEASE_CONFIG_PATH, 'utf8'));
    const rootPkg = config.packages['.'];
    assert.ok(Array.isArray(rootPkg['extra-files']), 'extra-files must be an array');
    const hasEvidenceFile = rootPkg['extra-files'].some(item => {
      if (typeof item === 'string') {
        return item === 'tests/publish-readiness-evidence.json';
      }
      if (item && typeof item === 'object') {
        return item.path === 'tests/publish-readiness-evidence.json';
      }
      return false;
    });
    assert.ok(hasEvidenceFile, 'extra-files must include "tests/publish-readiness-evidence.json"');
  });
});

describe('release-please manifest (.release-please-manifest.json)', () => {
  it('exists and is valid JSON', () => {
    assert.ok(existsSync(RELEASE_MANIFEST_PATH), '.release-please-manifest.json must exist');
    const raw = readFileSync(RELEASE_MANIFEST_PATH, 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw), '.release-please-manifest.json must be valid JSON');
  });

  it('manifest root package version matches dynamic package.json version', () => {
    const manifest = JSON.parse(readFileSync(RELEASE_MANIFEST_PATH, 'utf8'));
    assert.ok(manifest && typeof manifest === 'object', 'manifest must be an object');
    assert.equal(
      manifest['.'],
      CURRENT_VERSION,
      `.release-please-manifest.json root version (${manifest['.']}) must match package.json version (${CURRENT_VERSION})`
    );
  });
});

describe('release-please GitHub Actions workflow (.github/workflows/release-please.yml)', () => {
  it('exists and is valid YAML', () => {
    assert.ok(existsSync(WORKFLOW_PATH), '.github/workflows/release-please.yml must exist');
    const raw = readFileSync(WORKFLOW_PATH, 'utf8');
    const doc = parseYamlSafely(raw);
    assert.ok(doc && typeof doc === 'object', 'workflow must parse as a valid YAML object');
  });

  it('triggers on push to main branch', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf8');
    const doc = parseYamlSafely(raw);
    if (yamlParse) {
      assert.ok(doc.on && doc.on.push, 'workflow must trigger on push');
      const branches = Array.isArray(doc.on.push.branches) ? doc.on.push.branches : [doc.on.push.branches];
      assert.ok(branches.includes('main'), 'workflow push trigger must include "main"');
    } else {
      assert.match(raw, /on:\s*\n\s+push:\s*\n\s+branches:\s*\n\s+-\s+main/);
    }
  });

  it('grants write permissions for contents and pull-requests', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf8');
    const doc = parseYamlSafely(raw);
    if (yamlParse) {
      const perms = doc.permissions ?? {};
      assert.equal(perms['contents'], 'write', 'permissions.contents must be write');
      assert.equal(perms['pull-requests'], 'write', 'permissions.pull-requests must be write');
    } else {
      assert.match(raw, /contents:\s*write/);
      assert.match(raw, /pull-requests:\s*write/);
    }
  });

  it('uses googleapis/release-please-action', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf8');
    const doc = parseYamlSafely(raw);
    if (yamlParse && doc.jobs) {
      const steps = Object.values(doc.jobs).flatMap(j => j.steps || []);
      const rpaStep = steps.find(s => typeof s.uses === 'string' && s.uses.startsWith('googleapis/release-please-action'));
      assert.ok(rpaStep, 'workflow must contain a step using googleapis/release-please-action');
    } else {
      assert.match(raw, /uses:\s*googleapis\/release-please-action/);
    }
  });

  it('contains NO npm publish commands and NO npm tokens', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf8');
    assert.doesNotMatch(raw, /\bnpm\s+publish\b/, 'workflow must not contain npm publish');
    assert.doesNotMatch(raw, /\bNODE_AUTH_TOKEN\b/, 'workflow must not contain NODE_AUTH_TOKEN');
    assert.doesNotMatch(raw, /\bNPM_TOKEN\b/, 'workflow must not contain NPM_TOKEN');
  });

  it('contains post-bump version sync step "node scripts/sync-version.mjs"', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf8');
    const doc = parseYamlSafely(raw);
    if (yamlParse && doc.jobs) {
      const steps = Object.values(doc.jobs).flatMap(j => j.steps || []);
      const syncStep = steps.find(s => typeof s.run === 'string' && s.run.includes('node scripts/sync-version.mjs'));
      assert.ok(syncStep, 'workflow must contain post-bump sync step executing "node scripts/sync-version.mjs"');
    } else {
      assert.match(raw, /node\s+scripts\/sync-version\.mjs/);
    }
  });
});

describe('CHANGELOG.md baseline and convention', () => {
  it('exists and contains valid markdown heading and conventional commits reference', () => {
    assert.ok(existsSync(CHANGELOG_PATH), 'CHANGELOG.md must exist');
    const content = readFileSync(CHANGELOG_PATH, 'utf8');
    assert.match(content, /^#\s+Changelog\b/m, 'CHANGELOG.md must contain top-level markdown heading "# Changelog"');
    assert.match(
      content,
      /conventionalcommits\.org|conventional\s+commits/i,
      'CHANGELOG.md must reference Conventional Commits'
    );
  });
});

describe('docs/versioning.md policy and lifecycle contract', () => {
  it('specifies package.json as canonical source of truth and no VERSION file', () => {
    assert.ok(!existsSync(VERSION_FILE_PATH), 'VERSION file must not exist; package.json is the only version source');
    assert.ok(existsSync(VERSIONING_DOC_PATH), 'docs/versioning.md must exist');
    const content = readFileSync(VERSIONING_DOC_PATH, 'utf8');
    assert.match(content, /package\.json/, 'must name package.json');
    assert.match(content, /Canonical Version Source of Truth/i, 'must contain canonical source of truth section');
    assert.doesNotMatch(
      content,
      /(?:source of truth is|canonical source is|stored in)[^.\n]*\bVERSION\b(?!\.(?:md|json))/i,
      'must not specify a VERSION file as source of truth'
    );
  });

  it('defines MAJOR, MINOR, and PATCH with exact specified meanings', () => {
    const content = readFileSync(VERSIONING_DOC_PATH, 'utf8');
    assert.match(
      content,
      /\bMAJOR\b[\s\S]*?user must change something/i,
      'MAJOR must mean "user must change something"'
    );
    assert.match(
      content,
      /\bMINOR\b[\s\S]*?new capability/i,
      'MINOR must mean "new capability"'
    );
    assert.match(
      content,
      /\bPATCH\b[\s\S]*?works as intended/i,
      'PATCH must mean "works as intended"'
    );
  });

  it('documents release steps: merge release PR -> owner runs npm publish with web approval', () => {
    const content = readFileSync(VERSIONING_DOC_PATH, 'utf8');
    assert.match(content, /merge.*release PR/i, 'must document reviewing and merging the release PR');
    assert.match(content, /npm publish.*web approval/i, 'must document owner running npm publish with web approval');
    assert.match(content, /manual/i, 'must document manual owner approval step');
  });
});

describe('release-please version-bump path verification in isolated fixture', () => {
  it('detects drift after version bump and cleanly syncs all pinned copies', () => {
    assert.notEqual(BUMPED_VERSION, CURRENT_VERSION, 'bumped version must differ from current');
    assert.notEqual(BUMPED_REF, CURRENT_REF, 'bumped ref must differ from current');

    const fixture = createFixture();
    try {
      // 1. Verify clean fixture exits 0 before any bump
      const initialCheck = fixture.runSync(['--check']);
      assert.equal(initialCheck.status, 0, `initial clean fixture check failed: ${initialCheck.stderr || initialCheck.stdout}`);

      // 2. Simulate release-please version bump:
      // Update package.json and .release-please-manifest.json to BUMPED_VERSION
      const fixturePkg = JSON.parse(fixture.readFile('package.json'));
      fixturePkg.version = BUMPED_VERSION;
      fixture.writeFile('package.json', JSON.stringify(fixturePkg, null, 2) + '\n');

      const fixtureManifest = JSON.parse(fixture.readFile('.release-please-manifest.json'));
      fixtureManifest['.'] = BUMPED_VERSION;
      fixture.writeFile('.release-please-manifest.json', JSON.stringify(fixtureManifest, null, 2) + '\n');

      // 3. Verify node scripts/sync-version.mjs --check --root <tmpDir> exits non-zero (drift detected before sync)
      const driftCheck = fixture.runSync(['--check']);
      assert.notEqual(
        driftCheck.status,
        0,
        'sync-version --check must exit non-zero when package.json version is bumped before sync'
      );

      // 4. Run post-bump sync step: node scripts/sync-version.mjs --root <tmpDir>
      const syncRun = fixture.runSync([]);
      assert.equal(
        syncRun.status,
        0,
        `post-bump sync step failed: ${syncRun.stderr || syncRun.stdout}`
      );

      // 5. Verify node scripts/sync-version.mjs --check --root <tmpDir> exits 0
      const postSyncCheck = fixture.runSync(['--check']);
      assert.equal(
        postSyncCheck.status,
        0,
        `post-sync check must exit 0: ${postSyncCheck.stderr || postSyncCheck.stdout}`
      );

      // 6. Verify contents of synced files and manifest
      const updatedManifest = JSON.parse(fixture.readFile('.release-please-manifest.json'));
      assert.equal(updatedManifest['.'], BUMPED_VERSION);

      const updatedEvidence = JSON.parse(fixture.readFile('tests/publish-readiness-evidence.json'));
      assert.equal(updatedEvidence.version, BUMPED_VERSION);

      const installSh = fixture.readFile('scripts/install.sh');
      assert.ok(installSh.includes(BUMPED_REF), `install.sh must contain ${BUMPED_REF}`);
      assert.ok(!installSh.includes(CURRENT_REF), `install.sh must not contain ${CURRENT_REF}`);

      const installPs1 = fixture.readFile('scripts/install.ps1');
      assert.ok(installPs1.includes(BUMPED_REF), `install.ps1 must contain ${BUMPED_REF}`);
      assert.ok(!installPs1.includes(CURRENT_REF), `install.ps1 must not contain ${CURRENT_REF}`);

      const readme = fixture.readFile('README.md');
      assert.ok(readme.includes(BUMPED_REF), `README.md must contain ${BUMPED_REF}`);

      const koReadme = fixture.readFile('docs/ko/README.md');
      assert.ok(koReadme.includes(BUMPED_REF), `docs/ko/README.md must contain ${BUMPED_REF}`);

      const usage = fixture.readFile('docs/usage.md');
      assert.ok(usage.includes(BUMPED_REF), `docs/usage.md must contain ${BUMPED_REF}`);

      const status = fixture.readFile('docs/status.md');
      assert.ok(status.includes(`**Native Gravity**: ${BUMPED_VERSION}`), 'docs/status.md must show the synced version');

      const koStatus = fixture.readFile('docs/ko/status.md');
      assert.ok(koStatus.includes(`**Native Gravity**: ${BUMPED_VERSION}`), 'docs/ko/status.md must show the synced version');
    } finally {
      fixture.cleanup();
    }
  });
});
