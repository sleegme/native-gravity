#!/usr/bin/env node

/**
 * Native Gravity Version Sync CLI
 *
 * Keeps pinned release version copies in sync with package.json:
 * - scripts/install.sh (raw GitHub URLs, REF default)
 * - scripts/install.ps1 (raw GitHub URLs, $ref default)
 * - README.md (curl and irm command URLs)
 * - docs/ko/README.md (curl and irm command URLs)
 * - docs/usage.md (curl and irm command URLs)
 * - docs/status.md and docs/ko/status.md ("Native Gravity" header)
 * - tests/publish-readiness-evidence.json ("version" field)
 *
 * Usage:
 *   node scripts/sync-version.mjs [--check] [--root <dir>]
 */

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function getSpecs(version) {
  return [
    {
      file: 'scripts/install.sh',
      rules: [
        {
          name: 'install.sh header URLs',
          regex: /(https:\/\/raw\.githubusercontent\.com\/sleegme\/native-gravity\/)v[0-9A-Za-z_.-]+(\/scripts\/install\.sh)/g,
          expectedCount: 3,
          replace: `$1v${version}$2`,
        },
        {
          name: 'install.sh REF default',
          regex: /(REF="\$\{NATIVE_GRAVITY_REF:-)v[0-9A-Za-z_.-]+(\}")/g,
          expectedCount: 1,
          replace: `$1v${version}$2`,
        },
      ],
    },
    {
      file: 'scripts/install.ps1',
      rules: [
        {
          name: 'install.ps1 header URLs',
          regex: /(https:\/\/raw\.githubusercontent\.com\/sleegme\/native-gravity\/)v[0-9A-Za-z_.-]+(\/scripts\/install\.ps1)/g,
          expectedCount: 3,
          replace: `$1v${version}$2`,
        },
        {
          name: 'install.ps1 ref default',
          regex: /(\$ref\s*=\s*if\s*\(\$env:NATIVE_GRAVITY_REF\)\s*\{\s*\$env:NATIVE_GRAVITY_REF\s*\}\s*else\s*\{\s*')v[0-9A-Za-z_.-]+('\s*\})/g,
          expectedCount: 1,
          replace: `$1v${version}$2`,
        },
      ],
    },
    {
      file: 'README.md',
      rules: [
        {
          name: 'README.md install.sh URL',
          regex: /(https:\/\/raw\.githubusercontent\.com\/sleegme\/native-gravity\/)v[0-9A-Za-z_.-]+(\/scripts\/install\.sh)/g,
          expectedCount: 1,
          replace: `$1v${version}$2`,
        },
        {
          name: 'README.md install.ps1 URL',
          regex: /(https:\/\/raw\.githubusercontent\.com\/sleegme\/native-gravity\/)v[0-9A-Za-z_.-]+(\/scripts\/install\.ps1)/g,
          expectedCount: 1,
          replace: `$1v${version}$2`,
        },
      ],
    },
    {
      file: 'docs/ko/README.md',
      rules: [
        {
          name: 'docs/ko/README.md install.sh URL',
          regex: /(https:\/\/raw\.githubusercontent\.com\/sleegme\/native-gravity\/)v[0-9A-Za-z_.-]+(\/scripts\/install\.sh)/g,
          expectedCount: 1,
          replace: `$1v${version}$2`,
        },
        {
          name: 'docs/ko/README.md install.ps1 URL',
          regex: /(https:\/\/raw\.githubusercontent\.com\/sleegme\/native-gravity\/)v[0-9A-Za-z_.-]+(\/scripts\/install\.ps1)/g,
          expectedCount: 1,
          replace: `$1v${version}$2`,
        },
      ],
    },
    {
      file: 'docs/usage.md',
      rules: [
        {
          name: 'docs/usage.md install.sh URL',
          regex: /(https:\/\/raw\.githubusercontent\.com\/sleegme\/native-gravity\/)v[0-9A-Za-z_.-]+(\/scripts\/install\.sh)/g,
          expectedCount: 1,
          replace: `$1v${version}$2`,
        },
        {
          name: 'docs/usage.md install.ps1 URL',
          regex: /(https:\/\/raw\.githubusercontent\.com\/sleegme\/native-gravity\/)v[0-9A-Za-z_.-]+(\/scripts\/install\.ps1)/g,
          expectedCount: 1,
          replace: `$1v${version}$2`,
        },
      ],
    },
    {
      file: 'docs/status.md',
      rules: [
        {
          name: 'docs/status.md Native Gravity version',
          regex: /(- \*\*Native Gravity\*\*: )[0-9A-Za-z_.-]+/g,
          expectedCount: 1,
          replace: `$1${version}`,
        },
      ],
    },
    {
      file: 'docs/ko/status.md',
      rules: [
        {
          name: 'docs/ko/status.md Native Gravity version',
          regex: /(- \*\*Native Gravity\*\*: )[0-9A-Za-z_.-]+/g,
          expectedCount: 1,
          replace: `$1${version}`,
        },
      ],
    },
    {
      file: 'tests/publish-readiness-evidence.json',
      rules: [
        {
          name: 'publish-readiness-evidence.json version',
          regex: /("version":\s*")[0-9A-Za-z_.-]+(")/g,
          expectedCount: 1,
          replace: `$1${version}$2`,
        },
      ],
    },
  ];
}

export function syncVersion({ root = repoRoot, check = false } = {}) {
  const pkgPath = resolve(root, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found in root: ${root}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const version = pkg.version;
  if (!version || typeof version !== 'string') {
    throw new Error(`package.json in ${root} does not contain a valid version: ${pkg.version}`);
  }

  const specs = getSpecs(version);
  const drifted = [];
  const updated = [];
  const missingPins = [];

  for (const spec of specs) {
    const filePath = resolve(root, spec.file);
    if (!existsSync(filePath)) {
      drifted.push({ file: spec.file, reason: `File not found: ${spec.file}` });
      continue;
    }

    const originalContent = readFileSync(filePath, 'utf8');
    let currentContent = originalContent;
    let fileHasMissingPins = false;

    for (const rule of spec.rules) {
      const matches = currentContent.match(rule.regex) || [];
      if (matches.length !== rule.expectedCount) {
        missingPins.push({
          file: spec.file,
          rule: rule.name,
          expected: rule.expectedCount,
          actual: matches.length,
        });
        fileHasMissingPins = true;
      }
      currentContent = currentContent.replace(rule.regex, rule.replace);
    }

    if (fileHasMissingPins || currentContent !== originalContent) {
      drifted.push({
        file: spec.file,
        reason: fileHasMissingPins
          ? `Missing or malformed pinned pattern(s)`
          : `Version mismatch against package.json (${version})`,
      });
    }

    if (!check && currentContent !== originalContent) {
      writeFileSync(filePath, currentContent, 'utf8');
      updated.push(spec.file);
    }
  }

  const ok = drifted.length === 0 && missingPins.length === 0;
  return {
    ok,
    version,
    drifted,
    updated,
    missingPins,
  };
}

export function parseArgs(argv) {
  let check = false;
  let root = repoRoot;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') {
      check = true;
    } else if (arg === '--root') {
      if (i + 1 >= argv.length) {
        throw new Error('--root requires a directory argument');
      }
      root = resolve(process.cwd(), argv[++i]);
    } else if (arg.startsWith('--root=')) {
      root = resolve(process.cwd(), arg.slice('--root='.length));
    } else if (arg === '-h' || arg === '--help') {
      return { help: true };
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { check, root };
}

export function printUsage(stream = process.stdout) {
  stream.write(`Native Gravity Version Sync CLI

Usage:
  node scripts/sync-version.mjs [options]

Options:
  --check        Check that all pinned copies match package.json version (exit 0 if synced, non-zero if drifted)
  --root <dir>   Repository root directory (defaults to current repository)
  -h, --help     Show this help message
`);
}

export function runCli(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    stderr.write(`Error: ${err.message}\n`);
    printUsage(stderr);
    return 1;
  }

  if (opts.help) {
    printUsage(stdout);
    return 0;
  }

  try {
    const res = syncVersion({ root: opts.root, check: opts.check });
    if (opts.check) {
      if (res.ok) {
        stdout.write(`All pinned version references match package.json (${res.version}).\n`);
        return 0;
      }
      stderr.write(`Version check failed: pinned copies have drifted from package.json (${res.version}):\n`);
      for (const d of res.drifted) {
        stderr.write(`  - ${d.file}: ${d.reason}\n`);
      }
      for (const m of res.missingPins) {
        stderr.write(`  - ${m.file} [${m.rule}]: expected ${m.expected} matches, found ${m.actual}\n`);
      }
      return 1;
    }

    if (res.missingPins.length > 0) {
      stderr.write(`Sync warning: some pinned patterns were missing:\n`);
      for (const m of res.missingPins) {
        stderr.write(`  - ${m.file} [${m.rule}]: expected ${m.expected} matches, found ${m.actual}\n`);
      }
      return 1;
    }

    if (res.updated.length > 0) {
      stdout.write(`Synced ${res.updated.length} file(s) to package.json version ${res.version}:\n`);
      for (const f of res.updated) {
        stdout.write(`  - ${f}\n`);
      }
    } else {
      stdout.write(`All pinned version references are already up to date (${res.version}).\n`);
    }
    return 0;
  } catch (err) {
    stderr.write(`Error: ${err.message}\n`);
    return 1;
  }
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  const code = runCli(process.argv.slice(2));
  process.exit(code);
}
