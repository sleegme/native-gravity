#!/usr/bin/env node
/**
 * ntg-vnext — default vNext entry (44G, #134). A thin CLI over MinimalSpine:
 * the spine is Steamroller's ledger authority, the runner invokes Piledriver and
 * Bulldozer with exact models, and Zen is invoked natively and independently.
 *
 * Usage:
 *   ntg-vnext init    --ledger L --plan plan.json
 *   ntg-vnext plan    --ledger L --task "..."         (Piledriver advice; not adopted)
 *   ntg-vnext run     --ledger L [--milestone ID] [--all]
 *   ntg-vnext replan  --ledger L --plan plan.json     (material replan adoption)
 *   ntg-vnext recover --ledger L --evidence "..."     (end an observed interrupted invocation)
 *   ntg-vnext status  --ledger L
 *
 * Every invocation is a fresh context: state is reloaded from the ledger, never
 * from conversation. Output is one JSON object on stdout; exit 0 on success,
 * 2 on a NO-GO/BLOCKED/NEEDS_DEEP outcome, 1 on errors.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { MinimalSpine } from './spine.mjs';

const USAGE = 'usage: ntg-vnext <init|plan|run|replan|recover|status> --ledger PATH [options]';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, all: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--all') { opts.all = true; continue; }
    const key = { '--ledger': 'ledger', '--plan': 'plan', '--task': 'task', '--milestone': 'milestone', '--evidence': 'evidence' }[arg];
    if (!key || rest[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${arg}\n${USAGE}`);
    opts[key] = rest[i + 1];
    i += 1;
  }
  if (!['init', 'plan', 'run', 'replan', 'recover', 'status'].includes(command)) throw new Error(USAGE);
  if (!opts.ledger) throw new Error(`--ledger is required\n${USAGE}`);
  return opts;
}

function unwrapJson(stdout) {
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { parsed = undefined; }
  let inner = parsed?.message ?? parsed?.result ?? parsed?.response ?? stdout;
  if (typeof inner !== 'string') return inner;
  inner = inner.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
  return JSON.parse(inner);
}

/** Native, independent Zen review through the installed `zen` agent. */
export function nativeZen(request, { agyPath = process.env.AGY_PATH || 'agy', cwd = process.cwd(), timeout = 600000 } = {}) {
  const prompt = 'Independently verify the candidate against its milestone contract. '
    + 'Return only a bare JSON object with milestone_id, plan_version and result_ref echoed unchanged, '
    + 'verdict (GO or NO-GO), verification_evidence (non-empty array of '
    + '{"classification": "OBSERVED", "criterion": "...", "result": "..."}) and, for NO-GO, '
    + 'repair_needs (non-empty string). Request:\n' + JSON.stringify(request);
  const args = ['--agent', 'zen', '--output-format', 'json', '--dangerously-skip-permissions', '-p', prompt];
  if (process.env.NTG_ZEN_MODEL) args.splice(2, 0, '--model', process.env.NTG_ZEN_MODEL);
  const r = spawnSync(agyPath, args, { cwd, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 20 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`zen invocation exited ${r.status}: ${(r.stderr || '').slice(-500)}`);
  return unwrapJson(r.stdout);
}

function nextEligible(state) {
  const done = new Set(state.completed_milestones);
  return state.milestones.find(m => !done.has(m.id)
    && (m.dependencies || []).every(dep => done.has(dep)))?.id ?? null;
}

export async function main(argv, deps = {}) {
  const opts = parseArgs(argv);
  const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
  const spine = new MinimalSpine({
    ledgerPath: opts.ledger,
    plan: opts.command === 'init' ? readJson(opts.plan) : undefined,
    invokeZen: deps.invokeZen ?? (request => nativeZen(request)),
    ...(deps.invokeRole ? { invokeRole: deps.invokeRole } : {}),
    runnerOptions: deps.runnerOptions ?? {},
    handleSignals: deps.handleSignals ?? true,
  });
  try {
    switch (opts.command) {
      case 'init':
      case 'status':
        return { code: 0, out: { state: spine.state, next_milestone: nextEligible(spine.state) } };
      case 'plan':
        if (!opts.task) throw new Error('--task is required');
        return { code: 0, out: { advisory_plan: await spine.requestPlan(opts.task), adopted: false } };
      case 'replan':
        return { code: 0, out: { state: spine.adoptReplan(readJson(opts.plan)) } };
      case 'recover':
        if (!opts.evidence) throw new Error('--evidence is required');
        spine.endInterruptedInvocation({ classification: 'OBSERVED', detail: opts.evidence });
        return { code: 0, out: { state: spine.state } };
      case 'run': {
        const results = [];
        let id = opts.milestone ?? nextEligible(spine.state);
        while (id) {
          const result = await spine.runMilestone(id);
          results.push({ milestone_id: id, ...result });
          if (!result.verified) return { code: 2, out: { results, state: spine.state } };
          if (!opts.all || opts.milestone) break;
          id = nextEligible(spine.state);
        }
        const remaining = nextEligible(spine.state);
        const completion = remaining === null && spine.state.completed_milestones.length === spine.state.milestones.length
          ? spine.declareGlobalCompletion() : null;
        return { code: 0, out: { results, global_completion: completion, next_milestone: remaining, state: spine.state } };
      }
      default:
        throw new Error(USAGE);
    }
  } finally {
    spine.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(({ code, out }) => {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exitCode = code;
  }, (error) => {
    process.stderr.write(`ntg-vnext: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
