#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthoritativeLedger, InvalidTransitionError } from './ledger.mjs';
import { MinimalSpine } from './spine.mjs';
import { invoke } from './runner.mjs';

const optionsByCommand = {
  init: ['plan'], status: [], delegate: ['milestone'],
  'run-milestone': ['milestone', 'zen-cmd', 'timeout', 'cwd'], candidate: ['file'],
  'record-zen': ['file'], blocked: ['milestone', 'status', 'blocker', 'evidence'],
  replan: ['plan'], 'resolve-blocker': ['id', 'evidence'], complete: [],
  'invoke-role': ['role', 'packet'],
};
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

function parseArgs(argv) {
  const [command, ...args] = argv;
  if (!Object.hasOwn(optionsByCommand, command)) throw new TypeError('Unknown spine command');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || !['ledger', ...optionsByCommand[command]].includes(key)
        || Object.hasOwn(options, key) || !args[i + 1]?.trim() || args[i + 1].startsWith('--')) {
      throw new TypeError(`Invalid, duplicate, or missing-value option: ${args[i]}`);
    }
    options[key] = args[i + 1];
  }
  const required = key => {
    if (!options[key]) throw new TypeError(`--${key} is required`);
    return options[key];
  };
  required('ledger');
  for (const key of optionsByCommand[command]) {
    if (!['zen-cmd', 'blocker', 'evidence', 'timeout', 'cwd'].includes(key)
        || (command === 'resolve-blocker' && key === 'evidence')) required(key);
  }
  return { command, options };
}

// The public plan spelling is depends_on; the ledger owns dependencies.
function readPlan(path) {
  const plan = readJson(path);
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.milestones)) {
    throw new TypeError('Plan must contain milestones');
  }
  return { ...plan, milestones: plan.milestones.map(m => {
    if (m.depends_on !== undefined && m.dependencies !== undefined
        && JSON.stringify(m.depends_on) !== JSON.stringify(m.dependencies)) {
      throw new TypeError('Conflicting depends_on and dependencies');
    }
    return { ...m, dependencies: m.depends_on ?? m.dependencies };
  }) };
}

export function invokeExternalZen(command, request) {
  // This is explicitly a supervisor-supplied shell command, not candidate text.
  const output = spawnSync(command, {
    shell: true, input: JSON.stringify(request) + '\n', encoding: 'utf8',
    timeout: 90000, maxBuffer: 20 * 1024 * 1024,
  });
  if (output.error) throw output.error;
  if (output.status !== 0) throw new Error(`Zen command failed (${output.status}): ${output.stderr}`);
  let verdict = JSON.parse(output.stdout);
  // Official AGY JSON output wraps the role's JSON response in SUCCESS.
  if (verdict?.status === 'SUCCESS' && typeof verdict.response === 'string') {
    verdict = JSON.parse(verdict.response);
  }
  return verdict;
}

async function runMilestone(path, milestone, zenCommand, invokeRole, timeoutMs, cwd) {
  // A fresh ledger validates transition errors using its original error types
  // before MinimalSpine's generic busy check. This copy is never saved.
  AuthoritativeLedger.load(path).delegate(milestone);
  let handoff;
  const handedOff = new Promise(resolveHandoff => { handoff = resolveHandoff; });
  // Wrap invokeRole so the spine's JSON.parse sees a bare JSON object even when
  // the model wraps its packet in prose or markdown fences.
  const extractingInvoke = async (role, packet, opts) => {
    const out = await invokeRole(role, packet, opts);
    if (out?.ok && typeof out.response === 'string') {
      const m = out.response.match(/\{[\s\S]*\}/);
      if (m) {
        out.response = m[0];
        // Normalize candidate_artifact_ref to the string the spine requires:
        // an object {path, sha256, ...} becomes "path@sha256:<hash>".
        try {
          const p = JSON.parse(out.response);
          if (p && typeof p === 'object' && p.candidate_artifact_ref && typeof p.candidate_artifact_ref === 'object') {
            const r = p.candidate_artifact_ref;
            p.candidate_artifact_ref = r.path && r.sha256 ? `${r.path}@sha256:${r.sha256}` : JSON.stringify(r);
            out.response = JSON.stringify(p);
          }
        } catch { /* leave response as-is; spine will surface the parse error */ }
      }
    }
    return out;
  };
  const spine = new MinimalSpine({
    ledgerPath: path, invokeRole: extractingInvoke,
    runnerOptions: { ...(timeoutMs ? { timeout: timeoutMs } : {}), ...(cwd ? { cwd } : {}) },
    invokeZen: zenCommand ? request => invokeExternalZen(zenCommand, request) : request => {
      handoff({ status: 'AWAITING_ZEN', verified: false, zen_request: request });
      // Suspend only this in-memory coordinator at the durable review boundary.
      // No timers or process handles remain. record-zen resumes from disk in a
      // fresh invocation; never fake a verdict or throw (which records failure).
      return new Promise(() => {});
    },
  });
  const running = spine.runMilestone(milestone);
  return zenCommand ? running : Promise.race([running, handedOff]);
}

/** Injectable role transport for deterministic tests; ledger and spine stay real. */
export async function execute(argv, { invokeRole = invoke } = {}) {
  const { command, options: o } = parseArgs(argv);
  const path = o.ledger;
  if (command === 'run-milestone') {
    return { ok: true, ...await runMilestone(path, o.milestone, o['zen-cmd'], invokeRole, o.timeout ? Number(o.timeout) : undefined, o.cwd) };
  }
  const ledger = command === 'init' && !existsSync(path)
    ? new AuthoritativeLedger() : AuthoritativeLedger.load(path);
  let result;
  switch (command) {
    case 'init': ledger.init(readPlan(o.plan)); result = { state: ledger.getState() }; break;
    case 'status': result = { state: ledger.getState() }; break;
    case 'delegate': result = { packet: ledger.delegate(o.milestone) }; break;
    case 'candidate': result = ledger.receiveCandidate(readJson(o.file)); break;
    case 'record-zen': {
      const verdict = readJson(o.file);
      if (verdict?.verdict === 'GO') result = { verification: ledger.recordZenGo(verdict) };
      else if (verdict?.verdict === 'NO-GO') result = { verification: ledger.recordZenNoGo(verdict) };
      else throw new InvalidTransitionError('Zen verdict must be GO or NO-GO');
      break;
    }
    case 'blocked':
      if (!['BLOCKED', 'FAILED'].includes(o.status)) throw new InvalidTransitionError('Status must be BLOCKED or FAILED');
      result = ledger.recordBlockedOrFailure({
        milestoneId: o.milestone, status: o.status, blockers: o.blocker,
        evidence: o.evidence ? { classification: 'OBSERVED', result: o.evidence } : undefined,
      });
      break;
    case 'replan': ledger.materialReplan(readPlan(o.plan)); result = { state: ledger.getState() }; break;
    case 'resolve-blocker': result = ledger.resolveBlocker(o.id, { classification: 'OBSERVED', result: o.evidence }); break;
    case 'complete': result = ledger.declareGlobalCompletion(); break;
    case 'invoke-role': {
      result = await invokeRole(o.role, readJson(o.packet));
      if (!result?.ok) {
        return { ...result, ok: false, error: result?.error ?? 'Invocation failed',
          errorType: result?.errorType ?? result?.error ?? 'InvocationError' };
      }
      break;
    }
  }
  ledger.save(path);
  return { ok: true, ...result };
}

export async function main(argv) {
  try {
    return await execute(argv);
  } catch (error) {
    return { ok: false, error: error.message, errorType: error.name };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await main(process.argv.slice(2));
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
