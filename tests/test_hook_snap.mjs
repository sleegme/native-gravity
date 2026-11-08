import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { parseRegistrations, queryAgyPluginList, registeredGuardPaths, renderHookSnap } from '../scripts/hook-snap.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'scripts', 'hook-snap.mjs');

const HOOKS_JSON = {
  'zen-boundary': {
    PreToolUse: [
      {
        matcher: '^run_command$',
        hooks: [{ type: 'command', command: 'python3 ./hooks/zen.py', timeout: 10 }],
      },
    ],
  },
  'ghost-boundary': {
    SessionStart: [
      {
        type: 'command',
        command: 'python3 ./hooks/ghost.py --session-start',
        timeout: 10,
      },
    ],
  },
};

function run(args, opts = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...opts });
}

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NTG_SNAP_MAX_LINES;
  return env;
}

/** Minimal repo fixture: zen.py registered, budget.py unregistered, ghost.py registered-but-missing. */
function buildRepo(t, { root = null } = {}) {
  const dir = root ?? mkdtempSync(join(tmpdir(), 'hook-snap-repo-'));
  if (root === null) t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'hooks'), { recursive: true });
  writeFileSync(join(dir, 'hooks.json'), JSON.stringify(HOOKS_JSON, null, 2));
  writeFileSync(join(dir, 'hooks', 'zen.py'), '# zen guard\n');
  writeFileSync(join(dir, 'hooks', 'budget.py'), '# budget guard\n');
  return dir;
}

function buildInstalled(t, { mutate = 'match' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hook-snap-inst-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'hooks'), { recursive: true });
  writeFileSync(join(dir, 'hooks.json'), JSON.stringify(HOOKS_JSON, null, 2));
  writeFileSync(join(dir, 'hooks', 'zen.py'), '# zen guard\n');
  writeFileSync(join(dir, 'hooks', 'budget.py'), mutate === 'differs' ? '# budget guard TAMPERED\n' : '# budget guard\n');
  if (mutate === 'extra') writeFileSync(join(dir, 'hooks', 'extra.py'), '# extra guard\n');
  if (mutate === 'missing-hooks-json') rmSync(join(dir, 'hooks.json'));
  return dir;
}

function agyMock(t, body) {
  const dir = mkdtempSync(join(tmpdir(), 'hook-snap-agy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const mock = join(dir, 'agy');
  writeFileSync(mock, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(mock, 0o755);
  return mock;
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

function restoreWritable(root) {
  chmodSync(root, 0o755);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      restoreWritable(full);
    } else {
      chmodSync(full, 0o644);
    }
  }
}

function makeReadOnly(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) makeReadOnly(full);
    else chmodSync(full, 0o444);
  }
  chmodSync(root, 0o555);
}

test('parseRegistrations flattens events and defaults matcher to *', () => {
  const regs = parseRegistrations(HOOKS_JSON);
  assert.deepEqual(regs, [
    { boundary: 'zen-boundary', event: 'PreToolUse', matcher: '^run_command$', command: 'python3 ./hooks/zen.py' },
    { boundary: 'ghost-boundary', event: 'SessionStart', matcher: '*', command: 'python3 ./hooks/ghost.py --session-start' },
  ]);
  assert.deepEqual(registeredGuardPaths(regs), ['hooks/ghost.py', 'hooks/zen.py']);
});

test('renderHookSnap reports registrations, drift, and installed comparison', t => {
  const repo = buildRepo(t);
  const installed = buildInstalled(t, { mutate: 'differs' });
  const lines = renderHookSnap({
    repoRoot: repo,
    installedRoot: installed,
    hooksJson: HOOKS_JSON,
    agyState: { status: 'OK', enabled: true, version: '9.9.9' },
  }).join('\n');
  assert.match(lines, /hooks\.json registrations: 2/);
  assert.match(lines, /zen-boundary · PreToolUse · matcher \^run_command\$ · python3 \.\/hooks\/zen\.py/);
  assert.match(lines, /guards in hooks\/: 2/);
  assert.match(lines, /  registered-but-missing: hooks\/ghost\.py/);
  assert.match(lines, /  unregistered: budget\.py/);
  assert.match(lines, /hooks\.json: MATCH/);
  assert.match(lines, /hooks\/zen\.py: MATCH/);
  assert.match(lines, /hooks\/budget\.py: DIFFERS \(repo sha256:[0-9a-f]{12} \/ installed sha256:[0-9a-f]{12}\)/);
  assert.match(lines, /agy plugin list: native-gravity · enabled=true · version=9\.9\.9/);
});

test('renderHookSnap skips comparison when the installed copy is missing', t => {
  const repo = buildRepo(t);
  const lines = renderHookSnap({
    repoRoot: repo,
    installedRoot: join(repo, 'no-such-install'),
    hooksJson: HOOKS_JSON,
    agyState: { status: 'UNKNOWN', detail: 'agy not found' },
  }).join('\n');
  assert.match(lines, /installed: .* · MISSING/);
  assert.match(lines, /repo vs installed: skipped \(installed copy missing\)/);
  assert.match(lines, /agy plugin list: UNKNOWN \(agy not found\)/);
});

test('CLI: identical installed copy is all MATCH; extra file is reported', t => {
  const repo = buildRepo(t);
  const match = buildInstalled(t, { mutate: 'match' });
  const r = run(['--repo', repo, '--installed', match], { env: cleanEnv({ AGY_PATH: '/nonexistent/agy' }) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /hooks\/budget\.py: MATCH/);
  assert.match(r.stdout, /agy plugin list: UNKNOWN \(agy not found\)/);

  const extra = buildInstalled(t, { mutate: 'extra' });
  const r2 = run(['--repo', repo, '--installed', extra], { env: cleanEnv({ AGY_PATH: '/nonexistent/agy' }) });
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /hooks\/extra\.py: EXTRA in installed/);

  const noHooksJson = buildInstalled(t, { mutate: 'missing-hooks-json' });
  const r3 = run(['--repo', repo, '--installed', noHooksJson], { env: cleanEnv({ AGY_PATH: '/nonexistent/agy' }) });
  assert.equal(r3.status, 0, r3.stderr);
  assert.match(r3.stdout, /hooks\.json: MISSING in installed/);
});

test('CLI: agy mock states are reported verbatim', t => {
  const repo = buildRepo(t);
  const installed = buildInstalled(t);
  const ok = agyMock(t, 'process.stdout.write(JSON.stringify([{ name: "native-gravity", enabled: true, version: "1.2.0" }]));');
  const r = run(['--repo', repo, '--installed', installed], { env: cleanEnv({ AGY_PATH: ok }) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /agy plugin list: native-gravity · enabled=true · version=1\.2\.0/);

  const disabled = agyMock(t, 'process.stdout.write(JSON.stringify([{ name: "native-gravity", enabled: false }]));');
  const r2 = run(['--repo', repo, '--installed', installed], { env: cleanEnv({ AGY_PATH: disabled }) });
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /agy plugin list: native-gravity · enabled=false/);

  const absent = agyMock(t, 'process.stdout.write(JSON.stringify([{ name: "other" }]));');
  const r3 = run(['--repo', repo, '--installed', installed], { env: cleanEnv({ AGY_PATH: absent }) });
  assert.equal(r3.status, 0, r3.stderr);
  assert.match(r3.stdout, /agy plugin list: native-gravity NOT_FOUND/);

  const failing = agyMock(t, 'process.exit(3);');
  const r4 = run(['--repo', repo, '--installed', installed], { env: cleanEnv({ AGY_PATH: failing }) });
  assert.equal(r4.status, 0, r4.stderr);
  assert.match(r4.stdout, /agy plugin list: UNKNOWN \(agy plugin list exited 3\)/);
});

test('queryAgyPluginList reports UNKNOWN for a missing binary', () => {
  const state = queryAgyPluginList({ agyPath: '/nonexistent/agy' });
  assert.equal(state.status, 'UNKNOWN');
  assert.equal(state.detail, 'agy not found');
});

test('CLI: usage errors exit 2; unreadable repo hooks.json exits 1', t => {
  assert.equal(run(['--bogus'], { env: cleanEnv() }).status, 2);
  const empty = mkdtempSync(join(tmpdir(), 'hook-snap-empty-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const bad = run(['--repo', empty, '--installed', empty], { env: cleanEnv({ AGY_PATH: '/nonexistent/agy' }) });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /cannot read/);
});

test('CLI: output is capped with a truncation marker', t => {
  const repo = buildRepo(t);
  const r = run(['--repo', repo, '--installed', join(repo, 'no-such-install'), '--max-lines', '4'], {
    env: cleanEnv({ AGY_PATH: '/nonexistent/agy' }),
  });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n');
  assert.equal(lines.length - 1, 4);
  assert.match(lines[3], /^… truncated: 3 of \d+ content lines shown/);
});

test('zero writes: read-only repo and installed trees are untouched', t => {
  const repo = buildRepo(t);
  const installed = buildInstalled(t, { mutate: 'differs' });
  const agy = agyMock(t, 'process.stdout.write("[]");');
  makeReadOnly(repo);
  makeReadOnly(installed);
  try {
    const beforeRepo = snapshotTree(repo);
    const beforeInstalled = snapshotTree(installed);
    const r = run(['--repo', repo, '--installed', installed], { env: cleanEnv({ AGY_PATH: agy }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /hooks\/budget\.py: DIFFERS/);
    // The core zero-write proof: identical recursive listings, sizes, mtimes,
    // and modes before and after — the tool created and touched nothing.
    assert.deepEqual(snapshotTree(repo), beforeRepo);
    assert.deepEqual(snapshotTree(installed), beforeInstalled);
  } finally {
    restoreWritable(repo);
    restoreWritable(installed);
  }
});

test('real repo snapshot runs clean against its own checkout', () => {
  const repoRoot = join(HERE, '..');
  const r = run(['--repo', repoRoot, '--installed', repoRoot], { env: cleanEnv({ AGY_PATH: '/nonexistent/agy' }) });
  assert.equal(r.status, 0, r.stderr);
  // The checkout compares against itself: every hook file must MATCH.
  assert.match(r.stdout, /hooks\.json: MATCH/);
  assert.match(r.stdout, /hooks\/zen-shell-guard\.py: MATCH/);
  assert.match(r.stdout, /hooks\/excavator-shell-guard\.py: MATCH/);
  assert.match(r.stdout, /hooks\/bulldozer-shell-guard\.py: MATCH/);
  assert.match(r.stdout, /hooks\/budget-guard\.py: MATCH/);
  assert.match(r.stdout, /agy plugin list: UNKNOWN \(agy not found\)/);
  assert.ok(!existsSync(join(repoRoot, 'ledger.json.lock')));
});
