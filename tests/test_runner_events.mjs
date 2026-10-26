import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { main } from '../scripts/ntg-vnext.mjs';
import { parseResponseEnvelope } from '../scripts/runner.mjs';

const CLI = new URL('../scripts/ntg-vnext.mjs', import.meta.url).pathname;

const observed = [{ classification: 'OBSERVED', criterion: 'content', result: 'inspected' }];
const plan = (ids = ['one']) => ({
  goal: 'Deliver bounded artifacts', constraints: [], decision_invariants: [], plan_version: 'v1',
  milestones: ids.map((id, index) => ({
    id, title: id, objective: `Deliver ${id}`, bounded_scope: [`${id}.txt`],
    acceptance_criteria: ['content matches'], non_goals: [], dependencies: index ? [ids[index - 1]] : [],
  })),
});
const envelope = value => parseResponseEnvelope(JSON.stringify({ status: 'SUCCESS', response: JSON.stringify(value) }));

const eventsPath = ledger => join(dirname(ledger), 'events.jsonl');
const readEvents = ledger => existsSync(eventsPath(ledger))
  ? readFileSync(eventsPath(ledger), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

const START_KEYS = ['event', 'milestone', 'role', 'ts'];
const END_KEYS = ['duration_ms', 'event', 'milestone', 'role', 'status', 'ts'];

function assertLineShapes(lines) {
  for (const line of lines) {
    const keys = Object.keys(line).sort();
    assert.deepEqual(keys, line.event === 'start' ? START_KEYS : END_KEYS,
      `unexpected schema for event ${line.event}: ${JSON.stringify(line)}`);
    assert.ok(!Number.isNaN(Date.parse(line.ts)), `ts must be ISO-8601: ${line.ts}`);
    if (line.event === 'end') {
      assert.ok(typeof line.status === 'string' && line.status.length > 0, 'end status must be a non-empty string');
      assert.ok(line.duration_ms === null || (typeof line.duration_ms === 'number' && Number.isFinite(line.duration_ms)),
        'end duration_ms must be a finite number or null');
    }
  }
}

function harness(t, { deps: extraDeps = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-runner-events-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = join(dir, 'ledger.json');
  const deps = {
    handleSignals: false,
    invokeRole: async (role, packet) => {
      if (role === 'piledriver') return envelope({ recommendation: 'advisory only' });
      if (role === 'instinct') {
        return envelope({
          current_framing: 'stalled framing', why_current_framing_may_be_wrong: 'untested assumption',
          alternate_hypotheses: [{ hypothesis: 'alt', evidence_basis: 'OBSERVED', discriminating_test: 'run X' }],
          recommendation: 'run X', unknowns: [],
        });
      }
      const contract = JSON.parse(packet.task.slice(packet.task.indexOf('\n') + 1));
      return envelope({
        milestone_id: contract.milestone_id, plan_version: contract.plan_version, status: 'DONE',
        changes_made: contract.bounded_scope, verification_evidence: observed, unresolved_unknowns: [],
        scope_deviations: [], candidate_artifact_ref: `sha256:${contract.milestone_id}`,
      });
    },
    invokeZen: async request => ({
      milestone_id: request.milestone_id, plan_version: request.plan_version, result_ref: request.result_ref,
      verdict: 'GO', verification_evidence: observed, duration_ms: 300,
    }),
    ...extraDeps,
  };
  const write = (name, value) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(value)); return p; };
  const cli = (...argv) => main([argv[0], '--ledger', ledger, ...argv.slice(1)], deps);
  return { cli, write, ledger, dir };
}

test('run emits paired start/end events for execution and review matching ledger usage statuses', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  const { code, out } = await h.cli('run');
  assert.equal(code, 0);
  assert.ok(out.global_completion);

  const lines = readEvents(h.ledger);
  assert.deepEqual(lines.map(l => `${l.role}:${l.event}:${l.milestone}`), [
    'bulldozer:start:one', 'bulldozer:end:one', 'zen:start:one', 'zen:end:one',
  ], 'one start/end pair per runner-dispatched invocation, in dispatch order');
  assertLineShapes(lines);

  const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
  const usage = disk.usage.one;
  assert.deepEqual(usage.map(e => `${e.role}:${e.status}`), ['bulldozer:DONE', 'zen:GO']);
  const bulldozerEnd = lines.find(l => l.role === 'bulldozer' && l.event === 'end');
  const zenEnd = lines.find(l => l.role === 'zen' && l.event === 'end');
  assert.equal(bulldozerEnd.status, usage[0].status, 'end status equals the ledger usage status');
  assert.equal(bulldozerEnd.duration_ms, usage[0].duration_ms, 'end duration equals the ledger usage duration');
  assert.equal(zenEnd.status, usage[1].status);
  assert.equal(zenEnd.duration_ms, usage[1].duration_ms);
  assert.ok(zenEnd.duration_ms >= 0);
});

test('specialist adapter invocations emit events; declared native delegations emit none', async t => {
  const h = harness(t, { deps: {
    invokeRole: async (role, packet, runnerOptions = {}) => {
      if (role !== 'bulldozer') return { ok: true, response: '{}' };
      if (runnerOptions.invokeSpecialist) {
        await runnerOptions.invokeSpecialist('bobcat', { task: 'implement' });
        await runnerOptions.invokeSpecialist('strix-halo', { task: 'review' }, { caller: 'bobcat' });
      }
      return {
        ok: true,
        slug: 'gemini-3.8-flash-high',
        duration_ms: 250,
        response: JSON.stringify({
          milestone_id: 'one', plan_version: 'v1', status: 'DONE',
          changes_made: ['one.txt'], verification_evidence: observed, unresolved_unknowns: [],
          scope_deviations: [], candidate_artifact_ref: 'sha256:one',
          delegations: [{ role: 'jaguar' }],
        }),
      };
    },
    invokeSpecialist: async (role) => {
      if (role === 'bobcat') {
        return { ok: true, slug: 'gemini-3.8-flash-high', duration_ms: 150, response: JSON.stringify({ status: 'READY' }) };
      }
      return { ok: true, slug: 'gemini-3.8-flash-high', duration_ms: 80, response: JSON.stringify({ verdict: 'ACCEPT' }) };
    },
  } });
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  const { code } = await h.cli('run');
  assert.equal(code, 0);

  const lines = readEvents(h.ledger);
  assert.deepEqual(lines.map(l => `${l.role}:${l.event}:${l.status ?? ''}`), [
    'bulldozer:start:',
    'bobcat:start:',
    'bobcat:end:READY',
    'strix-halo:start:',
    'strix-halo:end:ACCEPT',
    'bulldozer:end:DONE',
    'zen:start:',
    'zen:end:GO',
  ], 'adapter-invoked specialists emit paired events in nested dispatch order');
  assert.deepEqual(lines.filter(l => l.role === 'jaguar'), [],
    'a declared delegation is a claim, not an observed invocation: never an event');
  assertLineShapes(lines);

  const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
  const measured = disk.usage.one.filter(e => e.source !== 'declared');
  for (const entry of measured) {
    const end = lines.find(l => l.role === entry.role && l.event === 'end');
    assert.equal(end.status, entry.status, `${entry.role} end status matches ledger`);
    assert.equal(end.duration_ms, entry.duration_ms, `${entry.role} end duration matches ledger`);
  }
});

test('transport failures and thrown invocation errors emit an end whose status matches the ledger', async t => {
  // Transport-level failure: the runner resolves {ok:false, error:'TIMEOUT'}.
  {
    const h = harness(t, { deps: {
      invokeRole: async () => ({ ok: false, error: 'TIMEOUT', role: 'bulldozer', slug: 'gemini-3.8-flash-high' }),
    } });
    await h.cli('init', '--plan', h.write('plan.json', plan()));
    await assert.rejects(h.cli('run'), /bulldozer invocation failed/);
    const lines = readEvents(h.ledger);
    assert.deepEqual(lines.map(l => `${l.role}:${l.event}:${l.status ?? ''}:${l.milestone}`),
      ['bulldozer:start::one', 'bulldozer:end:TIMEOUT:one']);
    assertLineShapes(lines);
    const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
    assert.equal(disk.usage.one[0].status, 'TIMEOUT');
    assert.equal(lines[1].status, disk.usage.one[0].status);
    assert.equal(disk.evidence.one.failure_evidence[0].status, 'INVOCATION_FAILURE');
  }
  // Thrown error: the invocation rejects and the error code becomes the status.
  {
    const h = harness(t, { deps: {
      invokeRole: async () => {
        throw Object.assign(new Error('agy spawn killed'), { code: 'ETIMEDOUT' });
      },
    } });
    await h.cli('init', '--plan', h.write('plan.json', plan()));
    await assert.rejects(h.cli('run'), /agy spawn killed/);
    const lines = readEvents(h.ledger);
    assert.deepEqual(lines.map(l => `${l.role}:${l.event}:${l.status ?? ''}`),
      ['bulldozer:start:', 'bulldozer:end:ETIMEDOUT']);
    const disk = JSON.parse(readFileSync(h.ledger, 'utf8'));
    assert.equal(disk.usage.one[0].status, 'ETIMEDOUT');
    assert.equal(lines[1].status, disk.usage.one[0].status);
    assert.equal(lines[1].duration_ms, disk.usage.one[0].duration_ms);
  }
});

test('event strings pass through telemetry redaction at the runner seam', async t => {
  const h = harness(t, { deps: {
    invokeRole: async () => ({
      ok: false,
      error: 'transport failed after sk-TESTKEY0123456789 at /home/someone/secret/path',
      role: 'bulldozer',
    }),
  } });
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  await assert.rejects(h.cli('run'), /bulldozer invocation failed/);
  const content = readFileSync(eventsPath(h.ledger), 'utf8');
  assert.ok(!content.includes('sk-TESTKEY0123456789'), 'secret token must be redacted in events.jsonl');
  assert.ok(!content.includes('/home/someone'), 'user path must be redacted in events.jsonl');
  assert.ok(content.includes('(local path)'));
});

test('planning and alt invocations emit events with null milestone', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  const planned = await h.cli('plan', '--task', 'reconsider milestones');
  assert.equal(planned.code, 0);
  const alted = await h.cli('alt', '--task', 'why is this stuck?', '--milestone', 'one');
  assert.equal(alted.code, 0);

  const lines = readEvents(h.ledger);
  assert.deepEqual(lines.map(l => `${l.role}:${l.event}:${l.milestone}:${l.status ?? ''}`), [
    'piledriver:start:null:', 'piledriver:end:null:SUCCESS',
    'instinct:start:null:', 'instinct:end:null:SUCCESS',
  ]);
  assertLineShapes(lines);
});

test('an injected event-log failure never changes the run outcome and warns on stderr', async t => {
  const h = harness(t, { deps: {
    eventLog: {
      append: async () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
    },
  } });
  await h.cli('init', '--plan', h.write('plan.json', plan()));

  const warnings = [];
  const originalError = console.error;
  console.error = (...args) => { warnings.push(args.join(' ')); };
  let result;
  try {
    result = await h.cli('run');
  } finally {
    console.error = originalError;
  }
  assert.equal(result.code, 0, 'the run must complete identically without the event log');
  assert.ok(result.out.global_completion);
  assert.deepEqual(JSON.parse(readFileSync(h.ledger, 'utf8')).completed_milestones, ['one']);
  assert.ok(warnings.some(w => w.includes('events.jsonl append failed: EACCES')),
    `expected an append-failure warning, got: ${JSON.stringify(warnings)}`);
});

test('a read-only events.jsonl never changes the run outcome and warns on stderr', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  writeFileSync(eventsPath(h.ledger), '', { mode: 0o444 });
  chmodSync(eventsPath(h.ledger), 0o444);
  t.after(() => { try { chmodSync(eventsPath(h.ledger), 0o644); } catch {} });

  const warnings = [];
  const originalError = console.error;
  console.error = (...args) => { warnings.push(args.join(' ')); };
  let result;
  try {
    result = await h.cli('run');
  } finally {
    console.error = originalError;
  }
  assert.equal(result.code, 0);
  assert.ok(result.out.global_completion, 'the milestone outcome is unchanged by the append failure');
  assert.ok(warnings.some(w => w.includes('events.jsonl append failed: EACCES')),
    `expected an append-failure warning, got: ${JSON.stringify(warnings)}`);
  assert.equal(readFileSync(eventsPath(h.ledger), 'utf8'), '');
});

// A real supervisor takes the ledger lock, emits its start event, then hangs
// mid-invocation with a detached executor, exactly as a killed runner does.
async function killedSupervisor(h, t) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-events-holder-'));
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
setInterval(() => {}, 1 << 30);
`);
  const child = fork(holder, [h.ledger], { stdio: 'ignore' });
  const [message] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
  t.after(() => { try { process.kill(message.executor, 'SIGKILL'); } catch {} });
  return { child, executor: message.executor };
}

test('recover emits the observed end pairing a killed supervisor start', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  const { child } = await killedSupervisor(h, t);
  child.kill('SIGKILL');
  await once(child, 'exit', { signal: AbortSignal.timeout(10000) });
  assert.ok(existsSync(`${h.ledger}.lock`));

  // The dead supervisor's start line is durable before its invocation hangs.
  assert.deepEqual(readEvents(h.ledger).map(l => `${l.role}:${l.event}:${l.milestone}`),
    ['bulldozer:start:one']);

  const recovered = await h.cli('recover', '--evidence', 'supervisor SIGKILLed mid-invocation');
  assert.equal(recovered.code, 0);
  assert.equal(recovered.out.state.current_milestone, null);

  const lines = readEvents(h.ledger);
  assert.deepEqual(lines.map(l => `${l.role}:${l.event}:${l.milestone}:${l.status ?? ''}`), [
    'bulldozer:start:one:',
    'null:end:one:INVOCATION_FAILURE',
  ], 'recover closes the dangling start: unknown role, ledger-mirrored status, unknown duration');
  assert.equal(lines[1].role, null);
  assert.equal(lines[1].duration_ms, null);
  assertLineShapes(lines);
});

test('status and init emit no events', async t => {
  const h = harness(t);
  await h.cli('init', '--plan', h.write('plan.json', plan()));
  await h.cli('status');
  assert.equal(existsSync(eventsPath(h.ledger)), false, 'no invocation, no events file');
});
