// Issue #88: deterministic sibling of case2, which can now legitimately get GO.
// Only candidate generation is a fixture; Zen, packet parsing, spine and ledger
// are real. Do not let Bulldozer repair the deliberately mutable artifact ref.
// Usage: node --test .omo/evidence/2026-10-07-44g-case5-zen-no-go-live.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AuthoritativeLedger } from '../../scripts/ledger.mjs';
import { MinimalSpine } from '../../scripts/spine.mjs';
import { parseResponseEnvelope, parseResponsePacket } from '../../scripts/runner.mjs';

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const label = 'case5-zen-no-go-mutable-artifact-ref';
const zenBody = readFileSync(join(cwd, 'docs/specs/vnext/agents/zen.md'), 'utf8').trim();
const ZEN_MODEL = 'gemini-3.1-pro-high';
const plan = {
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

test(label, { timeout: 180000 }, async t => {
  // Given: valid DONE packet and actual observed content, but a mutable path
  // instead of the content-addressed git ref accepted in the case2 solo run.
  const dir = mkdtempSync(join(tmpdir(), 'ntg-44g-case5-'));
  const ledgerPath = join(dir, 'ledger.json');
  const records = [];
  const record = entry => {
    records.push(entry);
    writeFileSync(join(dir, 'transcript.json'), JSON.stringify(records, null, 2));
  };
  console.log('EVIDENCE_DIRECTORY=' + dir);
  const artifactPath = join(cwd, 'package.json');
  const name = JSON.parse(readFileSync(artifactPath, 'utf8')).name;
  const spine = new MinimalSpine({
    ledgerPath, plan,
    invokeRole: async (role, packet) => {
      assert.equal(role, 'bulldozer');
      const contract = JSON.parse(packet.task.slice(packet.task.indexOf('\n') + 1));
      const candidate = {
        milestone_id: contract.milestone_id, plan_version: contract.plan_version,
        status: 'DONE', candidate_artifact_ref: artifactPath, changes_made: [],
        verification_evidence: [{
          classification: 'OBSERVED',
          detail: `Read ${artifactPath} with readFileSync; name field is ${JSON.stringify(name)}.`,
        }],
        unresolved_unknowns: [], scope_deviations: [], blockers: [], escalation_needs: null,
      };
      record({ type: 'candidate-fixture', label, candidate });
      return parseResponseEnvelope(JSON.stringify({
        status: 'SUCCESS', response: JSON.stringify(candidate),
      }), { role });
    },
    invokeZen: request => {
      assert.equal(request.candidate.candidate_artifact_ref, artifactPath);
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
      record({ type: 'call-start', label: 'zen:' + label, request, command: ['agy', ...args] });
      const result = spawnSync('agy', args, {
        cwd, encoding: 'utf8', timeout: 150000, maxBuffer: 20 * 1024 * 1024,
      });
      record({ type: 'call', label: 'zen:' + label, exitCode: result.status,
        error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      const parsed = parseResponsePacket(parseResponseEnvelope(result.stdout, {
        role: 'zen', slug: ZEN_MODEL,
      }));
      assert.equal(parsed.ok, true, JSON.stringify(parsed));
      record({ type: 'zen-verdict', label, packet: parsed.packet });
      return parsed.packet;
    },
  });
  t.after(() => spine.close());

  // When: the real independent reviewer evaluates the fixed candidate.
  const gate = await spine.runMilestone('gate');
  record({ type: 'scenario', label, result: gate, state: spine.state });

  // Then: NO-GO must be observed, not a worker BLOCKED status or transport error.
  assert.equal(gate.status, 'DONE');
  assert.equal(gate.verdict.verdict, 'NO-GO');
  assert.equal(gate.verified, false);
  assert.ok(gate.verdict.repair_needs?.trim());
  assert.deepEqual(spine.state.completed_milestones, []);
  assert.equal(spine.state.current_milestone, null);
  assert.deepEqual(spine.state.blockers, []);
  const saved = AuthoritativeLedger.load(ledgerPath).getState();
  assert.equal(saved.verification.gate.verdict, 'NO-GO');
  assert.equal(saved.verification.gate.result_ref, gate.result_ref);
  assert.deepEqual(saved.completed_milestones, []);
  assert.throws(() => spine.declareGlobalCompletion(),
    /Cannot declare global completion: milestone 'gate' is not in completed_milestones/);
  record({ type: 'case-verdict', case: label, verdict: 'PASS',
    observed: { zenVerdict: gate.verdict.verdict, candidate_artifact_ref: artifactPath,
      completed: saved.completed_milestones, completionRefused: true } });
});
