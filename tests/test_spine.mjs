import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MinimalSpine } from '../scripts/spine.mjs';
import { AuthoritativeLedger } from '../scripts/ledger.mjs';
import { composeBoundedPrompt, parseResponseEnvelope } from '../scripts/runner.mjs';

const observed = [{ classification: 'OBSERVED', criterion: 'content', result: 'artifact inspected' }];
const plan = () => ({
  goal: 'Deliver two bounded artifacts', constraints: ['No default activation'],
  decision_invariants: [], plan_version: 'v1',
  milestones: ['one', 'two'].map((id, i) => ({
    id, title: id, objective: `Deliver ${id}`, bounded_scope: [`${id}.txt`],
    acceptance_criteria: ['content matches milestone ID'], non_goals: ['activation'],
    dependencies: i ? ['one'] : [],
  })),
});
const candidate = (contract, patch = {}) => ({
  milestone_id: contract.milestone_id, plan_version: contract.plan_version,
  status: 'DONE', changes_made: contract.bounded_scope,
  verification_evidence: observed, unresolved_unknowns: [], scope_deviations: [],
  candidate_artifact_ref: 'sha256:fixture-version', ...patch,
});
const verdict = (request, patch = {}) => ({
  milestone_id: request.milestone_id, plan_version: request.plan_version,
  result_ref: request.result_ref, verdict: 'GO', verification_evidence: observed, ...patch,
});
const envelope = value => parseResponseEnvelope(JSON.stringify({
  status: 'SUCCESS', response: JSON.stringify(value),
}));

function fixture(t, { output, review, initialPlan = plan() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-spine-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledgerPath = join(dir, 'ledger.json');
  const calls = [];
  const invokeRole = async (role, packet) => {
    calls.push(role);
    assert.ok(composeBoundedPrompt(role, packet)); // Real runner packet boundary.
    const contract = JSON.parse(packet.task.slice(packet.task.indexOf('\n') + 1));
    if (role === 'piledriver') return envelope({ recommendation: 'retain plan' });
    assert.equal(role, 'bulldozer');
    if (output) return envelope(await output(contract));
    // Deterministic native-host double: Bobcat runs INSIDE Bulldozer, writes a
    // real bounded artifact and returns READY; Bulldozer separately assesses it.
    calls.push('bobcat');
    const artifact = join(dir, `${contract.milestone_id}.txt`);
    writeFileSync(artifact, contract.milestone_id);
    const worker = { status: 'READY', artifact };
    assert.equal(worker.status, 'READY');
    assert.equal(readFileSync(worker.artifact, 'utf8'), contract.milestone_id);
    const hash = createHash('sha256').update(readFileSync(artifact)).digest('hex');
    return envelope(candidate(contract, { candidate_artifact_ref: `sha256:${hash}` }));
  };
  const invokeZen = async request => {
    calls.push('zen');
    const disk = AuthoritativeLedger.load(ledgerPath).getState();
    assert.equal(disk.current_milestone, request.milestone_id);
    assert.ok(!disk.completed_milestones.includes(request.milestone_id));
    assert.equal(request.candidate.status, 'DONE');
    assert.ok(Object.isFrozen(request.candidate));
    assert.ok(JSON.stringify(disk.evidence).includes(request.result_ref));
    if (review) return review(request);
    const bytes = readFileSync(join(dir, `${request.milestone_id}.txt`));
    assert.equal(bytes.toString(), request.milestone_id);
    assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      request.candidate.candidate_artifact_ref);
    return verdict(request);
  };
  const options = { ledgerPath, invokeRole, invokeZen };
  const spine = new MinimalSpine({ ...options, plan: initialPlan });
  return { spine, options, calls, ledgerPath, dir };
}

test('optional planning, native worker, independent review, durable promotion and fresh resume', { timeout: 3000 }, async t => {
  const f = fixture(t);
  const before = f.spine.state;
  await f.spine.requestPlan('Assess the existing plan');
  assert.deepEqual(f.spine.state, before); // Planner cannot adopt or mutate state.
  await assert.rejects(f.spine.runMilestone('two'));
  const first = await f.spine.runMilestone('one');
  assert.equal(first.verified, true);
  assert.deepEqual(f.calls, ['piledriver', 'bulldozer', 'bobcat', 'zen']);
  assert.deepEqual(f.spine.state.completed_milestones, ['one']);
  assert.throws(() => f.spine.declareGlobalCompletion());
  const resumed = new MinimalSpine(f.options);
  await resumed.runMilestone('two');
  assert.equal(resumed.declareGlobalCompletion().completed, true);
  assert.deepEqual(resumed.state.completed_milestones, ['one', 'two']);
  assert.equal(resumed.state.current_milestone, null);
});

for (const status of ['READY', undefined, null, '', 'ACCEPT', 'GO', 'done']) {
  test(`candidate status ${String(status)} cannot become DONE`, async t => {
    const f = fixture(t, { output: c => candidate(c, { status }) });
    await assert.rejects(f.spine.runMilestone('one'), /explicit Bulldozer DONE/);
    assert.ok(!f.calls.includes('zen'));
    assert.deepEqual(f.spine.state.completed_milestones, []);
    assert.equal(f.spine.state.current_milestone, null);
    assert.throws(() => f.spine.declareGlobalCompletion());
  });
}

test('Zen is mandatory at construction', t => {
  const f = fixture(t);
  assert.throws(() => new MinimalSpine({ ledgerPath: f.ledgerPath }), /Zen/);
});

for (const field of ['verdict', 'zen_verdict', 'result_ref']) {
  test(`worker cannot forge ${field}`, async t => {
    const f = fixture(t, { output: c => candidate(c, { [field]: 'GO' }) });
    await assert.rejects(f.spine.runMilestone('one'), /cannot issue/);
    assert.ok(!f.calls.includes('zen'));
    assert.deepEqual(f.spine.state.completed_milestones, []);
  });
}

for (const patch of [
  { verdict: 'NOT_REQUIRED' }, { verdict: undefined }, { plan_version: 'v0' },
  { milestone_id: 'two' }, { result_ref: 'forged-ref' }, { verification_evidence: [] },
  { verification_evidence: [{ classification: 'INFERRED' }] },
]) {
  test(`invalid Zen authority ${JSON.stringify(patch)} cannot promote`, async t => {
    const f = fixture(t, { review: r => verdict(r, patch) });
    await assert.rejects(f.spine.runMilestone('one'));
    assert.deepEqual(f.spine.state.completed_milestones, []);
    assert.deepEqual(new MinimalSpine(f.options).state.completed_milestones, []);
  });
}

test('NO-GO leaves incomplete; a changed candidate requires a new reference and GO', async t => {
  let attempt = 0;
  const refs = [];
  const f = fixture(t, {
    output: c => candidate(c, { candidate_artifact_ref: `sha256:revision-${++attempt}` }),
    review: r => { refs.push(r.result_ref); return verdict(r, { verdict: attempt === 1 ? 'NO-GO' : 'GO' }); },
  });
  assert.equal((await f.spine.runMilestone('one')).verified, false);
  assert.deepEqual(f.spine.state.completed_milestones, []);
  assert.equal(f.spine.state.current_milestone, null);
  assert.equal((await f.spine.runMilestone('one')).verified, true);
  assert.notEqual(refs[0], refs[1]);
});

for (const status of ['BLOCKED', 'NEEDS_DEEP']) {
  test(`${status} is evidence, not completion or automatic replanning`, async t => {
    const f = fixture(t, { output: c => candidate(c, {
      status, blockers: [{ id: 'b1', description: 'required capability unavailable', affects_milestone: 'one', escalation_path: 'supervisor' }],
      escalation_needs: ['Resolve interface decision'],
    }) });
    const result = await f.spine.runMilestone('one');
    assert.equal(result.status, status);
    assert.equal(result.verified, false);
    assert.deepEqual(f.calls, ['bulldozer']);
    assert.equal(f.spine.state.current_milestone, null);
    assert.deepEqual(f.spine.state.completed_milestones, []);
  });
}

test('awaited review is a hard gate; concurrent execution/replan/completion are rejected', { timeout: 3000 }, async t => {
  let enterReview;
  let releaseReview;
  const entered = new Promise(resolve => { enterReview = resolve; });
  const released = new Promise(resolve => { releaseReview = resolve; });
  const f = fixture(t, { review: async r => { enterReview(); await released; return verdict(r); } });
  const running = f.spine.runMilestone('one');
  await entered;
  try {
    assert.deepEqual(f.spine.state.completed_milestones, []);
    await assert.rejects(f.spine.runMilestone('two'), /already active/);
    assert.throws(() => f.spine.adoptReplan(plan()), /already active/);
    assert.throws(() => f.spine.declareGlobalCompletion(), /already active/);
    const resumed = new MinimalSpine(f.options);
    await assert.rejects(resumed.runMilestone('one'), /already active/);
  } finally {
    releaseReview();
  }
  await running;
  assert.deepEqual(f.spine.state.completed_milestones, ['one']);
});

test('replan invalidates completion and old Zen authority; dependency order is revalidated', async t => {
  let oldVerdict;
  let reuseOld = false;
  const f = fixture(t, { review: r => {
    if (reuseOld) return oldVerdict;
    oldVerdict = verdict(r);
    return oldVerdict;
  } });
  await f.spine.runMilestone('one');
  f.spine.adoptReplan({ ...plan(), plan_version: 'v2' });
  assert.equal(f.spine.state.plan_version, 'v2');
  assert.deepEqual(f.spine.state.completed_milestones, []);
  await assert.rejects(f.spine.runMilestone('two'));
  reuseOld = true;
  await assert.rejects(f.spine.runMilestone('one'), /current candidate binding/);
  reuseOld = false;
  await f.spine.runMilestone('one');
  assert.deepEqual(f.spine.state.completed_milestones, ['one']);
});

test('invocation failure is observed and persisted, not silently swallowed', async t => {
  const f = fixture(t, { review: () => { throw new Error('native review failed'); } });
  await assert.rejects(f.spine.runMilestone('one'), /native review failed/);
  const disk = new MinimalSpine(f.options).state;
  assert.equal(disk.current_milestone, null);
  assert.deepEqual(disk.completed_milestones, []);
  assert.ok(JSON.stringify(disk.evidence).includes('native review failed'));
});

test('a persisted interrupted invocation needs observed recovery before retry', async t => {
  const f = fixture(t);
  const ledger = AuthoritativeLedger.load(f.ledgerPath);
  ledger.delegate('one');
  ledger.save(f.ledgerPath);
  const resumed = new MinimalSpine(f.options);
  await assert.rejects(resumed.runMilestone('one'), /already active/);
  assert.throws(() => resumed.endInterruptedInvocation({ classification: 'INFERRED' }));
  resumed.endInterruptedInvocation({ classification: 'OBSERVED', result: 'executor terminated' });
  assert.equal(resumed.state.current_milestone, null);
  assert.equal((await resumed.runMilestone('one')).verified, true);
});

test('stale candidate identity and missing artifact binding fail closed', async t => {
  for (const patch of [{ plan_version: 'v0' }, { milestone_id: 'two' }, { candidate_artifact_ref: undefined }]) {
    const f = fixture(t, { output: c => candidate(c, patch) });
    await assert.rejects(f.spine.runMilestone('one'));
    assert.ok(!f.calls.includes('zen'));
    assert.deepEqual(f.spine.state.completed_milestones, []);
  }
});
