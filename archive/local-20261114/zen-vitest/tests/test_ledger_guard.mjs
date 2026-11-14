import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { main } from '../scripts/ntg-vnext.mjs';
import { acquireLedgerLock } from '../scripts/ledger-lock.mjs';
import { parseResponseEnvelope } from '../scripts/runner.mjs';

// Incident WQ-5: a worker deleted the live .ntg/ directory (ledger.json and
// ledger.json.lock) mid-invocation; the supervisor silently re-wrote
// ledger.json from memory and release() crashed on the vanished lock (rc=1
// with an ENOENT instead of a report). These tests pin the guarded behavior:
// the violation stops the run with a specific error, the ledger is never
// silently recreated, and a vanished lock is already released.

const CLI = new URL('../scripts/ntg-vnext.mjs', import.meta.url).pathname;
const observed = [{ classification: 'OBSERVED', criterion: 'content', result: 'inspected' }];
const plan = (version = 'v1', ids = ['one', 'two']) => ({
  goal: 'Deliver bounded artifacts', constraints: [], decision_invariants: [], plan_version: version,
  milestones: ids.map((id, index) => ({
    id, title: id, objective: `Deliver ${id}`, bounded_scope: [`${id}.txt`],
    acceptance_criteria: ['content matches'], non_goals: [], dependencies: index ? [ids[index - 1]] : [],
  })),
});
const envelope = value => parseResponseEnvelope(JSON.stringify({ status: 'SUCCESS', response: JSON.stringify(value) }));

/**
 * Same shape as the test_ntg_vnext harness, with the ledger inside a .ntg/
 * directory like a live run, and a `sabotage` hook the fake Bulldozer runs
 * mid-invocation to reproduce the incident's deletion.
 */
function guardHarness(t, { sabotage } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-ledger-guard-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ntg = join(dir, '.ntg');
  const ledger = join(ntg, 'ledger.json');
  const lock = `${ledger}.lock`;
  const calls = [];
  const deps = {
    handleSignals: false,
    invokeRole: async (role, packet) => {
      calls.push(role);
      if (role === 'bulldozer' && sabotage) sabotage({ ntg, ledger, lock });
      const contract = JSON.parse(packet.task.slice(packet.task.indexOf('\n') + 1));
      return envelope({
        milestone_id: contract.milestone_id, plan_version: contract.plan_version, status: 'DONE',
        changes_made: contract.bounded_scope, verification_evidence: observed, unresolved_unknowns: [],
        scope_deviations: [], candidate_artifact_ref: `sha256:${contract.milestone_id}`,
      });
    },
    invokeZen: async request => {
      calls.push(`zen:${request.milestone_id}`);
      return {
        milestone_id: request.milestone_id, plan_version: request.plan_version, result_ref: request.result_ref,
        verdict: 'GO', verification_evidence: observed,
      };
    },
  };
  const cli = (...argv) => main([argv[0], '--ledger', ledger, ...argv.slice(1)], deps);
  const write = (name, value) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(value)); return p; };
  return { cli, calls, ledger, lock, ntg, write };
}

test('deleting the ledger directory mid-invocation stops the run with an integrity violation and never recreates the ledger', async t => {
  const h = guardHarness(t, { sabotage: ({ ntg }) => rmSync(ntg, { recursive: true, force: true }) });
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  await assert.rejects(h.cli('run'), error => {
    assert.match(error.message, /ledger integrity violated: .+ledger\.json\.lock was removed during execution/);
    assert.match(error.message, /after bulldozer invocation for milestone one/);
    assert.equal(error.code, 'LEDGER_INTEGRITY');
    return true;
  });
  assert.deepEqual(h.calls, ['bulldozer'], 'Zen must never run after the violation');
  assert.equal(existsSync(h.ntg), false, 'the deleted ledger directory must not be recreated');
  assert.equal(existsSync(h.ledger), false);
  assert.equal(existsSync(h.lock), false);
});

test('deleting only the lock mid-invocation stops the run without rewriting the ledger', async t => {
  const h = guardHarness(t, { sabotage: ({ lock }) => rmSync(lock, { force: true }) });
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  await assert.rejects(h.cli('run'), error => {
    assert.match(error.message, /ledger integrity violated: .+ledger\.json\.lock was removed during execution/);
    assert.ok(error.message.includes(h.lock), 'the error must name the affected lock file');
    assert.match(error.message, /after bulldozer invocation for milestone one/);
    return true;
  });
  assert.deepEqual(h.calls, ['bulldozer'], 'Zen must never run after the violation');
  assert.equal(existsSync(h.lock), false);
  assert.equal(existsSync(h.ledger), true, 'ledger.json is left exactly as last saved');
  const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
  assert.equal(disk.current_milestone, 'one', 'the delegate save is the last write');
  assert.equal(disk.usage, undefined, 'no post-invocation accounting may be recorded over the violation');
});

test('a lock taken over by another pid mid-invocation stops the run', async t => {
  const h = guardHarness(t, { sabotage: ({ lock }) => writeFileSync(lock, '999999999\n') });
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  await assert.rejects(h.cli('run'), error => {
    assert.match(error.message, /ledger integrity violated: .+ledger\.json\.lock is owned by pid 999999999, not this process/);
    assert.match(error.message, /after bulldozer invocation for milestone one/);
    return true;
  });
  assert.deepEqual(h.calls, ['bulldozer'], 'Zen must never run after the violation');
  const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
  assert.equal(disk.current_milestone, 'one', 'the delegate save is the last write');
  assert.equal(disk.usage, undefined, 'no post-invocation accounting may be recorded over the violation');
});

test('release() treats a vanished lock as already released and still removes a present lock', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-lock-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = join(dir, 'ledger.json');
  const lock = `${ledger}.lock`;

  const releaseKept = acquireLedgerLock(ledger, { handleSignals: false });
  assert.ok(existsSync(lock));
  releaseKept();
  assert.equal(existsSync(lock), false);

  const releaseGone = acquireLedgerLock(ledger, { handleSignals: false });
  unlinkSync(lock); // an external actor removed it mid-run (incident WQ-5)
  releaseGone(); // must not throw ENOENT
});

test('release() still propagates non-ENOENT unlink failures', t => {
  if (process.getuid && process.getuid() === 0) return; // root bypasses permission bits
  const dir = mkdtempSync(join(tmpdir(), 'ntg-lock-release-'));
  t.after(() => { try { chmodSync(dir, 0o700); } catch {} rmSync(dir, { recursive: true, force: true }); });
  const ledger = join(dir, 'ledger.json');
  const release = acquireLedgerLock(ledger, { handleSignals: false });
  chmodSync(dir, 0o500); // unlink needs write permission on the directory
  assert.throws(() => release(), /EACCES/);
  chmodSync(dir, 0o700);
  release(); // complete the release so no 'exit' handler outlives the test
});

test('a normal run is unchanged: the guard stays silent and accounting and completion proceed', async t => {
  const h = guardHarness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  const { code, out } = await h.cli('run', '--all');
  assert.equal(code, 0);
  assert.deepEqual(h.calls, ['bulldozer', 'zen:one', 'bulldozer', 'zen:two']);
  assert.deepEqual(out.state.completed_milestones, ['one', 'two']);
  assert.ok(out.global_completion);
  const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
  assert.ok(disk.usage.one.some(e => e.role === 'bulldozer'), 'post-invocation accounting still runs');
  assert.equal(existsSync(h.lock), false, 'the lock is released at close');
});

// The real CLI surface through a fake agy that reproduces the incident: the
// Bulldozer invocation deletes .ntg/ and still returns a valid DONE packet.
const MODELS = [
  'gemini-4-argon-high\tGemini 4 Argon (High)',
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'claude-opus-5-5-high\tClaude Opus 5.5 (High)',
].join('\n');

test('the real CLI exits 1 with the integrity error when a runner deletes the ledger directory', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-guard-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ntg = join(dir, '.ntg');
  const ledger = join(ntg, 'ledger.json');
  const agy = join(dir, 'agy');
  writeFileSync(join(dir, 'models.txt'), `${MODELS}\n`);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan('v1', ['one'])));
  writeFileSync(agy, `#!/usr/bin/env node
const { readFileSync, rmSync } = require('node:fs');
const argv = process.argv.slice(2);
if (argv[0] === 'models') {
  process.stdout.write(readFileSync(${JSON.stringify(join(dir, 'models.txt'))}, 'utf8'));
} else {
  rmSync(${JSON.stringify(ntg)}, { recursive: true, force: true });
  process.stdout.write(JSON.stringify({
    status: 'SUCCESS',
    response: JSON.stringify({
      milestone_id: 'one', plan_version: 'v1', status: 'DONE',
      changes_made: ['one.txt'], verification_evidence: ${JSON.stringify(observed)},
      unresolved_unknowns: [], scope_deviations: [], candidate_artifact_ref: 'sha256:one',
    }),
    duration_seconds: 0.1,
    usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 },
  }));
}
`);
  chmodSync(agy, 0o755);
  const init = spawnSync(process.execPath, [CLI, 'init', '--ledger', ledger, '--plan', join(dir, 'plan.json')], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const run = spawnSync(process.execPath, [CLI, 'run', '--ledger', ledger], {
    encoding: 'utf8',
    env: { ...process.env, AGY_PATH: agy },
  });
  assert.equal(run.status, 1, `expected rc=1, stderr: ${run.stderr}`);
  assert.match(run.stderr, /ntg-vnext: ledger integrity violated: .+ledger\.json\.lock was removed during execution/);
  assert.match(run.stderr, /after bulldozer invocation for milestone one/);
  assert.equal(existsSync(ntg), false, 'the CLI must not recreate the deleted ledger directory');
});
