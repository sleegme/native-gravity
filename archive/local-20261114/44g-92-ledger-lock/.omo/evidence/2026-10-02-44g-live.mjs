// Reproducible, isolated evidence harness; does not activate the vNext runtime.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MinimalSpine } from '../../scripts/spine.mjs';
import { composeBoundedPrompt, parseResponseEnvelope, parseResponsePacket } from '../../scripts/runner.mjs';

const dir = mkdtempSync(join(tmpdir(), 'ntg-44g-live-'));
const records = [];
console.log('EVIDENCE_DIRECTORY=' + dir);
function record(entry) {
  records.push(entry);
  writeFileSync(join(dir, 'transcript.json'), JSON.stringify(records, null, 2));
}
const models = { piledriver: 'gemini-3.1-pro-high', bulldozer: 'gemini-3.8-flash-high', zen: 'gemini-3.1-pro-high', steamroller: 'gemini-3.8-flash-high' };
function call(role, prompt, label) {
  const args = ['--dangerously-skip-permissions', '-p', prompt, '--agent', role,
    '--model', models[role], '--output-format', 'json', '--print-timeout', '60s'];
  const result = spawnSync('agy', args, { encoding: 'utf8', timeout: 75000, maxBuffer: 20 * 1024 * 1024 });
  const parsed = result.status === 0 ? parseResponsePacket(parseResponseEnvelope(result.stdout, { role, slug: models[role] }))
    : { ok: false, error: result.error?.code || 'EXECUTION_FAILED', exitCode: result.status };
  record({ label, command: ['agy', ...args], exitCode: result.status,
    stdout: result.stdout, stderr: result.stderr, parsed });
  console.log(JSON.stringify({ label, ok: parsed.ok, error: parsed.error, response: parsed.response }));
  return parsed;
}
const plan = version => ({
  goal: 'Independently inspect two existing repository facts without writes',
  constraints: ['Read-only inspection; no permission changes; no runtime activation'],
  decision_invariants: [], plan_version: version,
  milestones: ['one', 'two'].map((id, index) => ({
    id, title: id, objective: `Use a read-only tool to inspect ${index ? 'package.json version' : 'README.md project name'}; return observed content`,
    bounded_scope: [index ? 'package.json' : 'README.md'],
    acceptance_criteria: ['Fact independently observed using a tool, not recalled or inferred'],
    non_goals: ['Any file modification'], dependencies: index ? ['one'] : [],
  })),
});
const options = ledgerPath => ({
  ledgerPath,
  invokeRole: (role, packet) => call(role, composeBoundedPrompt(role, packet, {
    roleBodyDir: '../docs/specs/vnext/agents',
  }), role),
  invokeZen: request => {
    const output = call('zen', 'Independently verify using read-only tools. Return only JSON with milestone_id, plan_version, result_ref, verdict GO|NO-GO, verification_evidence (OBSERVED entries). Request:\n' + JSON.stringify(request), 'zen-review');
    if (!output.ok) throw new Error(JSON.stringify(output));
    return JSON.parse(output.response);
  },
});
async function scenario(label, operation) {
  const before = spine.state;
  record({ label, verdict: 'STARTED', before });
  try { record({ label, verdict: 'OBSERVED', result: await operation(), before, after: spine.state }); }
  catch (error) { record({ label, verdict: 'BLOCKED', error: String(error), before, after: spine.state }); }
  console.log(JSON.stringify(records.at(-1)));
}
const ledgerPath = join(dir, 'ledger.json');
let spine = new MinimalSpine({ ...options(ledgerPath), plan: plan('v1') });
await scenario('multi-milestone', async () => {
  await spine.runMilestone('one');
  await spine.runMilestone('two');
  return spine.declareGlobalCompletion();
});
await scenario('plan-revision-material-replan', async () => {
  const advice = await spine.requestPlan('Inspect package.json using a read-only tool and recommend a material v2 plan revision. Return JSON advice; do not write.');
  spine.adoptReplan(plan('v2'));
  return { advice, state: spine.state };
});
await scenario('zen-no-go-repair', async () => {
  // The repair path requires a real candidate and independent review first.
  const result = await spine.runMilestone('one');
  if (result.verdict?.verdict !== 'NO-GO') throw new Error('No live NO-GO observed; repair path unproven');
  return spine.runMilestone('one');
});
await scenario('fresh-context-resume', async () => {
  spine = new MinimalSpine(options(ledgerPath));
  return { resumedBefore: spine.state, execution: await spine.runMilestone('one'), resumedAfter: spine.state };
});
await scenario('provenance-closure', async () => {
  const output = call('steamroller', 'Read docs/specs/vnext-architecture-contract.md section 9 and inspect docs/specs/vnext plus plugin.json and hooks.json using read-only tools. Report JSON per-surface closure evidence and unresolved provenance. Do not infer authorship from labels. Do not write or activate anything.', 'provenance-audit');
  if (!output.ok) throw new Error(JSON.stringify(output));
  return { response: output.response, ledgerUnchanged: spine.state };
});
// Small alternating controlled probe: same agent/model/task/flags, differing only
// by role-body injection. This is exploratory, not a statistical causal result.
for (const variant of ['A', 'B', 'B', 'A']) {
  const packet = { task: 'Do not use tools. Return exactly the JSON object {"probe":"ok"} and nothing else.' };
  const prompt = variant === 'A' ? packet.task
    : composeBoundedPrompt('bulldozer', packet, { roleBodyDir: '../docs/specs/vnext/agents' });
  call('bulldozer', prompt, `role-body-probe-${variant}`);
}
record({ label: 'final-ledger', state: spine.state, saved: JSON.parse(readFileSync(ledgerPath, 'utf8')) });
console.log('EVIDENCE_DIRECTORY=' + dir);
