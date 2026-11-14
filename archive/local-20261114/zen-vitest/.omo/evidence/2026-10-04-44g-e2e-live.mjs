// 44G step-7 E2E live validation of the isolated MinimalSpine.
// Real invocations: bulldozer/piledriver via production runner invoke()
// (no --agent, no --dangerously-skip-permissions, role bodies default to
// ../docs/specs/vnext/agents). Zen is not a runner role; invokeZen is the
// harness-provided independent host-native call (separate agy process,
// zen.md body, --dangerously-skip-permissions so it can run read-only
// verification commands). No runtime activation, no settings changes.
//
// Usage:
//   node .omo/evidence/2026-10-04-44g-e2e-live.mjs [--dry-run]
//   node .omo/evidence/2026-10-04-44g-e2e-live.mjs --resume-child <ledgerPath>
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MinimalSpine } from '../../scripts/spine.mjs';
import { invoke, parseResponseEnvelope, parseResponsePacket } from '../../scripts/runner.mjs';
import { validateCandidateSemantics } from '../../scripts/ledger.mjs';

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(join(tmpdir(), 'ntg-44g-e2e-'));
const sha = v => createHash('sha256').update(String(v)).digest('hex');
console.log('EVIDENCE_DIRECTORY=' + dir);

const zenBody = readFileSync(join(cwd, 'docs/specs/vnext/agents/zen.md'), 'utf8').trim();
const ZEN_MODEL = 'gemini-3.1-pro-high';
const ZEN_TIMEOUT_MS = 150000;
const records = [];
function record(entry) {
  records.push(entry);
  writeFileSync(join(dir, 'transcript.json'), JSON.stringify(records, null, 2));
}

// Independent Zen invocation: separate agy process, machine-mode packet out.
function invokeZen(request, label) {
  const prompt = zenBody + '\n\n## Machine review request\n'
    + 'You are invoked as the independent reviewer. Verify the candidate against the '
    + 'supplied contract using read-only tools; do not trust the candidate\'s own claims. '
    + 'Check every acceptance_criteria entry against the current artifact. An unmet '
    + 'criterion or missing required evidence is a blocker.\n'
    + 'Return exactly one bare JSON object, no prose and no fences: '
    + '{"milestone_id": string, "plan_version": string, "result_ref": string, '
    + '"verdict": "GO"|"NO-GO", '
    + '"verification_evidence": [{"classification": "OBSERVED", "detail": string}], '
    + '"repair_needs": string (required on NO-GO)}. '
    + 'Every verification_evidence entry must carry classification "OBSERVED" and name '
    + 'the concrete artifact/command you inspected.\n'
    + 'Request:\n' + JSON.stringify(request);
  const args = ['--dangerously-skip-permissions', '-p', prompt, '--model', ZEN_MODEL,
    '--output-format', 'json', '--print-timeout', '120s'];
  record({ type: 'call-start', label: 'zen:' + label,
    invocation: 'harness zen transport (agy, no --agent, skip-permissions for read-only verify tools)',
    command: ['agy', ...args], promptSha256: sha(prompt), startedAt: new Date().toISOString() });
  const t0 = Date.now();
  const result = spawnSync('agy', args, { cwd, encoding: 'utf8', timeout: ZEN_TIMEOUT_MS + 20000, maxBuffer: 20 * 1024 * 1024 });
  const envelope = result.status === 0 && !result.error
    ? parseResponseEnvelope(result.stdout, { role: 'zen', slug: ZEN_MODEL })
    : { ok: false, error: result.error?.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'EXECUTION_FAILED',
        exitCode: result.status, stderr: result.stderr };
  const parsed = parseResponsePacket(envelope);
  record({ type: 'call', label: 'zen:' + label, role: 'zen', model: ZEN_MODEL,
    elapsedMs: Date.now() - t0, exitCode: result.status, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr, parsed });
  if (!parsed.ok) throw new Error('Zen invocation failed: ' + JSON.stringify({ error: parsed.error, parsed }));
  return parsed.packet;
}

function spineOptions(ledgerPath, label) {
  return {
    ledgerPath,
    runnerOptions: { timeout: 360000 },
    // Production runner path, unmodified: invoke() resolves the slug, composes
    // the bounded prompt from ../docs/specs/vnext/agents, and calls agy with no
    // --agent and no permission flags.
    invokeRole: async (role, packet, opts) => {
      record({ type: 'call-start', label: `${label}:${role}`,
        invocation: 'production invoke()',
        packetSha256: sha(JSON.stringify(packet)), packet,
        startedAt: new Date().toISOString() });
      const t0 = Date.now();
      const out = await invoke(role, packet, opts || {});
      const parsed = parseResponsePacket(out);
      const entry = { type: 'call', label: `${label}:${role}`, role,
        elapsedMs: Date.now() - t0, output: out, parsed };
      if (role === 'bulldozer' && parsed.ok) {
        try {
          validateCandidateSemantics(parsed.packet, {});
          entry.candidateSchema = 'candidate-schema-ok';
          entry.candidate_artifact_ref = parsed.packet.candidate_artifact_ref;
          entry.candidateStatus = parsed.packet.status;
        } catch (e) {
          entry.candidateSchema = String(e);
        }
      }
      record(entry);
      return out;
    },
    invokeZen: request => invokeZen(request, label),
  };
}

const inspectPlan = version => ({
  goal: 'Independently inspect two existing repository facts without writes',
  constraints: ['Read-only inspection; no permission changes; no runtime activation'],
  decision_invariants: [], plan_version: version,
  milestones: ['one', 'two'].map((id, i) => ({
    id, title: id,
    objective: `Use a read-only tool to inspect ${i ? 'package.json version field' : 'README.md project name'}; return observed content`,
    bounded_scope: [i ? 'package.json' : 'README.md'],
    acceptance_criteria: ['Fact independently observed using a tool, not recalled or inferred'],
    non_goals: ['Any file modification'], dependencies: i ? ['one'] : [],
  })),
});

const noGoPlan = {
  goal: 'Observe a repository fact and bind an immutable artifact reference',
  constraints: ['Read-only inspection; no permission changes; no runtime activation'],
  decision_invariants: [], plan_version: 'v1',
  milestones: [{
    id: 'gate', title: 'gate',
    objective: 'Use a read-only tool to inspect the package.json name field; return observed content',
    bounded_scope: ['package.json'],
    acceptance_criteria: [
      'package.json name independently observed using a read-only tool',
      'candidate_artifact_ref is an immutable, content-addressed reference to the delivered artifact (a working-tree file path or mutable ref does not satisfy this)',
    ],
    non_goals: ['Any file modification'], dependencies: [],
  }],
};

// Fresh-process resume: no in-process state can carry over.
function resumeInFreshProcess(ledgerPath) {
  const selfPath = fileURLToPath(import.meta.url);
  const args = [selfPath, '--resume-child', ledgerPath];
  record({ type: 'call-start', label: 'resume-child-process',
    invocation: 'node harness --resume-child', command: ['node', ...args],
    startedAt: new Date().toISOString() });
  const t0 = Date.now();
  const result = spawnSync('node', args, {
    cwd, encoding: 'utf8', timeout: 700000, maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, NTG_E2E_DIR: dir },
  });
  record({ type: 'resume-child', elapsedMs: Date.now() - t0,
    exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
  if (result.status !== 0) throw new Error('resume child failed: ' + (result.stderr || '').slice(-2000));
  const lines = result.stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

async function tryScenario(label, fn) {
  try {
    return await fn();
  } catch (e) {
    record({ type: 'scenario-error', label, error: String(e) });
    return { __error: String(e) };
  }
}

async function main() {
  if (process.argv.includes('--resume-child')) {
    const ledgerPath = process.argv[process.argv.indexOf('--resume-child') + 1];
    const parentDir = process.env.NTG_E2E_DIR;
    try {
      // Fresh MinimalSpine from the ledger file alone: no plan, no carryover.
      const spine = new MinimalSpine(spineOptions(ledgerPath, 'resumed'));
      const before = spine.state;
      const run = await spine.runMilestone('two');
      const completion = spine.declareGlobalCompletion();
      const out = { resumedFrom: 'ledger-only', before, run, completion, after: spine.state };
      record({ type: 'resume-child-result', out });
      console.log(JSON.stringify(out));
    } finally {
      if (parentDir) copyFileSync(join(dir, 'transcript.json'), join(parentDir, 'resume-child-transcript.json'));
    }
    return;
  }

  const dryRun = process.argv.includes('--dry-run');
  record({ type: 'configuration', cwd, dryRun,
    liveCallsBudget: 'target <=16 agy calls',
    permissionMode: 'production invoke() unmodified (no --agent, no skip flag); harness Zen uses skip flag for read-only verify tools' });

  // ---------- Case 1+3: multi-milestone, then fresh-context resume ----------
  const ledgerA = join(dir, 'ledger-a.json');
  const spine = new MinimalSpine({ ...spineOptions(ledgerA, 'case1'), plan: inspectPlan('v1') });
  const one = dryRun ? { dry: true }
    : await tryScenario('case1-milestone-one', async () => {
      const r = await spine.runMilestone('one');
      record({ type: 'scenario', label: 'case1-milestone-one', result: r, state: spine.state });
      record({ type: 'case-verdict', case: 'case1-milestone-one',
        verdict: (r.status === 'DONE' && r.verdict?.verdict === 'GO' && r.verified === true) ? 'PASS' : 'FAIL',
        observed: { status: r.status, verdict: r.verdict?.verdict, verified: r.verified,
          completed: spine.state.completed_milestones } });
      return r;
    });

  // Case 3: kill the instance, resume in a SEPARATE process from ledgerPath only.
  const canResume = !dryRun && !one.__error && one.verified === true;
  if (!dryRun && !canResume) {
    record({ type: 'case-verdict', case: 'case3-fresh-context-resume', verdict: 'SKIP',
      reason: 'milestone one did not complete; dependency for two unmet' });
  }
  const resumed = dryRun ? { dry: true } : canResume
    ? await tryScenario('case3-fresh-context-resume', () => resumeInFreshProcess(ledgerA))
    : { skipped: true };
  if (!dryRun && canResume && !resumed.__error) {
    const ok = resumed.completion?.completed === true
      && resumed.before?.completed_milestones?.includes('one')
      && !resumed.before?.completed_milestones?.includes('two');
    record({ type: 'case-verdict', case: 'case3-fresh-context-resume',
      verdict: ok ? 'PASS' : 'FAIL',
      observed: { before_completed: resumed.before?.completed_milestones,
        twoStatus: resumed.run?.status, twoVerdict: resumed.run?.verdict?.verdict,
        completion: resumed.completion } });
  }

  // ---------- Case 4: material replan invalidates stale GO ----------
  if (!dryRun) {
    await tryScenario('case4-plan-revision', async () => {
      const spineReplan = new MinimalSpine(spineOptions(ledgerA, 'case4'));
      const beforeReplan = spineReplan.state;
      const v2 = inspectPlan('v2');
      v2.goal = 'Independently inspect two repository facts plus license presence without writes';
      v2.milestones[0].acceptance_criteria = ['Fact independently observed', 'README.md heading text returned verbatim'];
      spineReplan.adoptReplan(v2);
      const afterReplan = spineReplan.state;
      const staleOk = afterReplan.plan_version === 'v2'
        && afterReplan.completed_milestones.length === 0
        && Object.values(afterReplan.verification || {}).every(v => v.is_stale === true)
        && Object.keys(afterReplan.verification || {}).length === Object.keys(beforeReplan.verification || {}).length;
      let completionThrew = false;
      try { spineReplan.declareGlobalCompletion(); } catch { completionThrew = true; }
      // Re-run retained milestone 'one' under v2: needs a fresh candidate + fresh GO.
      const oneV2 = await spineReplan.runMilestone('one');
      const stateAfter = spineReplan.state;
      const freshOk = oneV2.verified === true && oneV2.verdict?.verdict === 'GO'
        && stateAfter.verification?.one?.plan_version === 'v2'
        && stateAfter.verification?.one?.is_stale === false
        && oneV2.result_ref !== beforeReplan.verification?.one?.result_ref;
      record({ type: 'scenario', label: 'case4-plan-revision',
        beforeReplan: { plan_version: beforeReplan.plan_version, verification: beforeReplan.verification,
          completed: beforeReplan.completed_milestones },
        afterReplan: { plan_version: afterReplan.plan_version, verification: afterReplan.verification,
          completed: afterReplan.completed_milestones },
        completionThrew, oneV2 });
      record({ type: 'case-verdict', case: 'case4-plan-revision',
        verdict: staleOk && completionThrew && freshOk ? 'PASS' : 'FAIL',
        observed: { staleOk, completionThrew, freshOk,
          v2VerificationOne: stateAfter.verification?.one } });
    });
  }

  // ---------- Case 2: Zen NO-GO gate ----------
  if (!dryRun) {
    await tryScenario('case2-zen-no-go', async () => {
      const ledgerB = join(dir, 'ledger-b.json');
      const spineB = new MinimalSpine({ ...spineOptions(ledgerB, 'case2'), plan: noGoPlan });
      const gate = await spineB.runMilestone('gate');
      const stateB = spineB.state;
      let completionThrew = false;
      let completionError = null;
      try { spineB.declareGlobalCompletion(); } catch (e) { completionThrew = true; completionError = String(e); }
      const zenNoGo = gate.verdict?.verdict === 'NO-GO';
      const blocked = gate.status === 'BLOCKED' || gate.status === 'NEEDS_DEEP';
      const ok = stateB.completed_milestones.length === 0 && completionThrew && (zenNoGo || blocked);
      record({ type: 'scenario', label: 'case2-zen-no-go', result: gate, state: stateB,
        completionThrew, completionError });
      record({ type: 'case-verdict', case: 'case2-zen-no-go',
        verdict: zenNoGo ? 'PASS' : (ok ? 'PARTIAL' : 'FAIL'),
        observed: { zenVerdict: gate.verdict?.verdict, candidateStatus: gate.status,
          completed: stateB.completed_milestones, completionThrew } });
    });
  }

  // ---------- Advisory: Piledriver requestPlan (planner contract) ----------
  if (!dryRun) {
    await tryScenario('advisory-requestPlan', async () => {
      const spineC = new MinimalSpine({ ...spineOptions(join(dir, 'ledger-c.json'), 'advisory'), plan: inspectPlan('v1') });
      const advice = await spineC.requestPlan('Inspect package.json name via a read-only tool and propose a materially revised v2 plan. Return JSON advice only; do not write.');
      record({ type: 'scenario', label: 'advisory-requestPlan', advice, state: spineC.state });
      record({ type: 'case-verdict', case: 'advisory-requestPlan',
        verdict: advice && typeof advice === 'object' && !('verdict' in advice) ? 'PASS' : 'FAIL',
        observed: advice });
    });
  }

  const calls = records.filter(r => r.type === 'call').length;
  record({ type: 'complete', agyCalls: calls, finishedAt: new Date().toISOString() });
  console.log('AGY_CALLS=' + calls);
  console.log('TRANSCRIPT=' + join(dir, 'transcript.json'));
}

main().catch(e => {
  record({ type: 'fatal', error: String(e), stack: e.stack });
  console.log('TRANSCRIPT=' + join(dir, 'transcript.json'));
  console.error(e);
  process.exitCode = 1;
});
