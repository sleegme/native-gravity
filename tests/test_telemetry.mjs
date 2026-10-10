import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MinimalSpine } from '../scripts/spine.mjs';
import {
  isSecretEnvName,
  projectFailureTelemetry,
  redactTelemetryText,
  redactTelemetryValue,
} from '../scripts/telemetry.mjs';
import { composeBoundedPrompt, parseResponseEnvelope } from '../scripts/runner.mjs';

// NTG #114 — PO option B: Piledriver replan visibility = which artifact/lane
// failed + the failed step's tool args / command line (tier B), with a
// documented redaction list. Prompt text, role text and contract fragments
// (tier C) must never reach the packet.

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
const envelope = value => parseResponseEnvelope(JSON.stringify({
  status: 'SUCCESS', response: JSON.stringify(value),
}));

function fixture(t, { bulldozer, zen, piledriver, invokeSpecialist, initialPlan = plan() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-telemetry-'));
  let spine;
  t.after(() => {
    // Release the ledger lock before removing the dir; the lock's own
    // exit-cleanup would otherwise unlink a path that is already gone.
    spine?.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const ledgerPath = join(dir, 'ledger.json');
  const packets = [];
  spine = new MinimalSpine({
    ledgerPath,
    plan: initialPlan,
    invokeSpecialist,
    invokeRole: async (role, packet, runnerOptions = {}) => {
      // Exercise the shipped runner boundary, not an invented packet transport.
      assert.ok(composeBoundedPrompt(role, packet));
      const contract = JSON.parse(packet.task.slice(packet.task.indexOf('\n') + 1));
      packets.push({ role, contract });
      if (role === 'piledriver') {
        return envelope(piledriver ? await piledriver(contract, { spine, dir }) : { recommendation: 'retain plan' });
      }
      assert.equal(role, 'bulldozer');
      const res = await bulldozer(contract, { spine, dir });
      // A raw {ok:false} result models a transport/envelope failure; anything
      // else models a SUCCESS envelope carrying the response packet.
      if (res && typeof res === 'object' && res.ok === false) return res;
      return envelope(res);
    },
    invokeZen: async (request) => zen ? zen(request) : ({
      milestone_id: request.milestone_id, plan_version: request.plan_version,
      result_ref: request.result_ref, verdict: 'GO', verification_evidence: observed,
    }),
  });
  const piledriverContract = () => {
    const call = packets.find(p => p.role === 'piledriver');
    assert.ok(call, 'piledriver packet was captured');
    return call.contract;
  };
  return { spine, packets, piledriverContract, dir };
}

// ---------------------------------------------------------------------------
// Redaction list (documented in scripts/telemetry.mjs + contract §4.3)
// ---------------------------------------------------------------------------

test('redaction list covers env-var names, common secret patterns, and user paths', () => {
  // Env-var names flagged as secret-bearing.
  for (const name of ['SECRET', 'GITHUB_TOKEN', 'MY_API_KEY', 'DB_PASSWORD', 'AUTH_HEADER', 'CREDENTIALS']) {
    assert.equal(redactTelemetryText(`${name}=hunter2`), `${name}=<redacted>`);
  }
  // Non-secret assignments pass through.
  assert.equal(redactTelemetryText('DEBUG=1 HOME=/x'), 'DEBUG=1 HOME=/x');
  assert.equal(isSecretEnvName('NODE_ENV'), false);

  // Common secret patterns.
  assert.equal(redactTelemetryText('ghp_abcdefghijklmnop1234'), '<redacted>');
  assert.equal(redactTelemetryText('github_pat_11ABCDEFG0abcdefghij_klmnop'), '<redacted>');
  assert.equal(redactTelemetryText('sk-projabcdef1234567890abcd'), '<redacted>');
  assert.equal(redactTelemetryText('AKIAIOSFODNN7EXAMPLE'), '<redacted>');
  assert.equal(redactTelemetryText('xoxb-1234567890-abcdefghijkl'), '<redacted>');
  assert.equal(
    redactTelemetryText('eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_BYgL0ix3wd'),
    '<redacted>');
  assert.equal(redactTelemetryText('Bearer abcdefghijklmnopqrstuvwxyz123456'), '<redacted>');
  assert.equal(
    redactTelemetryText('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'),
    '<redacted>');

  // Absolute user paths become a generic local-path marker.
  assert.equal(redactTelemetryText('edit /home/sleeg/work/native-gravity/x.mjs'), 'edit (local path)');
  assert.equal(redactTelemetryText('open /Users/sleeg/project/x.txt'), 'open (local path)');

  // Artifact digests and ordinary values are untouched.
  const digest = 'sha256:' + createHash('sha256').update('x').digest('hex');
  assert.equal(redactTelemetryText(digest), digest);
  assert.equal(redactTelemetryText('plain log line'), 'plain log line');

  // Redaction is idempotent and deep for structured args.
  assert.equal(redactTelemetryText(redactTelemetryText('ghp_abcdefghijklmnop1234')), '<redacted>');
  assert.deepEqual(
    redactTelemetryValue({ a: ['t=/home/u/f', 'API_KEY=zzz'], b: { c: 'plain' } }),
    { a: ['t=(local path)', 'API_KEY=<redacted>'], b: { c: 'plain' } });
});

test('projectFailureTelemetry keeps only failure records at argument granularity', () => {
  const telemetry = projectFailureTelemetry({
    'm1': {
      failure_evidence: [{
        status: 'INVOCATION_FAILURE',
        timestamp: '2026-10-10T00:00:00.000Z',
        escalation_needs: null,
        evidence: {
          classification: 'OBSERVED',
          error: 'huge raw error blob',
          transcript_ref: '/tmp/x.transcripts/abc.txt',
          failed_step: { tool: 'runner.invoke', args: { role: 'bulldozer', slug: 'gemini-3.8-flash-high' }, command: 'agy --model gemini-3.8-flash-high --output-format json --print (prompt withheld)' },
        },
      }],
      // Tier-C material that must be dropped entirely.
      active_candidate: { payload: { prompt_echo: 'worker packet' } },
      candidates: [{ payload: 'full worker packet' }],
    },
    'sha256:resultref': { payload: 'keyed candidate record' },
    'm2': { failure_evidence: [] },
  });
  assert.deepEqual(Object.keys(telemetry), ['m1']);
  const [record] = telemetry.m1;
  assert.equal(record.milestone_id, 'm1');
  assert.equal(record.status, 'INVOCATION_FAILURE');
  assert.equal(record.failed_step.tool, 'runner.invoke');
  assert.equal(record.failed_step.command.includes('(prompt withheld)'), true);
  assert.equal(record.transcript_ref, '/tmp/x.transcripts/abc.txt');
  assert.equal('error' in record, false);
  assert.equal(JSON.stringify(telemetry).includes('raw error blob'), false);
  assert.equal(JSON.stringify(telemetry).includes('worker packet'), false);
});

// ---------------------------------------------------------------------------
// Tier-B packet projection through MinimalSpine.requestPlan (#114 criterion 1)
// ---------------------------------------------------------------------------

test('BLOCKED milestone exposes failed artifact/lane id, class and blockers to Piledriver', async t => {
  const f = fixture(t, {
    bulldozer: (contract) => candidate(contract, {
      status: 'BLOCKED',
      blockers: [{ description: 'rebase conflict in generated artifact' }],
      escalation_needs: 'decide whether to split milestone one',
    }),
  });

  const result = await f.spine.runMilestone('one');
  assert.equal(result.status, 'BLOCKED');
  await f.spine.requestPlan('Replan around the blocker');

  const contract = f.piledriverContract();
  assert.equal('ledger' in contract, false);
  const ctx = contract.replan_context;
  assert.equal(ctx.telemetry_tier, 'B');
  assert.equal(ctx.plan_version, 'v1');
  assert.equal(ctx.blockers.length, 1);
  assert.equal(ctx.blockers[0].description, 'rebase conflict in generated artifact');
  const [failure] = ctx.failure_telemetry.one;
  assert.equal(failure.milestone_id, 'one');
  assert.equal(failure.status, 'BLOCKED');
  assert.equal(failure.escalation_needs, 'decide whether to split milestone one');
  // The worker packet itself (candidate blob) is tier-C and must not surface.
  const serialized = JSON.stringify(ctx);
  assert.equal(serialized.includes('changes_made'), false);
  assert.equal(serialized.includes('verification_evidence'), false);
});

test('INVOCATION_FAILURE exposes the failed step tool args and command line, never the prompt', async t => {
  const f = fixture(t, {
    // A failed agy transport result; #exact attaches the tier-B failed step.
    bulldozer: async () => ({
      ok: false, error: 'EXECUTION_FAILED', role: 'bulldozer',
      slug: 'gemini-3.8-flash-high', exitCode: 1, stderr: 'model blew up',
    }),
  });

  await assert.rejects(f.spine.runMilestone('one'));
  await f.spine.requestPlan('Replan after transport failure');

  const [failure] = f.piledriverContract().replan_context.failure_telemetry.one;
  assert.equal(failure.milestone_id, 'one');
  assert.equal(failure.status, 'INVOCATION_FAILURE');
  assert.equal(failure.failed_step.tool, 'runner.invoke');
  assert.equal(failure.failed_step.args.role, 'bulldozer');
  assert.equal(failure.failed_step.args.slug, 'gemini-3.8-flash-high');
  assert.equal(failure.failed_step.args.error, 'EXECUTION_FAILED');
  assert.equal(failure.failed_step.command.includes('--print (prompt withheld)'), true);
  assert.equal(failure.failed_step.command.includes('--dangerously-skip-permissions'), true);
  // No raw stderr/prompt blob escapes into the planning packet.
  assert.equal(JSON.stringify(f.piledriverContract()).includes('model blew up'), false);
});

test('specialist invocation failure records the subagent tool args as the failed step', async t => {
  const f = fixture(t, {
    invokeSpecialist: async () => ({ ok: false, error: 'EXECUTION_FAILED', stderr: 'worker crashed' }),
    bulldozer: async (_contract, { spine }) => {
      // Bulldozer delegates bounded work; the subagent transport fails.
      await spine.invokeSpecialist('bobcat', { task: 'SUPERSECRET_CANARY delegated prompt text' });
      return { ok: false, error: 'unreachable' };
    },
  });

  await assert.rejects(f.spine.runMilestone('one'));
  await f.spine.requestPlan('Replan after specialist failure');

  const [failure] = f.piledriverContract().replan_context.failure_telemetry.one;
  assert.equal(failure.status, 'INVOCATION_FAILURE');
  assert.equal(failure.failed_step.tool, 'invoke_subagent');
  assert.equal(failure.failed_step.args.role, 'bobcat');
  assert.equal(failure.failed_step.args.caller, 'bulldozer');
  assert.ok(failure.failed_step.args.slice_keys.includes('task'));
  // The delegated slice content is prompt material — only its shape is telemetry.
  assert.equal(JSON.stringify(f.piledriverContract()).includes('SUPERSECRET_CANARY'), false);
});

test('Zen NO-GO verdicts reach Piledriver as summaries without verdict detail blobs', async t => {
  const f = fixture(t, {
    bulldozer: (contract) => candidate(contract),
    zen: (request) => ({
      milestone_id: request.milestone_id, plan_version: request.plan_version,
      result_ref: request.result_ref, verdict: 'NO-GO',
      verification_evidence: [{ classification: 'OBSERVED', criterion: 'acceptance', result: 'artifact missing section' }],
      repair_needs: 'restore the dropped acceptance section',
      // A detail field that must not be projected to the planner.
      prompt_echo: 'CANARY_CONTRACT_FRAGMENT full verdict packet',
    }),
  });

  const result = await f.spine.runMilestone('one');
  assert.equal(result.status, 'DONE');
  assert.equal(result.verified, false);
  await f.spine.requestPlan('Replan after NO-GO');

  const ctx = f.piledriverContract().replan_context;
  const summary = ctx.verification_summary.one;
  assert.equal(summary.verdict, 'NO-GO');
  assert.equal(summary.repair_needs, 'restore the dropped acceptance section');
  assert.equal(summary.result_ref, result.result_ref);
  const serialized = JSON.stringify(f.piledriverContract());
  assert.equal(serialized.includes('CANARY_CONTRACT_FRAGMENT'), false);
  assert.equal(serialized.includes('prompt_echo'), false);
});

// ---------------------------------------------------------------------------
// Redaction end-to-end through the ledger (#114 criterion 2)
// ---------------------------------------------------------------------------

test('secrets and user paths in failure telemetry are redacted before Piledriver sees them', async t => {
  const f = fixture(t, {
    bulldozer: (contract) => candidate(contract, {
      status: 'BLOCKED',
      blockers: [{ description: 'cannot write /home/sleeg/work/private/artifact.bin' }],
      escalation_needs: 'rerun with GITHUB_TOKEN=ghp_abcdefghijklmnop1234 scoped to repo',
    }),
  });

  await f.spine.runMilestone('one');
  // The ledger itself must not retain raw secrets in failure telemetry.
  const onDisk = JSON.stringify(f.spine.state.evidence.one.failure_evidence);
  assert.equal(onDisk.includes('ghp_abcdefghijklmnop1234'), false);
  assert.equal(onDisk.includes('GITHUB_TOKEN=<redacted>'), true);

  await f.spine.requestPlan('Replan around the blocker');
  const serialized = JSON.stringify(f.piledriverContract().replan_context);
  assert.equal(serialized.includes('ghp_abcdefghijklmnop1234'), false);
  assert.equal(serialized.includes('/home/sleeg/work/private/artifact.bin'), false);
  assert.equal(serialized.includes('(local path)'), true);
  assert.equal(serialized.includes('GITHUB_TOKEN=<redacted>'), true);
});
