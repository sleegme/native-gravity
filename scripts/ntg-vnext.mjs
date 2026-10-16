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
 *   ntg-vnext alt     --ledger L --task "..." [--milestone ID] [--escalate]
 *                                                 (Instinct NEEDS_ALT advice; not adopted)
 *   ntg-vnext status  --ledger L
 *
 * --timeout SECONDS bounds each runner invocation (default 600; the runner's own
 * 90s default is too short for bounded High-effort planning).
 * NTG_RUNNER_TIMEOUT_S overrides the default.
 *
 * Every invocation is a fresh context: state is reloaded from the ledger, never
 * from conversation. Output is one JSON object on stdout; exit 0 on success,
 * 2 on a NO-GO/BLOCKED/NEEDS_DEEP outcome, 1 on errors.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { MinimalSpine, recommendNeedsAlt } from './spine.mjs';
import { loadNativeRoleBody, parseResponseEnvelope, resolveSlug } from './runner.mjs';

/** Executor provenance markers inherited by every runner/Zen child (#135 B2). */
export const SUPERVISOR_PID_ENV = 'NTG_SUPERVISOR_PID';
export const SUPERVISOR_LEDGER_ENV = 'NTG_SUPERVISOR_LEDGER';
const EXECUTOR_EXIT_WAIT_MS = 10000;
/** Native verification gate: invoked here, never supervised as a runner role. */
const ZEN_ROLE = 'zen';

export const DEFAULT_RUNNER_TIMEOUT_S = 600;
const USAGE = 'usage: ntg-vnext <init|plan|run|replan|recover|alt|status> --ledger PATH [options]';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, all: false, escalate: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--all') { opts.all = true; continue; }
    if (arg === '--escalate') { opts.escalate = true; continue; }
    const key = { '--ledger': 'ledger', '--plan': 'plan', '--task': 'task', '--milestone': 'milestone', '--evidence': 'evidence', '--timeout': 'timeout' }[arg];
    if (!key || rest[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${arg}\n${USAGE}`);
    opts[key] = rest[i + 1];
    i += 1;
  }
  if (!['init', 'plan', 'run', 'replan', 'recover', 'alt', 'status'].includes(command)) throw new Error(USAGE);
  if (!opts.ledger) throw new Error(`--ledger is required\n${USAGE}`);
  const seconds = Number(opts.timeout ?? process.env.NTG_RUNNER_TIMEOUT_S ?? DEFAULT_RUNNER_TIMEOUT_S);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`--timeout must be a positive number of seconds\n${USAGE}`);
  opts.timeoutMs = Math.round(seconds * 1000);
  return opts;
}

/**
 * Fail closed (#135 B3): a Zen packet is authority only when the AGY envelope
 * passes the runner's authoritative check (SUCCESS, no denied actions, string
 * response) and the inner packet carries an explicit GO or NO-GO verdict.
 */
export function parseZenEnvelope(stdout) {
  const envelope = parseResponseEnvelope(stdout, { role: 'zen' });
  if (!envelope.ok) {
    throw new Error(`zen envelope rejected: ${envelope.error}${envelope.denied_actions ? ` ${JSON.stringify(envelope.denied_actions)}` : ''}`);
  }
  const inner = envelope.response.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
  let packet;
  try { packet = JSON.parse(inner); } catch (error) { throw new Error(`zen response is not a JSON packet: ${error.message}`); }
  if (!packet || typeof packet !== 'object' || (packet.verdict !== 'GO' && packet.verdict !== 'NO-GO')) {
    throw new Error('zen packet has no explicit GO or NO-GO verdict');
  }
  return packet;
}

/**
 * Resolves Zen's exact slug from the frozen ROLE_POLICY_TABLE against the
 * installed agy surface. NTG_ZEN_MODEL pins a slug explicitly instead.
 */
export function resolveZenModel({ agyPath = process.env.AGY_PATH || 'agy', installedModels } = {}) {
  if (process.env.NTG_ZEN_MODEL) return process.env.NTG_ZEN_MODEL;
  return resolveSlug(ZEN_ROLE, { agyPath, installedModels });
}

/**
 * Native, independent Zen review. Zen is model-pinned by policy rather than by
 * `--agent zen`: the agent is not natively selectable, so the shipped role body
 * (frontmatter stripped) is prepended to the prompt and the exact slug comes
 * from the same frozen policy table the runner roles use. NTG_ZEN_MODEL
 * overrides the resolved slug.
 */
export function nativeZen(request, { agyPath = process.env.AGY_PATH || 'agy', cwd = process.cwd(), timeout = 600000, installedModels } = {}) {
  const instruction = 'Independently verify the candidate against its milestone contract. '
    + 'Return only a bare JSON object with milestone_id, plan_version and result_ref echoed unchanged, '
    + 'verdict (GO or NO-GO), verification_evidence (non-empty array of '
    + '{"classification": "OBSERVED", "criterion": "...", "result": "..."}) and, for NO-GO, '
    + 'repair_needs (non-empty string). Request:\n' + JSON.stringify(request);
  const prompt = `${loadNativeRoleBody(ZEN_ROLE)}\n\n${instruction}`;
  const args = [
    '--model', resolveZenModel({ agyPath, installedModels }),
    '--output-format', 'json', '--dangerously-skip-permissions', '-p', prompt,
  ];
  const r = spawnSync(agyPath, args, { cwd, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 20 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`zen invocation exited ${r.status}: ${(r.stderr || '').slice(-500)}`);
  return parseZenEnvelope(r.stdout);
}

function nextEligible(state) {
  const done = new Set(state.completed_milestones);
  return state.milestones.find(m => !done.has(m.id)
    && (m.dependencies || []).every(dep => done.has(dep)))?.id ?? null;
}

/**
 * Owner-verified stale-lock recovery for `recover`: a lock left by a killed
 * supervisor is removed only when the PID it records is no longer alive.
 * A live owner (or an unreadable lock) is refused, never overridden.
 */
export function breakStaleLedgerLock(ledgerPath) {
  const path = resolve(ledgerPath);
  if (!existsSync(dirname(path))) return null;
  const lockPath = join(realpathSync(dirname(path)), `${basename(path)}.lock`);
  if (!existsSync(lockPath)) return null;
  const pid = Number(readFileSync(lockPath, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`${lockPath} has no owner PID; refusing stale-lock recovery`);
  try {
    process.kill(pid, 0);
    throw new Error(`${lockPath} is held by live process ${pid}; refusing stale-lock recovery`);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  // The dead supervisor's detached executors (agy and its children) can
  // outlive it. Terminate them and observe their exit before the lock and the
  // active milestone are released, so no replacement can overlap (#135 B2).
  const executors = terminateOrphanedExecutors(pid, realLedgerPath(path));
  unlinkSync(lockPath);
  return { lock: lockPath, dead_owner_pid: pid, terminated_executors: executors };
}

function realLedgerPath(path) {
  return join(realpathSync(dirname(path)), basename(path));
}

function processEnviron(pid) {
  try {
    return readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
  } catch {
    return null; // exited, zombie, or not ours
  }
}

function processGroup(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]);
  } catch {
    return null;
  }
}

/** Blocks until `pid` has terminated (zombie or reaped) or the bound elapses, via pidfd. */
function awaitExit(pid, ms) {
  const r = spawnSync('python3', ['-c', [
    'import os, select, sys',
    'try:',
    '    fd = os.pidfd_open(int(sys.argv[1]))',
    'except ProcessLookupError:',
    '    sys.exit(0)',
    'p = select.poll()',
    'p.register(fd, select.POLLIN)',
    'sys.exit(0 if p.poll(int(sys.argv[2])) else 1)',
  ].join('\n'), String(pid), String(ms)], { encoding: 'utf8', timeout: ms + 5000 });
  return !r.error && r.status === 0;
}

/**
 * Finds every process that inherited this ledger's dead supervisor markers,
 * SIGKILLs it and its process group, and waits for each to terminate.
 * Throws (leaving the lock in place) when termination cannot be observed.
 */
export function terminateOrphanedExecutors(deadPid, ledgerPath) {
  if (!existsSync('/proc/self/environ')) {
    throw new Error('cannot verify executor termination without /proc; refusing stale-lock recovery');
  }
  const want = [`${SUPERVISOR_PID_ENV}=${deadPid}`, `${SUPERVISOR_LEDGER_ENV}=${ledgerPath}`];
  const found = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    const env = processEnviron(name);
    if (env && want.every(entry => env.includes(entry))) found.push({ pid: Number(name), pgid: processGroup(name) });
  }
  const kill = (target) => {
    try { process.kill(target, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  for (const { pid, pgid } of found) {
    if (pgid && pgid > 1 && pgid !== process.pid) kill(-pgid);
    kill(pid);
  }
  const survivors = found.filter(({ pid }) => !awaitExit(pid, EXECUTOR_EXIT_WAIT_MS));
  if (survivors.length) {
    throw new Error(`executors ${survivors.map(s => s.pid).join(', ')} of dead supervisor ${deadPid} did not exit; refusing stale-lock recovery`);
  }
  return found.map(({ pid }) => pid);
}

export async function main(argv, deps = {}) {
  const opts = parseArgs(argv);
  if (opts.command !== 'recover') {
    // Mark every executor this supervisor spawns so a later recover can find
    // and terminate it if this process dies (inherited via the runner's env).
    const path = resolve(opts.ledger);
    process.env[SUPERVISOR_PID_ENV] = String(process.pid);
    process.env[SUPERVISOR_LEDGER_ENV] = existsSync(dirname(path)) ? realLedgerPath(path) : path;
  }
  const staleLock = opts.command === 'recover' ? breakStaleLedgerLock(opts.ledger) : null;
  const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
  const spine = new MinimalSpine({
    ledgerPath: opts.ledger,
    plan: opts.command === 'init' ? readJson(opts.plan) : undefined,
    invokeZen: deps.invokeZen ?? (request => nativeZen(request)),
    ...(deps.invokeRole ? { invokeRole: deps.invokeRole } : {}),
    runnerOptions: { timeout: opts.timeoutMs, ...deps.runnerOptions },
    handleSignals: deps.handleSignals ?? true,
  });
  try {
    switch (opts.command) {
      case 'init':
      case 'status':
        return {
          code: 0,
          out: {
            state: spine.state,
            next_milestone: nextEligible(spine.state),
            needs_alt: recommendNeedsAlt(spine.state.evidence, spine.state._verification_history),
          },
        };
      case 'plan':
        if (!opts.task) throw new Error('--task is required');
        return { code: 0, out: { advisory_plan: await spine.requestPlan(opts.task), adopted: false } };
      case 'alt':
        if (!opts.task) throw new Error('--task is required');
        return {
          code: 0,
          out: {
            advisory_alt: await spine.requestAltFraming(opts.task, {
              milestone: opts.milestone, escalate: opts.escalate,
            }),
            adopted: false,
          },
        };
      case 'replan':
        return { code: 0, out: { state: spine.adoptReplan(readJson(opts.plan)) } };
      case 'recover':
        if (!opts.evidence) throw new Error('--evidence is required');
        spine.endInterruptedInvocation({ classification: 'OBSERVED', detail: opts.evidence, stale_lock: staleLock });
        return { code: 0, out: { stale_lock_removed: staleLock, state: spine.state } };
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

/** npm bin shims invoke this file through a symlink; compare real paths (#135 B1). */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then(({ code, out }) => {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exitCode = code;
  }, (error) => {
    process.stderr.write(`ntg-vnext: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
