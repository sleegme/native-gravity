// Solo rerun of 44G e2e case2 (zen-no-go gate milestone) at higher budget.
// Distinguishes "slow real work" from "wedged" — run 4 hit TIMEOUT at 360s.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MinimalSpine } from '../../scripts/spine.mjs';
import { invoke, parseResponseEnvelope, parseResponsePacket } from '../../scripts/runner.mjs';

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(join(tmpdir(), 'ntg-44g-case2-'));
const records = [];
const record = (e) => { records.push({ ...e, ts: new Date().toISOString() }) };

const zenBody = readFileSync(join(cwd, 'docs/specs/vnext/agents/zen.md'), 'utf8').trim();
const ZEN_MODEL = 'gemini-3.1-pro-high';
const ZEN_TIMEOUT_MS = 120000;

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
  record({ type: 'call-start', label: 'zen:' + label, command: ['agy', ...args] });
  const t0 = Date.now();
  const result = spawnSync('agy', args, { cwd, encoding: 'utf8', timeout: ZEN_TIMEOUT_MS + 20000, maxBuffer: 20 * 1024 * 1024 });
  const envelope = result.status === 0 && !result.error
    ? parseResponseEnvelope(result.stdout, { role: 'zen', slug: ZEN_MODEL })
    : { ok: false, error: result.error?.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'EXECUTION_FAILED' };
  const parsed = parseResponsePacket(envelope);
  record({ type: 'call', label: 'zen:' + label, elapsedMs: Date.now() - t0, parsed });
  if (!parsed.ok) throw new Error('Zen invocation failed: ' + JSON.stringify({ error: parsed.error }));
  return parsed.packet;
}

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

const spine = new MinimalSpine({
  ledgerPath: join(dir, 'ledger-b.json'),
  runnerOptions: { timeout: 600000 },
  invokeRole: async (role, packet, opts) => {
    record({ type: 'call-start', role, startedAt: new Date().toISOString() });
    const t0 = Date.now();
    const out = await invoke(role, packet, opts || {});
    const parsed = parseResponsePacket(out);
    record({ type: 'call', role, elapsedMs: Date.now() - t0,
      output: typeof out === 'string' ? out.slice(0, 4000) : out, parsed });
    return out;
  },
  invokeZen: (req) => invokeZen(req, 'case2-solo'),
  plan: noGoPlan,
});

try {
  const gate = await spine.runMilestone('gate');
  record({ type: 'scenario', label: 'case2-zen-no-go-solo', result: gate, state: spine.state });
  console.log('GATE STATUS:', gate.status, 'VERDICT:', JSON.stringify(gate.verdict));
} catch (e) {
  record({ type: 'scenario-error', label: 'case2-zen-no-go-solo', error: String(e) });
  console.log('ERROR:', String(e));
}

writeFileSync(join(dir, 'transcript.json'), JSON.stringify(records, null, 2));
console.log('DIR:', dir);
