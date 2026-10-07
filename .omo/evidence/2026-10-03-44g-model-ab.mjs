// Isolated, read-only model/packet diagnosis. Does not activate vNext.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MinimalSpine } from '../../scripts/spine.mjs';
import { composeBoundedPrompt, parseResponseEnvelope, parseResponsePacket } from '../../scripts/runner.mjs';

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(join(tmpdir(), 'ntg-44g-model-ab-'));
const records = [];
const models = [
  'gemini-3.8-flash-high', 'gemini-3.1-pro-high', 'claude-sonnet-5-5-high',
  'claude-opus-5-5-high', 'claude-sonnet-5-5-medium',
];
const roles = ['piledriver', 'bulldozer'];
const dryRun = process.argv.includes('--dry-run');
const schemaOnly = process.argv.includes('--schema-only');
console.log('EVIDENCE_DIRECTORY=' + dir);
function record(entry) {
  records.push(entry);
  writeFileSync(join(dir, 'transcript.json'), JSON.stringify(records, null, 2));
}
const plan = reduced => ({
  goal: reduced ? 'Inspect README.md' : 'Independently inspect two existing repository facts without writes',
  constraints: ['Read-only inspection; no permission changes; no runtime activation'],
  decision_invariants: [], plan_version: 'v1',
  milestones: (reduced ? ['one'] : ['one', 'two']).map((id, index) => ({
    id, title: id,
    objective: reduced ? 'Read README.md project name'
      : `Use a read-only tool to inspect ${index ? 'package.json version' : 'README.md project name'}; return observed content`,
    bounded_scope: [index ? 'package.json' : 'README.md'],
    acceptance_criteria: [reduced ? 'Tool-observed name' : 'Fact independently observed using a tool, not recalled or inferred'],
    non_goals: ['Any file modification'], dependencies: index ? ['one'] : [],
  })),
});

// Capture the real spine-generated prompt inputs without invoking models or Zen.
// The original multi-milestone scenario has no Piledriver call: requestPlan is
// sampled separately against the same initial plan, not prior failure history.
async function capture(role, shape) {
  let packet;
  const sentinel = new Error('DIAGNOSTIC_PACKET_CAPTURE');
  const spine = new MinimalSpine({
    ledgerPath: join(dir, `${shape}-${role}-capture-ledger.json`),
    plan: plan(shape === 'reduced'),
    invokeRole: (_role, input) => { packet = input; throw sentinel; },
    invokeZen: () => { throw new Error('Zen must not run during packet capture'); },
  });
  try {
    if (role === 'bulldozer') await spine.runMilestone('one');
    else await spine.requestPlan('Inspect package.json using a read-only tool and recommend a material v2 plan revision. Return JSON advice; do not write.');
  } catch (error) {
    if (error !== sentinel) throw error;
  }
  const prompt = composeBoundedPrompt(role, packet, { roleBodyDir: '../docs/specs/vnext/agents' });
  const promptSha256 = createHash('sha256').update(prompt).digest('hex');
  record({ type: 'prompt', role, shape, packet, prompt, promptChars: prompt.length, promptSha256 });
  return { prompt, promptSha256 };
}
const prompts = {};
for (const shape of ['complex', 'reduced']) {
  prompts[shape] = {};
  for (const role of roles) prompts[shape][role] = await capture(role, shape);
}

function execute(args, timeout = 100000) {
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
    }, timeout);
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolveResult({ exitCode, signal, executionError, stdout, stderr });
    });
  });
}
const counts = new Map();
async function call(model, role, shape, schema) {
  const key = `${model}:${shape}`;
  counts.set(key, (counts.get(key) || 0) + 1);
  if (counts.get(key) > 10) throw new Error(`Call budget exceeded for ${key}`);
  const { prompt, promptSha256 } = prompts[shape][role];
  const args = ['--dangerously-skip-permissions', '-p', prompt, '--agent', role,
    '--model', model, '--output-format', 'json', '--print-timeout', '90s'];
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  const label = `${shape}:${model}:${role}${schema ? ':schema' : ''}`;
  record({ type: 'call-start', label, model, role, shape, promptSha256, startedAt: new Date().toISOString() });
  const started = Date.now();
  const result = await execute(args);
  const envelope = parseResponseEnvelope(result.stdout, { role, slug: model });
  const parsed = parseResponsePacket(envelope);
  let rawResponse = envelope.response;
  if (typeof rawResponse !== 'string') {
    rawResponse = typeof envelope.details?.response === 'string' ? envelope.details.response
      : typeof envelope.raw?.response === 'string' ? envelope.raw.response
      : result.stdout;
  }
  let responseClass = 'empty';
  if (rawResponse.trim()) {
    try { JSON.parse(rawResponse); responseClass = 'JSON'; }
    catch { responseClass = 'prose'; }
  }
  // Class is lexical only; transport and inner-object validity stay separate.
  const entry = {
    type: 'call', label, model, role, shape, schemaEnforced: Boolean(schema),
    promptSha256, command: ['agy', ...args], ...result,
    elapsedMs: Date.now() - started, envelopeValid: envelope.ok,
    validJsonPacket: result.exitCode === 0 && parsed.ok,
    responseClass, rawResponseFirst200: rawResponse.slice(0, 200),
    rawResponse, parsed,
  };
  record(entry);
  console.log(JSON.stringify({
    label, exitCode: entry.exitCode, validJsonPacket: entry.validJsonPacket,
    responseClass, error: parsed.error, rawResponseFirst200: entry.rawResponseFirst200,
  }));
  return entry;
}

record({ type: 'configuration', models, roles, dryRun, schemaOnly, maxCallsPerModelShape: 10,
  printTimeoutSeconds: 90, cwd });
if (!dryRun) {
  if (!schemaOnly) {
    for (const model of models) {
      for (const role of roles) await call(model, role, 'complex');
    }
  }
  // A failure on either Claude role warrants the bounded reduction comparison.
  const claudeFailure = records.some(entry => entry.type === 'call'
    && entry.model.startsWith('claude-') && !entry.validJsonPacket);
  record({ type: 'reduction-decision', runReduced: claudeFailure });
  if (claudeFailure) {
    for (const model of models) {
      for (const role of roles) await call(model, role, 'reduced');
    }
  }
  const help = await execute(['--help'], 15000);
  record({ type: 'schema-support', ...help });
  if (help.exitCode === 0 && (help.stdout + help.stderr).includes('--json-schema')) {
    const schema = {
      type: 'object',
      properties: {
        milestone_id: { type: 'string' }, plan_version: { type: 'string' },
        status: { type: 'string', enum: ['DONE', 'BLOCKED', 'NEEDS_DEEP'] },
        changes_made: { type: 'array' }, verification_evidence: { type: 'array' },
        unresolved_unknowns: { type: 'array' }, scope_deviations: { type: 'array' },
        blockers: { type: 'array' }, escalation_needs: { type: 'array' },
        candidate_artifact_ref: { type: 'string' },
      },
      required: ['milestone_id', 'plan_version', 'status', 'changes_made',
        'verification_evidence', 'unresolved_unknowns', 'scope_deviations',
        'blockers', 'escalation_needs'],
    };
    await call('gemini-3.8-flash-high', 'bulldozer', 'complex', schema);
  }
}
record({ type: 'complete', calls: records.filter(entry => entry.type === 'call').length,
  finishedAt: new Date().toISOString() });
console.log('TRANSCRIPT=' + join(dir, 'transcript.json'));
