import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { main, nativeZen } from '../scripts/ntg-vnext.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';

const CLI = new URL('../scripts/ntg-vnext.mjs', import.meta.url).pathname;
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
  const escalations = [];
  const contracts = [];
  const deps = {
    handleSignals: false,
    invokeRole: async (role, packet, runnerOptions = {}) => {
      calls.push(role);
      timeouts.push(runnerOptions.timeout);
      escalations.push(runnerOptions.escalate === true);
      if (role === 'piledriver') return envelope({ recommendation: 'advisory only' });
      const contract = JSON.parse(packet.task.slice(packet.task.indexOf('\n') + 1));
      contracts.push(contract);
      if (role === 'instinct') {
        return envelope({
          current_framing: 'stalled framing',
          why_current_framing_may_be_wrong: 'untested assumption',
          alternate_hypotheses: [{ hypothesis: 'alt', evidence_basis: 'OBSERVED', discriminating_test: 'run X' }],
          recommendation: 'run X',
          unknowns: [],
        });
      }
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
  return { cli, calls, timeouts, escalations, contracts, write, ledger };
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

// A real supervisor (ntg-vnext main) takes the ledger lock, marks a milestone
// active and spawns a detached executor the way the runner does (own process
// group, inherited env). The supervisor is then SIGKILLed; the executor survives.
async function killedSupervisor(h, t) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-vnext-holder-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const holder = join(dir, 'holder.mjs');
  writeFileSync(holder, `import { spawn } from 'node:child_process';
import { main } from ${JSON.stringify(CLI)};
const invokeRole = () => {
  const executor = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { detached: true, stdio: 'ignore' });
  process.send({ executor: executor.pid });
  return new Promise(() => {});
};
main(['run', '--ledger', process.argv[2]], { invokeRole, invokeZen: () => {}, handleSignals: false });
setInterval(() => {}, 1 << 30); // a pending promise alone does not keep the loop alive
`);
  const child = fork(holder, [h.ledger], { stdio: 'ignore' });
  const [message] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
  t.after(() => { try { process.kill(message.executor, 'SIGKILL'); } catch {} });
  return { child, executor: message.executor };
}

const terminated = pid => {
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z'); } catch { return true; }
};

test('recover removes a lock whose owner was killed, then resume completes from the ledger', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  const { child, executor } = await killedSupervisor(h, t);
  child.kill('SIGKILL');
  await once(child, 'exit', { signal: AbortSignal.timeout(10000) });
  assert.ok(existsSync(`${h.ledger}.lock`));
  assert.equal(terminated(executor), false, 'executor outlives its killed supervisor');
  await assert.rejects(h.cli('status'), /already exists/);
  const recovered = await h.cli('recover', '--evidence', 'supervisor SIGKILLed mid-invocation');
  assert.equal(recovered.out.stale_lock_removed.dead_owner_pid, child.pid);
  assert.deepEqual(recovered.out.stale_lock_removed.terminated_executors, [executor]);
  assert.ok(terminated(executor), 'recover must end the old executor before releasing the milestone');
  assert.equal(recovered.out.state.current_milestone, null);
  const resumed = await h.cli('run');
  assert.equal(resumed.code, 0);
  assert.ok(resumed.out.global_completion);
});

test('recover refuses to remove a lock held by a live supervisor', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  const { child } = await killedSupervisor(h, t);
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

test('alt returns Instinct advisory JSON without adoption and escalates only explicitly', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan('v1', ['one'])));
  await assert.rejects(h.cli('alt'), /--task is required/);
  await assert.rejects(h.cli('alt', '--task', 'x', '--bogus', 'y'), /Unknown or incomplete option/);
  const { code, out } = await h.cli('alt', '--task', 'why is this stuck?');
  assert.equal(code, 0);
  assert.equal(out.adopted, false);
  assert.equal(out.advisory_alt.recommendation, 'run X');
  assert.deepEqual(h.calls, ['instinct']);
  assert.deepEqual(h.escalations, [false]);
  assert.equal(h.contracts[0].task, 'why is this stuck?');
  assert.equal(h.contracts[0].needs_alt.attempt_count, 0);
  assert.equal(h.contracts[0].replan_context.telemetry_tier, 'B');

  const escalated = await h.cli('alt', '--task', 'why is this stuck?', '--milestone', 'one', '--escalate');
  assert.equal(escalated.code, 0);
  assert.deepEqual(h.calls, ['instinct', 'instinct']);
  assert.deepEqual(h.escalations, [false, true]);
  assert.equal(h.contracts[1].needs_alt.milestone_id, 'one');
  // Advisory only: the ledger records the advice but adopts nothing.
  const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
  assert.deepEqual(disk.completed_milestones, []);
  assert.equal(disk.plan_version, 'v1');
  assert.equal(disk.evidence.alt_framing.length, 2);
  assert.deepEqual(disk.evidence.alt_framing.map(a => a.adopted), [false, false]);
});

test('status surfaces NEEDS_ALT recommendations derived from durable failure history', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-vnext-alt-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = join(dir, 'ledger.json');
  const deps = {
    handleSignals: false,
    invokeZen: async () => { throw new Error('zen must not run'); },
    invokeRole: async () => ({ ok: false, error: 'TIMEOUT', role: 'bulldozer', slug: 'gemini-3.8-flash-high' }),
  };
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan('v1', ['one'])));
  await main(['init', '--ledger', ledger, '--plan', join(dir, 'plan.json')], deps);
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(main(['run', '--ledger', ledger], deps), /TIMEOUT/);
  }
  const { code, out } = await main(['status', '--ledger', ledger], deps);
  assert.equal(code, 0);
  assert.equal(out.needs_alt.length, 1);
  assert.equal(out.needs_alt[0].failure_class, 'one:INVOCATION_FAILURE:runner.invoke');
  assert.equal(out.needs_alt[0].attempt_count, 3);
  assert.equal(out.needs_alt[0].needs_alt_recommended, true);
  assert.deepEqual(out.state.completed_milestones, []);
});

test('the npm-style bin symlink executes the CLI (#135 B1)', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-vnext-bin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'ntg-vnext');
  symlinkSync(CLI, bin);
  const missing = spawnSync(bin, ['status', '--ledger', join(dir, 'missing.json')], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ENOENT/);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan('v1', ['one'])));
  const init = JSON.parse(execFileSync(bin, ['init', '--ledger', join(dir, 'l.json'), '--plan', join(dir, 'plan.json')], { encoding: 'utf8' }));
  assert.equal(init.next_milestone, 'one');
});

function fakeZen(t, envelope) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-vnext-zen-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agy = join(dir, 'agy');
  writeFileSync(join(dir, 'out.json'), JSON.stringify(envelope));
  writeFileSync(agy, `#!/bin/sh\ncat ${JSON.stringify(join(dir, 'out.json'))}\n`);
  spawnSync('chmod', ['+x', agy]);
  return agy;
}
const zenGo = JSON.stringify({ milestone_id: 'one', plan_version: 'v1', result_ref: 'r', verdict: 'GO', verification_evidence: observed });

test('native Zen GO is accepted only from a SUCCESS envelope with an explicit verdict (#135 B3)', t => {
  const ok = nativeZen({}, { agyPath: fakeZen(t, { status: 'SUCCESS', response: zenGo }) });
  assert.equal(ok.verdict, 'GO');
  assert.throws(() => nativeZen({}, { agyPath: fakeZen(t, { status: 'ERROR', response: zenGo }) }), /MODEL_ERROR/);
  assert.throws(() => nativeZen({}, { agyPath: fakeZen(t, {
    status: 'SUCCESS', response: zenGo, denied_actions: [{ action: 'command', display_name: 'RunCommand' }],
  }) }), /TOOL_PERMISSION_DENIED/);
  assert.throws(() => nativeZen({}, { agyPath: fakeZen(t, { status: 'SUCCESS', response: JSON.stringify({ milestone_id: 'one' }) }) }), /explicit GO or NO-GO/);
  assert.throws(() => nativeZen({}, { agyPath: fakeZen(t, { message: zenGo }) }), /INVALID_OUTPUT/);
});
