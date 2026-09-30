import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { execute } from '../scripts/spine-cli.mjs';
import { AuthoritativeLedger } from '../scripts/ledger.mjs';

const cli = fileURLToPath(new URL('../scripts/spine-cli.mjs', import.meta.url));
const observed = [{ classification: 'OBSERVED', result: 'fixture artifact inspected' }];
const plan = () => ({
  goal: 'Deliver two artifacts', constraints: [], decision_invariants: [], plan_version: 'v1',
  milestones: ['one', 'two'].map((id, i) => ({
    id, title: id, objective: `Deliver ${id}`, acceptance_criteria: ['artifact matches'],
    bounded_scope: [`${id}.txt`], depends_on: i ? ['one'] : [],
  })),
});
const candidate = (id = 'one', version = 'v1', revision = '1') => ({
  milestone_id: id, plan_version: version, status: 'DONE', changes_made: [`${id}.txt`],
  verification_evidence: observed, unresolved_unknowns: [], scope_deviations: [],
  candidate_artifact_ref: `sha256:fixture-${revision}`,
});
const verdict = (ref, patch = {}) => ({
  milestone_id: 'one', plan_version: 'v1', result_ref: ref,
  verdict: 'GO', verification_evidence: observed, ...patch,
});

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-spcli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = join(dir, 'ledger.json');
  let sequence = 0;
  const json = value => {
    const path = join(dir, `packet-${sequence++}.json`);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };
  const args = (command, ...rest) => [command, '--ledger', ledger, ...rest];
  const call = (command, rest = [], errorType) => {
    const result = spawnSync(process.execPath, [cli, ...args(command, ...rest)], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.stderr, '');
    const output = JSON.parse(result.stdout);
    assert.equal(result.status, errorType ? 1 : 0, JSON.stringify(output));
    assert.equal(output.ok, !errorType);
    if (errorType) assert.equal(output.errorType, errorType);
    return output;
  };
  const initial = call('init', ['--plan', json(plan())]);
  const stage = (id = 'one', version = 'v1', revision = '1') => {
    call('delegate', ['--milestone', id]);
    return call('candidate', ['--file', json(candidate(id, version, revision))]).result_ref;
  };
  return { dir, ledger, json, args, call, initial, stage };
}

test('init and fresh-process status round-trip; cannot reset existing ledger', t => {
  const f = fixture(t);
  assert.deepEqual(f.call('status').state, f.initial.state);
  assert.equal(f.initial.state.goal, plan().goal);
  assert.deepEqual(f.initial.state.milestones[1].dependencies, ['one']);
  f.call('init', ['--plan', f.json(plan())], 'InvalidTransitionError');
  assert.deepEqual(f.call('status').state, f.initial.state);
});

test('delegate returns complete bounded packet and enforces dependency and active state', t => {
  const f = fixture(t);
  f.call('delegate', ['--milestone', 'two'], 'InvalidTransitionError');
  const packet = f.call('delegate', ['--milestone', 'one']).packet;
  assert.equal(packet.milestone_id, 'one');
  assert.equal(packet.plan_version, 'v1');
  assert.deepEqual(packet.bounded_scope, ['one.txt']);
  assert.deepEqual(packet.acceptance_criteria, ['artifact matches']);
  f.call('delegate', ['--milestone', 'one'], 'InvalidTransitionError');
});

test('candidate persistence; wrong reference and stale version cannot mutate authority', t => {
  const f = fixture(t);
  const ref = f.stage();
  const before = readFileSync(f.ledger, 'utf8');
  f.call('record-zen', ['--file', f.json(verdict('wrong'))], 'MismatchedResultRefError');
  f.call('record-zen', ['--file', f.json(verdict(ref, { plan_version: 'v0' }))], 'StaleVerdictError');
  f.call('record-zen', ['--file', f.json(verdict(ref, { verdict: 'READY' }))], 'InvalidTransitionError');
  assert.equal(readFileSync(f.ledger, 'utf8'), before);
  f.call('record-zen', ['--file', f.json(verdict(ref))]);
  assert.deepEqual(f.call('status').state.completed_milestones, ['one']);
});

test('NO-GO permits fresh repair and completion requires every current GO', t => {
  const f = fixture(t);
  f.call('complete', [], 'InvariantViolationError');
  const first = f.stage();
  f.call('complete', [], 'InvariantViolationError');
  f.call('record-zen', ['--file', f.json(verdict(first, { verdict: 'NO-GO' }))]);
  assert.deepEqual(f.call('status').state.completed_milestones, []);
  const repaired = f.stage('one', 'v1', '2');
  assert.notEqual(first, repaired);
  f.call('record-zen', ['--file', f.json(verdict(repaired))]);
  f.call('complete', [], 'InvariantViolationError');
  const second = f.stage('two');
  f.call('record-zen', ['--file', f.json(verdict(second, { milestone_id: 'two' }))]);
  assert.equal(f.call('complete').completed, true);
  assert.equal(AuthoritativeLedger.load(f.ledger).declareGlobalCompletion().completed, true);
});

test('replan increments version, preserves stale history, rejects active replan and old verdicts', { timeout: 5000 }, async t => {
  const f = fixture(t);
  const ref = f.stage();
  const revised = plan();
  delete revised.plan_version;
  f.call('replan', ['--plan', f.json(revised)], 'InvalidTransitionError');
  f.call('record-zen', ['--file', f.json(verdict(ref))]);
  const state = f.call('replan', ['--plan', f.json(revised)]).state;
  assert.equal(state.plan_version, 'v2');
  assert.equal(state.verification.one.is_stale, true);
  assert.deepEqual(state.completed_milestones, []);
  assert.equal(state.current_milestone, null);
  const fresh = await execute(f.args('run-milestone', '--milestone', 'one'), { invokeRole: roleStub });
  assert.equal(fresh.zen_request.plan_version, 'v2');
  f.call('record-zen', ['--file', f.json(verdict(ref))], 'StaleVerdictError');
  f.call('record-zen', ['--file', f.json(verdict(fresh.zen_request.result_ref, { plan_version: 'v2' }))]);
  assert.deepEqual(f.call('status').state.completed_milestones, ['one']);
});

test('blocked and failed end invocation; resolution needs evidence and never promotes', t => {
  const f = fixture(t);
  f.call('delegate', ['--milestone', 'one']);
  const blocked = f.call('blocked', ['--milestone', 'one', '--status', 'BLOCKED',
    '--blocker', 'Authorization missing', '--evidence', 'permission denied']);
  assert.equal(f.call('status').state.current_milestone, null);
  f.call('complete', [], 'InvariantViolationError');
  const id = blocked.blockers[0].id;
  f.call('resolve-blocker', ['--id', id], 'TypeError');
  f.call('resolve-blocker', ['--id', id, '--evidence', 'user supplied authorization']);
  assert.deepEqual(f.call('status').state.completed_milestones, []);
  f.call('delegate', ['--milestone', 'one']);
  f.call('blocked', ['--milestone', 'one', '--status', 'FAILED', '--evidence', 'executor exited']);
  assert.equal(f.call('status').state.current_milestone, null);
});

const roleStub = async (role, packet) => {
  assert.equal(role, 'bulldozer');
  const contract = JSON.parse(packet.task.slice(packet.task.indexOf('\n') + 1));
  return { ok: true, response: JSON.stringify(candidate(contract.milestone_id, contract.plan_version)) };
};

test('run-milestone suspends at durable Zen request; fresh record-zen resumes it', { timeout: 5000 }, async t => {
  const f = fixture(t);
  const result = await execute(f.args('run-milestone', '--milestone', 'one'), { invokeRole: roleStub });
  assert.equal(result.status, 'AWAITING_ZEN');
  assert.equal(result.verified, false);
  const request = result.zen_request;
  const disk = AuthoritativeLedger.load(f.ledger).getState();
  assert.equal(disk.current_milestone, 'one');
  assert.deepEqual(disk.completed_milestones, []);
  assert.equal(disk.evidence[request.result_ref].result_ref, request.result_ref);
  assert.deepEqual(request.contract.bounded_scope, ['one.txt']);
  f.call('record-zen', ['--file', f.json(verdict(request.result_ref))]);
  assert.deepEqual(f.call('status').state.completed_milestones, ['one']);
});

for (const wrapped of [false, true]) {
  test(`run-milestone invokes external Zen over real stdin/stdout; envelope=${wrapped}`, { timeout: 5000 }, async t => {
    const f = fixture(t);
    const script = join(f.dir, 'zen.mjs');
    writeFileSync(script, `import {readFileSync} from 'node:fs';
const request = JSON.parse(readFileSync(0, 'utf8'));
const disk = JSON.parse(readFileSync(${JSON.stringify(f.ledger)}, 'utf8'));
if (disk.evidence[request.result_ref].result_ref !== request.result_ref) process.exit(2);
const verdict = {milestone_id: request.milestone_id, plan_version: request.plan_version,
result_ref: request.result_ref, verdict: 'GO', verification_evidence: ${JSON.stringify(observed)}};
console.log(JSON.stringify(${wrapped ? "{status: 'SUCCESS', response: JSON.stringify(verdict)}" : 'verdict'}));
`);
    const result = await execute(f.args('run-milestone', '--milestone', 'one', '--zen-cmd',
      `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`), { invokeRole: roleStub });
    assert.equal(result.verified, true);
    assert.deepEqual(f.call('status').state.completed_milestones, ['one']);
  });
}

test('external Zen failure persists invocation failure without promotion', { timeout: 5000 }, async t => {
  const f = fixture(t);
  await assert.rejects(execute(f.args('run-milestone', '--milestone', 'one', '--zen-cmd', 'exit 7'),
    { invokeRole: roleStub }), /Zen command failed/);
  const state = f.call('status').state;
  assert.equal(state.current_milestone, null);
  assert.deepEqual(state.completed_milestones, []);
  assert.equal(state.evidence.one.failure_evidence[0].status, 'INVOCATION_FAILURE');
});

test('invoke-role passthrough and invalid CLI input fail structurally', async t => {
  const f = fixture(t);
  const packet = { task: 'Produce a bounded advisory plan' };
  const result = await execute(f.args('invoke-role', '--role', 'piledriver', '--packet', f.json(packet)), {
    invokeRole: (role, actual) => {
      assert.equal(role, 'piledriver');
      assert.deepEqual(actual, packet);
      return { ok: true, response: '{"advisory":true}' };
    },
  });
  assert.equal(JSON.parse(result.response).advisory, true);
  f.call('status', ['--unknown', 'value'], 'TypeError');
  f.call('blocked', ['--milestone', 'one', '--status', 'GO'], 'InvalidTransitionError');
});
