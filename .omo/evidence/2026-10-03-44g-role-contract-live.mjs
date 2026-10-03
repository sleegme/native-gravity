// Isolated diagnostic only: eight calls, no activation or permission changes.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MinimalSpine } from '../../scripts/spine.mjs';
import { composeBoundedPrompt, parseResponseEnvelope, parseResponsePacket } from '../../scripts/runner.mjs';
import { validateCandidateSemantics } from '../../scripts/ledger.mjs';

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = '8ed89a7a66d41568d203ef6e44ac4813841ff171';
const dir = mkdtempSync(join(tmpdir(), 'ntg-44g-role-contract-'));
const oldBodies = join(dir, 'before-roles');
mkdirSync(oldBodies);
const models = ['gemini-3.8-flash-high', 'claude-sonnet-5-5-high'];
const roles = ['piledriver', 'bulldozer'];
const records = [];
const dryRun = process.argv.includes('--dry-run');
const sha = value => createHash('sha256').update(value).digest('hex');
console.log('EVIDENCE_DIRECTORY=' + dir);
function record(entry) {
  records.push(entry);
  writeFileSync(join(dir, 'transcript.json'), JSON.stringify(records, null, 2));
}
for (const role of roles) {
  writeFileSync(join(oldBodies, `${role}.md`), execFileSync('git', [
    'show', `${baseline}:docs/specs/vnext/agents/${role}.md`,
  ], { cwd }));
}

// Identical complex plan and requestPlan task to the existing A/B harness.
const plan = {
  goal: 'Independently inspect two existing repository facts without writes',
  constraints: ['Read-only inspection; no permission changes; no runtime activation'],
  decision_invariants: [], plan_version: 'v1',
  milestones: ['one', 'two'].map((id, index) => ({
    id, title: id,
    objective: `Use a read-only tool to inspect ${index ? 'package.json version' : 'README.md project name'}; return observed content`,
    bounded_scope: [index ? 'package.json' : 'README.md'],
    acceptance_criteria: ['Fact independently observed using a tool, not recalled or inferred'],
    non_goals: ['Any file modification'], dependencies: index ? ['one'] : [],
  })),
};
const prompts = {};
for (const role of roles) {
  let packet;
  const sentinel = new Error('DIAGNOSTIC_PACKET_CAPTURE');
  const spine = new MinimalSpine({
    ledgerPath: join(dir, `${role}-capture-ledger.json`), plan,
    invokeRole: (_role, input) => { packet = input; throw sentinel; },
    invokeZen: () => { throw new Error('Zen must not run during packet capture'); },
  });
  try {
    if (role === 'bulldozer') await spine.runMilestone('one');
    else await spine.requestPlan('Inspect package.json using a read-only tool and recommend a material v2 plan revision. Return JSON advice; do not write.');
  } catch (error) {
    if (error !== sentinel) throw error;
  }
  prompts[role] = {
    before: composeBoundedPrompt(role, packet, { roleBodyDir: oldBodies }),
    after: composeBoundedPrompt(role, packet),
  };
  // Compare with the original dry-run record, not a reduced or reconstructed task.
  const historical = JSON.parse(readFileSync('/tmp/ntg-44g-model-ab-OP9sCK/transcript.json', 'utf8'))
    .find(entry => entry.type === 'prompt' && entry.role === role && entry.shape === 'complex');
  assert.deepEqual(packet, historical.packet);
  assert.equal(prompts[role].before, historical.prompt);
  record({ type: 'prompt', role, packet, packetSha256: sha(JSON.stringify(packet)),
    before: prompts[role].before, after: prompts[role].after,
    beforeSha256: sha(prompts[role].before), afterSha256: sha(prompts[role].after) });
}

function execute(args) {
  return new Promise(resolveResult => {
    const child = spawn('agy', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', executionError;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { executionError = error.message; });
    const timer = setTimeout(() => {
      executionError = 'OUTER_TIMEOUT';
      child.kill('SIGKILL');
    }, 100000);
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolveResult({ exitCode, signal, executionError, stdout, stderr });
    });
  });
}

record({ type: 'configuration', baseline, cwd, models, roles, maxCalls: 8, dryRun,
  permissionMode: 'Existing A/B per-call flag retained equally in both arms; no settings changed',
  baselineTranscript: '/tmp/ntg-44g-model-ab-OP9sCK/transcript.json' });
let calls = 0;
if (!dryRun) for (const model of models) for (const role of roles) {
  for (const phase of ['before', 'after']) {
    assert.ok(++calls <= 8);
    const prompt = prompts[role][phase];
    const args = ['--dangerously-skip-permissions', '-p', prompt];
    if (phase === 'before') args.push('--agent', role);
    args.push('--model', model, '--output-format', 'json', '--print-timeout', '90s');
    const label = `${phase}:${model}:${role}`;
    record({ type: 'call-start', label, command: ['agy', ...args], startedAt: new Date().toISOString() });
    const started = Date.now();
    const result = await execute(args);
    const envelope = parseResponseEnvelope(result.stdout, { role, slug: model });
    const parsed = parseResponsePacket(envelope);
    let bareStrict = false;
    if (envelope.ok) {
      try {
        const value = JSON.parse(envelope.response);
        bareStrict = value !== null && typeof value === 'object' && !Array.isArray(value);
      } catch {}
    }
    const partial = /print timeout|partial output/i.test(result.stderr);
    const transportOk = result.exitCode === 0 && !result.executionError && envelope.ok;
    let candidateSchema = 'not-applicable';
    if (role === 'bulldozer' && parsed.ok) {
      try {
        validateCandidateSemantics(parsed.packet, { expectedMilestone: 'one', expectedPlanVersion: 'v1' });
        assert.equal(typeof parsed.packet.candidate_artifact_ref, 'string');
        assert.ok(parsed.packet.candidate_artifact_ref.trim());
        for (const key of ['verdict', 'zen_verdict', 'result_ref']) assert.ok(!(key in parsed.packet));
        candidateSchema = 'DONE-candidate-valid-not-reviewed';
      } catch (error) {
        candidateSchema = String(error);
      }
    }
    const entry = { type: 'call', label, phase, model, role, ...result,
      elapsedMs: Date.now() - started, promptSha256: sha(prompt), partial,
      bareStrict: Boolean(transportOk && bareStrict),
      extractedStrict: Boolean(transportOk && parsed.ok),
      completedExtractedStrict: Boolean(transportOk && parsed.ok && !partial),
      candidateSchema, parsed };
    record(entry);
    console.log(JSON.stringify({ label, bareStrict: entry.bareStrict,
      extractedStrict: entry.extractedStrict, partial, error: parsed.error, candidateSchema }));
  }
}
record({ type: 'complete', calls, finishedAt: new Date().toISOString() });
console.log('TRANSCRIPT=' + join(dir, 'transcript.json'));
