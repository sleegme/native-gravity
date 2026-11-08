import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { capLines, resolveMaxLines } from '../scripts/snap-common.mjs';
import { main, renderStateSnap } from '../scripts/state-snap.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'scripts', 'state-snap.mjs');
const FIXTURE = join(HERE, 'fixtures', 'state-snap', 'sample.ledger.json');

function run(args, opts = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...opts });
}

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NTG_LEDGER;
  delete env.NTG_SNAP_MAX_LINES;
  return env;
}

/** Recursive [relPath, size, mtimeMs, mode] listing; used for the zero-write proof. */
function snapshotTree(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      const st = statSync(full);
      out.push([relative(root, full), st.size, st.mtimeMs, st.mode]);
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return out;
}

test('renders milestone contracts, candidates, and verification links', () => {
  const ledger = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const lines = renderStateSnap(ledger, { ledgerLabel: 'ledger.json' }).join('\n');
  assert.match(lines, /progress: 1\/3 done · current: impl · blockers: 1/);
  assert.match(lines, /milestone design · DONE/);
  assert.match(lines, /milestone impl · ACTIVE/);
  assert.match(lines, /milestone release · BLOCKED/);
  assert.match(lines, /  objective: Implement both snap tools read-only/);
  assert.match(lines, /  scope\(2\): scripts\/state-snap\.mjs, scripts\/hook-snap\.mjs/);
  assert.match(lines, /  acceptance\(2\): zero-write proven by test \| output capped/);
  assert.match(lines, /  candidate: result_ref=sha256:aaa1 · status=DONE · plan=v2 · artifact=sha256:art1/);
  assert.match(lines, /  candidate: result_ref=sha256:bbb2 · status=DONE · plan=v2 · artifact=sha256:art2/);
  assert.match(lines, /  evidence\(1\) · latest: OBSERVED: zero-write proven by test: read-only dir run unchanged/);
  assert.match(lines, /  verification: GO · plan=v2 · stale=no · result_ref=sha256:aaa1/);
  assert.match(lines, /  verification: NO-GO · plan=v2 · stale=no · result_ref=sha256:bbb2/);
  assert.match(lines, /  ref_link: match/);
  assert.match(lines, /  verification: none/);
  assert.match(lines, /blocker release: waiting on impl/);
});

test('reports a result_ref mismatch between verification and candidate', () => {
  const ledger = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  ledger.verification.design.result_ref = 'sha256:zzz9';
  const lines = renderStateSnap(ledger).join('\n');
  assert.match(lines, /  ref_link: MISMATCH \(verification=sha256:zzz9 candidate=sha256:aaa1\)/);
});

test('CLI caps output at --max-lines with a truncation marker', () => {
  const r = run(['--ledger', FIXTURE, '--max-lines', '8'], { env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n');
  assert.equal(lines.length - 1, 8); // trailing newline
  assert.match(lines[7], /^… truncated: 7 of \d+ content lines shown/);
});

test('CLI rejects unknown flags and missing --ledger with exit 2', () => {
  assert.equal(run(['--bogus'], { env: cleanEnv() }).status, 2);
  assert.equal(run([], { env: cleanEnv() }).status, 2);
  const bad = run(['--max-lines', 'x', '--ledger', FIXTURE], { env: cleanEnv() });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /positive integer/);
});

test('CLI exits 1 on an unreadable ledger', () => {
  const r = run(['--ledger', join(HERE, 'fixtures', 'state-snap', 'nope.ledger.json')], { env: cleanEnv() });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cannot read ledger/);
});

test('zero writes: read-only ledger dir is untouched (no lock, no temp files)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-snap-readonly-'));
  const ledgerPath = join(dir, 'ledger.json');
  writeFileSync(ledgerPath, readFileSync(FIXTURE));
  try {
    chmodSync(dir, 0o555);
    chmodSync(ledgerPath, 0o444);
    const before = snapshotTree(dir);
    const r = run(['--ledger', ledgerPath], { env: cleanEnv() });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /milestone design · DONE/);
    // The core zero-write proof: identical recursive listing, sizes, mtimes,
    // and modes before and after — no lock file, no temp file, no touches.
    assert.deepEqual(snapshotTree(dir), before);
    assert.equal(existsSync(`${ledgerPath}.lock`), false);
  } finally {
    chmodSync(ledgerPath, 0o644);
    chmodSync(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cap helper keeps the marker as the final line and counts honestly', () => {
  const { lines, truncated, total } = capLines(['a', 'b', 'c', 'd'], 3);
  assert.equal(truncated, true);
  assert.equal(total, 4);
  assert.deepEqual(lines, ['a', 'b', '… truncated: 2 of 4 content lines shown (raise the cap with --max-lines)']);
  const kept = capLines(['a', 'b'], 5);
  assert.equal(kept.truncated, false);
  assert.deepEqual(kept.lines, ['a', 'b']);
});

test('max-lines resolution prefers the argument, then the environment, then the default', () => {
  assert.equal(resolveMaxLines({ arg: '5' }), 5);
  assert.equal(resolveMaxLines({ env: { NTG_SNAP_MAX_LINES: '7' } }), 7);
  assert.equal(resolveMaxLines({ arg: '5', env: { NTG_SNAP_MAX_LINES: '7' } }), 5);
  assert.equal(resolveMaxLines({ env: {} }), 200);
  assert.throws(() => resolveMaxLines({ arg: '0' }), /positive integer/);
});

test('main() is importable without running the CLI', () => {
  // main with explicit streams returns 0 and writes only to those streams.
  const out = [];
  const code = main(['--ledger', FIXTURE], {
    env: {},
    stdout: { write: s => out.push(s) },
    stderr: { write: s => out.push(s) },
  });
  assert.equal(code, 0);
  assert.equal(out.length, 1);
  assert.match(out[0], /plan_version: v2/);
});
