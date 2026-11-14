// Isolated read-only framing experiment; no runtime or permission policy changes.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MinimalSpine } from '../../scripts/spine.mjs';
import { composeBoundedPrompt, parseResponseEnvelope, parseResponsePacket } from '../../scripts/runner.mjs';

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(join(tmpdir(), 'ntg-44g-framing-'));
const models = ['gemini-3.8-flash-high', 'claude-sonnet-5-5-high'];
const roles = ['piledriver', 'bulldozer'];
const bareInstruction = "Your entire response must be exactly one bare JSON object — no markdown fences, no progress updates, no commentary before or after. Response format contract: the final message must start with '{' and end with '}'.";
const progressInstruction = 'The parser rejects any text outside the object. Intermediate progress belongs in a single "progress" field inside the JSON.';
const variants = { a: '', b: '\n\n' + bareInstruction, c: '\n\n' + bareInstruction + '\n' + progressInstruction };
const dryRun = process.argv.includes('--dry-run');
const records = [];
let calls = 0;
console.log('EVIDENCE_DIRECTORY=' + dir);
function record(entry) {
  records.push(entry);
  writeFileSync(join(dir, 'transcript.json'), JSON.stringify(records, null, 2));
}
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
async function capture(role) {
  let packet;
  const sentinel = new Error('DIAGNOSTIC_PACKET_CAPTURE');
  const spine = new MinimalSpine({
    ledgerPath: join(dir, `complex-${role}-capture-ledger.json`),
    plan,
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
  record({ type: 'prompt', role, packet, prompt, promptChars: prompt.length,
    promptSha256: createHash('sha256').update(prompt).digest('hex') });
  return prompt;
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
function responseClass(response) {
  if (!response.trim()) return 'empty';
  if (parseResponsePacket({ ok: true, response }).ok) return 'bare-json';
  return /```(?:json)?\s*[\s\S]*?```/i.test(response) ? 'fenced-json' : 'prose';
}
function inspectEnvelope(value, path = '$', fields = []) {
  if (typeof value === 'string') {
    fields.push({ path, type: 'string', chars: value.length,
      responseClass: responseClass(value), strictObject: parseResponsePacket({ ok: true, response: value }).ok,
      first200: value.slice(0, 200) });
  } else if (value && typeof value === 'object') {
    fields.push({ path, type: Array.isArray(value) ? 'array' : 'object', keys: Object.keys(value) });
    for (const [key, item] of Object.entries(value)) inspectEnvelope(item, `${path}.${key}`, fields);
  } else fields.push({ path, type: typeof value, value });
  return fields;
}
async function call(model, role, variant, basePrompt) {
  if (++calls > 12) throw new Error('Global 12-call budget exceeded');
  const prompt = basePrompt + variants[variant];
  const args = ['--dangerously-skip-permissions', '-p', prompt, '--agent', role,
    '--model', model, '--output-format', 'json', '--print-timeout', '90s'];
  const label = `${role}:${variant}:${model}`;
  record({ type: 'call-start', label, prompt, startedAt: new Date().toISOString() });
  const started = Date.now();
  const result = await execute(args);
  const envelope = parseResponseEnvelope(result.stdout, { role, slug: model });
  const parsed = parseResponsePacket(envelope);
  const rawResponse = envelope.response ?? envelope.details?.response ?? '';
  // Recovery is diagnostic only: retain the original envelope validity and parse
  // the entire extracted candidate with the same strict object parser.
  const stripped = rawResponse.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = rawResponse.indexOf('{'), last = rawResponse.lastIndexOf('}');
  const outermost = first >= 0 && last >= first ? rawResponse.slice(first, last + 1) : '';
  const recovery = Object.fromEntries(Object.entries({ stripCodeFences: stripped, extractOutermostObject: outermost })
    .map(([method, response]) => {
      const recovered = parseResponsePacket({ ...envelope, response });
      return [method, { validJsonPacket: result.exitCode === 0 && recovered.ok,
        changed: response !== rawResponse, error: recovered.error, packet: recovered.packet }];
    }));
  const entry = {
    type: 'call', label, model, role, variant, ...result,
    elapsedMs: Date.now() - started,
    promptSha256: createHash('sha256').update(prompt).digest('hex'),
    envelopeValid: envelope.ok, envelopeInspection: inspectEnvelope(envelope.raw ?? envelope.details),
    validJsonPacket: result.exitCode === 0 && parsed.ok, strictError: parsed.error,
    responseClass: responseClass(rawResponse), rawResponse, packet: parsed.packet,
    partialOutput: /print timeout|partial output/i.test(result.stderr), recovery,
  };
  record(entry);
  console.log(JSON.stringify({ label, exitCode: entry.exitCode, validJsonPacket: entry.validJsonPacket,
    responseClass: entry.responseClass, recovery, elapsedMs: entry.elapsedMs, partialOutput: entry.partialOutput }));
  return entry;
}
record({ type: 'configuration', cwd, models, roles, variants, dryRun, maxCalls: 12,
  printTimeoutSeconds: 90, stopRule: 'Stop later variants for a role once one variant strictly passes on both models' });
for (const role of roles) {
  const prompt = await capture(role);
  if (dryRun) continue;
  for (const variant of Object.keys(variants)) {
    const results = [];
    for (const model of models) results.push(await call(model, role, variant, prompt));
    if (results.every(result => result.validJsonPacket && !result.partialOutput)) {
      record({ type: 'early-stop', role, variant, skippedVariants: Object.keys(variants).slice(Object.keys(variants).indexOf(variant) + 1) });
      break;
    }
  }
}
record({ type: 'complete', calls, finishedAt: new Date().toISOString() });
console.log('TRANSCRIPT=' + join(dir, 'transcript.json'));
