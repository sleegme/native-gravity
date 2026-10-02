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
  milestones: ['one', 'two'].map((id, index) => ({
    id, title: id, objective: `Deliver ${id}`, bounded_scope: [`${id}.txt`],
    acceptance_criteria: ['content matches milestone ID'], non_goals: ['activation'],
    dependencies: index ? ['one'] : [],
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

function fixture(t, { output, review, initialPlan = plan(), invokeSpecialist } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-spine-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledgerPath = join(dir, 'ledger.json');
  const calls = [];
  let spine;
  const invokeRole = async (role, packet, runnerOptions = {}) => {
    calls.push(role);
    // Exercise the shipped runner boundary, not an invented packet transport.
    assert.ok(composeBoundedPrompt(role, packet));
    const contract = JSON.parse(packet.task.slice(packet.task.indexOf('\n') + 1));
    if (role === 'piledriver') return envelope({ recommendation: 'retain plan' });
    assert.equal(role, 'bulldozer');
    if (output) return envelope(await output(contract, { spine, dir, calls, runnerOptions }));
    // Model only the native host: Bobcat creates a real artifact and reports
    // READY inside Bulldozer, which independently checks it before issuing DONE.
    calls.push('bobcat');
    const artifact = join(dir, `${contract.milestone_id}.txt`);
    writeFileSync(artifact, contract.milestone_id);
    const worker = { status: 'READY', artifact };
    assert.equal(worker.status, 'READY');
    assert.equal(readFileSync(worker.artifact, 'utf8'), contract.milestone_id);
    const hash = createHash('sha256').update(readFileSync(artifact)).digest('hex');
    return envelope(candidate(contract, { candidate_artifact_ref: `sha256:${hash}` }));
  };
  const defaultInvokeSpecialist = async (role, packet, options) => {
    calls.push(role);
    if (role === 'jaguar') {
      return { status: 'SUCCESS', findings: [`factual discovery for ${packet.milestone_id}`] };
    }
    if (role === 'puma') {
      return { status: 'READY', edits: [`mechanical text edit for ${packet.milestone_id}`] };
    }
    if (role === 'bobcat') {
      const artifact = join(dir, `${packet.milestone_id}.txt`);
      writeFileSync(artifact, packet.milestone_id);
      return { status: 'READY', artifact };
    }
    if (role === 'strix-halo') {
      return { verdict: 'ACCEPT', notes: 'contract verified locally' };
    }
    throw new Error(`Unexpected specialist role: ${role}`);
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
  const options = {
    ledgerPath,
    invokeRole,
    invokeZen,
    invokeSpecialist: invokeSpecialist ?? defaultInvokeSpecialist,
  };
  spine = new MinimalSpine({ ...options, plan: initialPlan });
  return { spine, options, calls, ledgerPath, dir };
}

test('planning stays advisory; native work and independent GO survive fresh resume', { timeout: 3000 }, async t => {
  const f = fixture(t);
  const before = f.spine.state;
  await f.spine.requestPlan('Assess the existing plan');
  assert.deepEqual(f.spine.state, before);
  await assert.rejects(f.spine.runMilestone('two'));
  assert.equal((await f.spine.runMilestone('one')).verified, true);
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
  test(`candidate status ${String(status)} is not explicit DONE`, async t => {
    const f = fixture(t, { output: contract => candidate(contract, { status }) });
    await assert.rejects(f.spine.runMilestone('one'), /explicit Bulldozer DONE/);
    assert.ok(!f.calls.includes('zen'));
    assert.deepEqual(f.spine.state.completed_milestones, []);
    assert.equal(f.spine.state.current_milestone, null);
    assert.throws(() => f.spine.declareGlobalCompletion());
  });
}

test('construction cannot omit the independent Zen adapter', t => {
  const f = fixture(t);
  assert.throws(() => new MinimalSpine({ ledgerPath: f.ledgerPath }), /Zen/);
});

test('prose in a SUCCESS envelope persists a typed failure without promotion', async t => {
  const f = fixture(t);
  const spine = new MinimalSpine({
    ...f.options,
    invokeRole: () => parseResponseEnvelope(JSON.stringify({
      status: 'SUCCESS', response: 'I have delegated the work and am awaiting findings.',
    })),
  });
  await assert.rejects(spine.runMilestone('one'), /INVALID_RESPONSE_FORMAT/);
  const saved = new MinimalSpine(f.options).state;
  assert.deepEqual(saved.completed_milestones, []);
  assert.equal(saved.current_milestone, null);
  assert.ok(JSON.stringify(saved.evidence).includes('INVALID_RESPONSE_FORMAT'));
  assert.ok(!f.calls.includes('zen'));
});

for (const field of ['verdict', 'zen_verdict', 'result_ref']) {
  test(`candidate cannot supply supervisor or reviewer authority: ${field}`, async t => {
    const f = fixture(t, { output: contract => candidate(contract, { [field]: 'GO' }) });
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
  test(`invalid independent review cannot promote: ${JSON.stringify(patch)}`, async t => {
    const f = fixture(t, { review: request => verdict(request, patch) });
    await assert.rejects(f.spine.runMilestone('one'));
    assert.deepEqual(f.spine.state.completed_milestones, []);
    assert.deepEqual(new MinimalSpine(f.options).state.completed_milestones, []);
  });
}

test('NO-GO preserves incompletion; a repaired artifact gets a distinct reviewed reference', async t => {
  let attempt = 0;
  const refs = [];
  const f = fixture(t, {
    output: contract => candidate(contract, { candidate_artifact_ref: `sha256:revision-${++attempt}` }),
    review: request => {
      refs.push(request.result_ref);
      return verdict(request, { verdict: attempt === 1 ? 'NO-GO' : 'GO' });
    },
  });
  assert.equal((await f.spine.runMilestone('one')).verified, false);
  assert.deepEqual(f.spine.state.completed_milestones, []);
  assert.equal(f.spine.state.current_milestone, null);
  assert.equal((await f.spine.runMilestone('one')).verified, true);
  assert.notEqual(refs[0], refs[1]);
});

for (const status of ['BLOCKED', 'NEEDS_DEEP']) {
  test(`${status} returns evidence without promotion or automatic planner invocation`, async t => {
    const f = fixture(t, { output: contract => candidate(contract, {
      status,
      blockers: [{ id: 'b1', description: 'required capability unavailable', affects_milestone: 'one', escalation_path: 'supervisor' }],
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

test('pending review forbids concurrent work, replan, completion, and resumed retry', { timeout: 3000 }, async t => {
  let enterReview;
  let releaseReview;
  // Subscribe before starting the milestone; there are no sleeps or polling.
  const entered = new Promise(resolve => { enterReview = resolve; });
  const released = new Promise(resolve => { releaseReview = resolve; });
  const f = fixture(t, { review: async request => {
    enterReview();
    await released;
    return verdict(request);
  } });
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

test('material replan invalidates old GO and requires fresh dependency-ordered review', async t => {
  let oldVerdict;
  let reuseOld = false;
  const f = fixture(t, { review: request => {
    if (reuseOld) return oldVerdict;
    oldVerdict = verdict(request);
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

test('review invocation failure is persisted and rethrown', async t => {
  const f = fixture(t, { review: () => { throw new Error('native review failed'); } });
  await assert.rejects(f.spine.runMilestone('one'), /native review failed/);
  const disk = new MinimalSpine(f.options).state;
  assert.equal(disk.current_milestone, null);
  assert.deepEqual(disk.completed_milestones, []);
  assert.ok(JSON.stringify(disk.evidence).includes('native review failed'));
});

test('interrupted durable invocation requires observed recovery before retry', async t => {
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

test('candidate must bind current identity and immutable artifact versions', async t => {
  for (const patch of [{ plan_version: 'v0' }, { milestone_id: 'two' }, { candidate_artifact_ref: undefined }]) {
    const f = fixture(t, { output: contract => candidate(contract, patch) });
    await assert.rejects(f.spine.runMilestone('one'));
    assert.ok(!f.calls.includes('zen'));
    assert.deepEqual(f.spine.state.completed_milestones, []);
  }
});

test('specialists can be invoked under an active milestone without touching ledger state', async t => {
  let diskBefore;
  const f = fixture(t, {
    output: async (contract, { spine, dir }) => {
      // Record disk ledger state before any specialist call
      diskBefore = readFileSync(f.ledgerPath, 'utf8');

      // 1. Bulldozer invokes Jaguar for read-only retrieval
      const jaguarResult = await spine.invokeJaguar({ query: 'inspect existing components' });
      assert.deepEqual(jaguarResult, { status: 'SUCCESS', findings: ['factual discovery for one'] });

      // Ledger on disk is completely untouched by specialist invocation
      assert.equal(readFileSync(f.ledgerPath, 'utf8'), diskBefore);
      assert.deepEqual(spine.state.completed_milestones, []);
      assert.equal(spine.state.current_milestone, 'one');

      // 2. Bulldozer invokes Puma for mechanical edits
      const pumaResult = await spine.invokePuma({ files: ['one.txt'], instruction: 'format' });
      assert.deepEqual(pumaResult, { status: 'READY', edits: ['mechanical text edit for one'] });

      // Ledger on disk is still untouched
      assert.equal(readFileSync(f.ledgerPath, 'utf8'), diskBefore);
      assert.deepEqual(spine.state.completed_milestones, []);

      // 3. Bulldozer invokes Bobcat for implementation
      // Inside Bobcat: Bobcat invokes Strix Halo for local gate
      const bobcatResult = await spine.invokeBobcat({ task: 'implement feature', advisor_gate: 'REQUIRED' });
      assert.equal(bobcatResult.status, 'READY');

      const strixResult = await spine.invokeStrixHalo({ task: 'check implementation' }, { caller: 'bobcat' });
      assert.equal(strixResult.verdict, 'ACCEPT');

      // Ledger on disk is STILL untouched
      assert.equal(readFileSync(f.ledgerPath, 'utf8'), diskBefore);
      assert.deepEqual(spine.state.completed_milestones, []);

      // Bulldozer produces candidate with observed evidence
      const artifact = bobcatResult.artifact;
      const hash = createHash('sha256').update(readFileSync(artifact)).digest('hex');
      return candidate(contract, {
        candidate_artifact_ref: `sha256:${hash}`,
        verification_evidence: [
          ...observed,
          { classification: 'OBSERVED', specialist: 'jaguar', findings: jaguarResult.findings },
          { classification: 'OBSERVED', specialist: 'puma', edits: pumaResult.edits },
          { classification: 'OBSERVED', specialist: 'strix-halo', verdict: strixResult.verdict },
        ],
      });
    },
  });

  const res = await f.spine.runMilestone('one');
  assert.equal(res.verified, true);
  assert.deepEqual(f.calls, ['bulldozer', 'jaguar', 'puma', 'bobcat', 'strix-halo', 'zen']);
  assert.deepEqual(f.spine.state.completed_milestones, ['one']);
  assert.equal(f.spine.state.current_milestone, null);
});

test('specialists receive milestone packet slice and never ledger or global authority', async t => {
  let capturedPacket;
  const f = fixture(t, {
    invokeSpecialist: async (role, packet) => {
      capturedPacket = packet;
      return { status: 'SUCCESS', received: true };
    },
    output: async (contract, { spine }) => {
      await spine.invokeSpecialist('jaguar', { task: 'retrieval task', search_path: 'docs/' });
      // Assert forbidden fields are rejected
      for (const field of ['ledger', 'ledgerPath', 'save', 'declareGlobalCompletion', 'completed_milestones', 'verdict', 'zen_verdict', 'result_ref']) {
        await assert.rejects(
          spine.invokeSpecialist('jaguar', { task: 'bad', [field]: 'forbidden-value' }),
          new RegExp(`Specialists cannot receive ledger or global authority: "${field}" is prohibited`)
        );
      }
      writeFileSync(join(f.dir, `${contract.milestone_id}.txt`), contract.milestone_id);
      const hash = createHash('sha256').update(contract.milestone_id).digest('hex');
      return candidate(contract, { candidate_artifact_ref: `sha256:${hash}` });
    },
  });

  await f.spine.runMilestone('one');
  assert.equal(capturedPacket.milestone_id, 'one');
  assert.equal(capturedPacket.plan_version, 'v1');
  assert.equal(capturedPacket.objective, 'Deliver one');
  assert.deepEqual(capturedPacket.bounded_scope, ['one.txt']);
  assert.deepEqual(capturedPacket.non_goals, ['activation']);
  assert.deepEqual(capturedPacket.acceptance_criteria, ['content matches milestone ID']);
  assert.equal(capturedPacket.task, 'retrieval task');
  assert.equal(capturedPacket.search_path, 'docs/');
  assert.equal(capturedPacket.ledger, undefined);
  assert.equal(capturedPacket.ledgerPath, undefined);
  assert.equal(capturedPacket.declareGlobalCompletion, undefined);
  assert.equal(capturedPacket.completed_milestones, undefined);
});

test('specialist invocation is prohibited without an active milestone', async t => {
  const f = fixture(t);
  assert.equal(f.spine.state.current_milestone, null);
  for (const role of ['jaguar', 'puma', 'bobcat', 'strix-halo']) {
    await assert.rejects(
      f.spine.invokeSpecialist(role, { task: 'work' }),
      /Specialist invocation requires an active milestone/
    );
  }
  await assert.rejects(f.spine.invokeJaguar({ query: 'find' }), /Specialist invocation requires an active milestone/);
  await assert.rejects(f.spine.invokePuma({ files: [] }), /Specialist invocation requires an active milestone/);
  await assert.rejects(f.spine.invokeBobcat({ task: 'code' }), /Specialist invocation requires an active milestone/);
  await assert.rejects(f.spine.invokeStrixHalo({ task: 'gate' }), /Specialist invocation requires an active milestone/);
});

test('specialist routing strictly enforces caller-role boundaries', async t => {
  const f = fixture(t, {
    output: async (contract, { spine }) => {
      // 1. Bulldozer cannot invoke Strix Halo directly (Strix Halo is Bobcat-local gate)
      await assert.rejects(
        spine.invokeSpecialist('strix-halo', { task: 'review' }, { caller: 'bulldozer' }),
        /Strix Halo is a Bobcat-local advisor gate; Bulldozer cannot invoke Strix Halo directly/
      );

      // 2. Bobcat cannot invoke Jaguar, Puma, or Bobcat
      for (const forbidden of ['jaguar', 'puma', 'bobcat']) {
        await assert.rejects(
          spine.invokeSpecialist(forbidden, { task: 'work' }, { caller: 'bobcat' }),
          new RegExp(`Bobcat may invoke only Strix Halo; cannot invoke "${forbidden}"`)
        );
      }

      // 3. Jaguar, Puma, Strix Halo cannot invoke any subagents
      for (const caller of ['jaguar', 'puma', 'strix-halo']) {
        await assert.rejects(
          spine.invokeSpecialist('jaguar', { task: 'work' }, { caller }),
          new RegExp(`Specialist "${caller}" has no delegation authority and cannot invoke subagents`)
        );
      }

      // 4. Unauthorized callers (e.g. steamroller or unknown) cannot invoke specialists
      for (const caller of ['steamroller', 'piledriver', 'zen', 'external']) {
        await assert.rejects(
          spine.invokeSpecialist('jaguar', { task: 'work' }, { caller }),
          new RegExp(`Caller "${caller}" is not authorized to invoke specialists under a milestone`)
        );
      }

      // 5. Cannot invoke non-specialist roles via specialist routing
      for (const role of ['zen', 'piledriver', 'steamroller', 'bulldozer', 'unknown-role']) {
        await assert.rejects(
          spine.invokeSpecialist(role, { task: 'work' }),
          new RegExp(`Unknown or disallowed specialist role: "${role}"`)
        );
      }
      writeFileSync(join(f.dir, `${contract.milestone_id}.txt`), contract.milestone_id);
      const hash = createHash('sha256').update(contract.milestone_id).digest('hex');
      return candidate(contract, { candidate_artifact_ref: `sha256:${hash}` });
    },
  });

  await f.spine.runMilestone('one');
});

test('Strix Halo REVISE leads to repair and re-check before Bobcat READY', async t => {
  let strixAttempts = 0;
  const f = fixture(t, {
    invokeSpecialist: async (role, packet) => {
      if (role === 'strix-halo') {
        strixAttempts++;
        if (strixAttempts === 1) {
          return { verdict: 'REVISE', defect: 'Missing boundary check on empty input' };
        }
        return { verdict: 'ACCEPT', notes: 'Defect corrected and verified' };
      }
      return { status: 'READY' };
    },
    output: async (contract, { spine, dir }) => {
      // Bobcat simulates implementation and checks with Strix Halo
      const check1 = await spine.invokeStrixHalo({ task: 'check v1' }, { caller: 'bobcat' });
      assert.equal(check1.verdict, 'REVISE');
      assert.equal(check1.defect, 'Missing boundary check on empty input');

      // Bobcat repairs and re-checks
      const check2 = await spine.invokeStrixHalo({ task: 'check v2 after repair' }, { caller: 'bobcat' });
      assert.equal(check2.verdict, 'ACCEPT');

      const artifact = join(dir, `${contract.milestone_id}.txt`);
      writeFileSync(artifact, contract.milestone_id);
      const hash = createHash('sha256').update(readFileSync(artifact)).digest('hex');
      return candidate(contract, { candidate_artifact_ref: `sha256:${hash}` });
    },
  });

  const res = await f.spine.runMilestone('one');
  assert.equal(res.verified, true);
  assert.equal(strixAttempts, 2);
  assert.deepEqual(f.spine.state.completed_milestones, ['one']);
});

test('Strix Halo NEEDS_DEEP escalates through Bobcat and Bulldozer without bypassing Steamroller', async t => {
  const f = fixture(t, {
    invokeSpecialist: async (role, packet) => {
      if (role === 'strix-halo') {
        return {
          verdict: 'NEEDS_DEEP',
          question: 'Ambiguous API contract requires architectural decision',
        };
      }
      return { status: 'READY' };
    },
    output: async (contract, { spine }) => {
      const strix = await spine.invokeStrixHalo({ task: 'check' }, { caller: 'bobcat' });
      assert.equal(strix.verdict, 'NEEDS_DEEP');
      // Bobcat reports NEEDS_DEEP to Bulldozer; Bulldozer returns NEEDS_DEEP candidate
      return candidate(contract, {
        status: 'NEEDS_DEEP',
        escalation_needs: [strix.question],
      });
    },
  });

  const res = await f.spine.runMilestone('one');
  assert.equal(res.status, 'NEEDS_DEEP');
  assert.equal(res.verified, false);
  assert.ok(!f.calls.includes('zen'));
  assert.deepEqual(f.spine.state.completed_milestones, []);
  assert.equal(f.spine.state.current_milestone, null);
});

