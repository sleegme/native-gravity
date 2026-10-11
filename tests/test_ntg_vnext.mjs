import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { main } from '../scripts/ntg-vnext.mjs';
import { parseResponseEnvelope } from '../scripts/runner.mjs';

const observed = [{ classification: 'OBSERVED', criterion: 'content', result: 'inspected' }];
const plan = (version = 'v1', ids = ['one', 'two']) => ({
  goal: 'Deliver bounded artifacts', constraints: [], decision_invariants: [], plan_version: version,
  milestones: ids.map((id, index) => ({
    id, title: id, objective: `Deliver ${id}`, bounded_scope: [`${id}.txt`],
    acceptance_criteria: ['content matches'], non_goals: [], dependencies: index ? [ids[index - 1]] : [],
  })),
});
const envelope = value => parseResponseEnvelope(JSON.stringify({ status: 'SUCCESS', response: JSON.stringify(value) }));

function harness(t, { zen = () => 'GO' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-vnext-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = join(dir, 'ledger.json');
  const calls = [];
  const timeouts = [];
  const deps = {
    handleSignals: false,
    invokeRole: async (role, packet, runnerOptions = {}) => {
      calls.push(role);
      timeouts.push(runnerOptions.timeout);
      if (role === 'piledriver') return envelope({ recommendation: 'advisory only' });
      const contract = JSON.parse(packet.task.slice(packet.task.indexOf('\n') + 1));
      return envelope({
        milestone_id: contract.milestone_id, plan_version: contract.plan_version, status: 'DONE',
        changes_made: contract.bounded_scope, verification_evidence: observed, unresolved_unknowns: [],
        scope_deviations: [], candidate_artifact_ref: `sha256:${contract.milestone_id}`,
      });
    },
    invokeZen: async request => {
      calls.push(`zen:${request.milestone_id}`);
      const verdict = zen(request);
      return {
        milestone_id: request.milestone_id, plan_version: request.plan_version, result_ref: request.result_ref,
        verdict, verification_evidence: observed, ...(verdict === 'NO-GO' ? { repair_needs: 'fix content' } : {}),
      };
    },
  };
  const write = (name, value) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(value)); return p; };
  // Each call is a fresh process-equivalent context: state comes only from the ledger file.
  const cli = (...argv) => main([argv[0], '--ledger', ledger, ...argv.slice(1)], deps);
  return { cli, calls, timeouts, write, ledger };
}

test('run --all promotes milestones in dependency order and declares completion only after each Zen GO', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  const { code, out } = await h.cli('run', '--all');
  assert.equal(code, 0);
  assert.deepEqual(h.calls, ['bulldozer', 'zen:one', 'bulldozer', 'zen:two']);
  assert.deepEqual(out.state.completed_milestones, ['one', 'two']);
  assert.ok(out.global_completion);
});

test('Zen NO-GO stops the run with exit 2, leaves the milestone incomplete, and a rerun needs a fresh GO', async t => {
  let verdicts = ['NO-GO', 'GO'];
  const h = harness(t, { zen: () => verdicts.shift() });
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  const first = await h.cli('run');
  assert.equal(first.code, 2);
  assert.deepEqual(first.out.state.completed_milestones, []);
  assert.equal(first.out.global_completion, undefined);
  const second = await h.cli('run');
  assert.equal(second.code, 0);
  assert.deepEqual(second.out.state.completed_milestones, ['one']);
  assert.deepEqual(h.calls, ['bulldozer', 'zen:one', 'bulldozer', 'zen:one']);
});

test('fresh-context resume continues from the ledger at the next eligible milestone', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  await h.cli('run');
  const status = await h.cli('status');
  assert.equal(status.out.next_milestone, 'two');
  const resumed = await h.cli('run');
  assert.deepEqual(resumed.out.results.map(r => r.milestone_id), ['two']);
  assert.ok(resumed.out.global_completion);
});

test('material replan increments plan_version, clears completion, and requires fresh review', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  await h.cli('run', '--all');
  const { out } = await h.cli('replan', '--plan', h.write('plan2.json', plan('v2', ['one'])));
  assert.equal(out.state.plan_version, 'v2');
  assert.deepEqual(out.state.completed_milestones, []);
  const rerun = await h.cli('run');
  assert.equal(rerun.out.results[0].verdict.plan_version, 'v2');
  assert.ok(rerun.out.global_completion);
});

// A real supervisor process takes the ledger lock and marks a milestone active,
// then is SIGKILLed (no exit handlers run), leaving the lock behind.
async function killedSupervisor(h, t) {
  const lockHolder = join(mkdtempSync(join(tmpdir(), 'ntg-vnext-holder-')), 'holder.mjs');
  t.after(() => rmSync(dirname(lockHolder), { recursive: true, force: true }));
  writeFileSync(lockHolder, `import { MinimalSpine } from ${JSON.stringify(new URL('../scripts/spine.mjs', import.meta.url).pathname)};
const spine = new MinimalSpine({ ledgerPath: process.argv[2], invokeZen: () => {}, handleSignals: false,
  invokeRole: () => new Promise(() => process.send('in-flight')) });
spine.runMilestone('one');
// A pending promise does not keep the event loop alive; hold it open until killed.
setInterval(() => {}, 1 << 30);
`);
  const child = fork(lockHolder, [h.ledger], { stdio: 'ignore' });
  const timer = AbortSignal.timeout(10000);
  await once(child, 'message', { signal: timer });
  return child;
}

test('recover removes a lock whose owner was killed, then resume completes from the ledger', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  const child = await killedSupervisor(h, t);
  child.kill('SIGKILL');
  await once(child, 'exit', { signal: AbortSignal.timeout(10000) });
  assert.ok(existsSync(`${h.ledger}.lock`));
  await assert.rejects(h.cli('status'), /already exists/);
  const recovered = await h.cli('recover', '--evidence', 'supervisor SIGKILLed mid-invocation');
  assert.equal(recovered.out.stale_lock_removed.dead_owner_pid, child.pid);
  assert.equal(recovered.out.state.current_milestone, null);
  const resumed = await h.cli('run');
  assert.equal(resumed.code, 0);
  assert.ok(resumed.out.global_completion);
});

test('recover refuses to remove a lock held by a live supervisor', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  const child = await killedSupervisor(h, t);
  t.after(() => child.kill('SIGKILL'));
  await assert.rejects(h.cli('recover', '--evidence', 'x'), /held by live process/);
  assert.ok(existsSync(`${h.ledger}.lock`));
});

test('runner invocations get a 600s default timeout, overridable with --timeout', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  await h.cli('plan', '--task', 'advise');
  await h.cli('plan', '--task', 'advise', '--timeout', '30');
  assert.deepEqual(h.timeouts, [600000, 30000]);
  await assert.rejects(h.cli('status', '--timeout', '0'), /positive number/);
});

test('plan returns Piledriver advice without adopting it', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  const before = readFileSync(h.ledger, 'utf8');
  const { out } = await h.cli('plan', '--task', 'reconsider milestones');
  assert.equal(out.adopted, false);
  assert.deepEqual(h.calls, ['piledriver']);
  assert.equal(JSON.parse(readFileSync(h.ledger, 'utf8')).plan_version, JSON.parse(before).plan_version);
});
