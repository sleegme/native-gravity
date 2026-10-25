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
 *   ntg-vnext navi    --ledger L --task "..."         (bounded desktop leaf)
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
import { AuthoritativeLedger, computeUsageRollup } from './ledger.mjs';
import { verifyLedgerIntegrity } from './ledger-lock.mjs';
import { invoke, loadNativeRoleBody, parseResponseEnvelope, parseResponsePacket, resolveSlug } from './runner.mjs';
import { createInterface } from 'node:readline';
import { reportIssueCli } from './report-issue.mjs';


/** Executor provenance markers inherited by every runner/Zen child (#135 B2). */
export const SUPERVISOR_PID_ENV = 'NTG_SUPERVISOR_PID';
export const SUPERVISOR_LEDGER_ENV = 'NTG_SUPERVISOR_LEDGER';
const EXECUTOR_EXIT_WAIT_MS = 10000;
/** Native verification gate: invoked here, never supervised as a runner role. */
const ZEN_ROLE = 'zen';

export const DEFAULT_RUNNER_TIMEOUT_S = 600;
const USAGE = 'usage: ntg-vnext <init|plan|run|replan|recover|alt|status|navi> --ledger PATH [options]';

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
  if (!['init', 'plan', 'run', 'replan', 'recover', 'alt', 'status', 'navi'].includes(command)) throw new Error(USAGE);
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
  // Accounting comes only from the AGY envelope; a usage field inside the
  // model-authored packet is not observed provider usage.
  delete packet.usage;
  if (envelope.usage !== undefined) {
    packet.usage = envelope.usage;
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
  const startTime = Date.now();
  const slug = resolveZenModel({ agyPath, installedModels });
  const instruction = 'Independently verify the candidate against its milestone contract. '
    + 'Return only a bare JSON object with milestone_id, plan_version and result_ref echoed unchanged, '
    + 'verdict (GO or NO-GO), verification_evidence (non-empty array of '
    + '{"classification": "OBSERVED", "criterion": "...", "result": "..."}) and, for NO-GO, '
    + 'repair_needs (non-empty string). Request:\n' + JSON.stringify(request);
  const prompt = `${loadNativeRoleBody(ZEN_ROLE)}\n\n${instruction}`;
  const args = [
    '--model', slug,
    '--output-format', 'json', '--dangerously-skip-permissions', '-p', prompt,
  ];
  const r = spawnSync(agyPath, args, { cwd, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 20 * 1024 * 1024 });
  const duration_ms = Math.max(0, Date.now() - startTime);
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`zen invocation exited ${r.status}: ${(r.stderr || '').slice(-500)}`);
  const packet = parseZenEnvelope(r.stdout);
  packet.duration_ms = duration_ms;
  packet.slug = slug;
  return packet;
}

function nextEligible(state) {
  const done = new Set(state.completed_milestones);
  return state.milestones.find(m => !done.has(m.id)
    && (m.dependencies || []).every(dep => done.has(dep)))?.id ?? null;
}

/**
 * Specialist workers run inside the Bulldozer AGY process. The candidate's
 * `delegations` array is a model-authored claim, not an observed invocation:
 * it carries no native invocation identity, duration or provider usage. These
 * claims are recorded as declared/unverified telemetry only and never counted
 * as measured accounting (Refs #164 gate review).
 */
function nativeDelegations(candidate, role) {
  if (role !== 'bulldozer' || !candidate || typeof candidate !== 'object'
      || Array.isArray(candidate) || !Array.isArray(candidate.delegations)) {
    return [];
  }
  const allowed = new Set(['jaguar', 'puma', 'bobcat']);
  return candidate.delegations.filter(delegation => delegation
    && typeof delegation === 'object' && !Array.isArray(delegation)
    && typeof delegation.role === 'string'
    && allowed.has(delegation.role.trim().toLowerCase()));
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

  const getLedger = () => AuthoritativeLedger.getInstance(opts.ledger);
  const spineRunnerOptions = { timeout: opts.timeoutMs, ...deps.runnerOptions };

  let spine;

  const wrappedInvokeRole = async (role, packet, runnerOptions = {}) => {
    const startTime = Date.now();
    let milestoneId = packet?.milestone_id ?? packet?.milestoneId ?? null;
    if (!milestoneId && typeof packet?.task === 'string') {
      try {
        const idx = packet.task.indexOf('{');
        if (idx !== -1) {
          const parsed = JSON.parse(packet.task.slice(idx));
          milestoneId = parsed.milestone_id ?? parsed.milestoneId ?? null;
        }
      } catch {}
    }
    if (!milestoneId) {
      milestoneId = spine?.state?.current_milestone ?? null;
    }

    let slug = null;
    try {
      slug = resolveSlug(role, runnerOptions);
    } catch {}

    const baseInvokeRole = deps.invokeRole ?? invoke;
    let result;
    try {
      result = await baseInvokeRole(role, packet, runnerOptions);
    } catch (error) {
      // Incident WQ-5: verify the durable ledger survived the invocation
      // before recording anything, so a violation is never saved over.
      verifyLedgerIntegrity(opts.ledger, {
        role, milestoneId, invocationError: String(error?.message ?? error),
      });
      const elapsed = Math.max(0, Date.now() - startTime);
      if (milestoneId) {
        const ledger = getLedger();
        if (ledger) {
          try {
            ledger.recordUsage(milestoneId, {
              role,
              slug,
              duration_ms: elapsed,
              usage: undefined,
              status: error?.code || error?.name || 'ERROR',
            });
            ledger.save(opts.ledger);
          } catch {}
        }
      }
      throw error;
    }

    // Incident WQ-5: the durable ledger must have survived the invocation
    // before its result is accounted and saved.
    verifyLedgerIntegrity(opts.ledger, { role, milestoneId });

    const elapsed = Math.max(0, Date.now() - startTime);
    const duration_ms = typeof result?.duration_ms === 'number' ? result.duration_ms : elapsed;
    if (result?.slug) slug = result.slug;
    const usage = result?.usage;
    let status = result?.status ?? result?.verdict ?? (result?.ok === false ? (result?.error ?? 'FAILED') : 'SUCCESS');

    let parsedResponse = null;
    if (typeof result?.response === 'string') {
      // Same accepted parser the spine uses, so fenced or narrated packets
      // cannot silently skip declaration accounting.
      const parsed = parseResponsePacket({ ok: true, response: result.response });
      if (parsed.ok) parsedResponse = parsed.packet;
    } else if (result?.response && typeof result.response === 'object') {
      parsedResponse = result.response;
    }
    if (parsedResponse && typeof parsedResponse === 'object') {
      if (typeof parsedResponse.status === 'string') status = parsedResponse.status;
      else if (typeof parsedResponse.verdict === 'string') status = parsedResponse.verdict;
    }

    if (milestoneId) {
      const ledger = getLedger();
      if (ledger) {
        try {
          ledger.recordUsage(milestoneId, {
            role,
            slug,
            duration_ms,
            usage,
            status: String(status || 'UNKNOWN'),
          });
          for (const delegation of nativeDelegations(parsedResponse, role)) {
            // Claimed status and slug are preserved as attribution; duration
            // and usage stay unknown because no runtime event measured them.
            ledger.recordUsage(milestoneId, {
              role: delegation.role.trim().toLowerCase(),
              slug: typeof delegation.slug === 'string' ? delegation.slug : null,
              duration_ms: undefined,
              usage: undefined,
              status: typeof delegation.status === 'string' ? delegation.status : 'DELEGATED',
              source: 'declared',
              verified: false,
            });
          }
          ledger.save(opts.ledger);
        } catch {}
      }
    }
    return result;
  };

  const wrappedInvokeZen = async (request) => {
    const startTime = Date.now();
    const milestoneId = request?.milestone_id ?? spine?.state?.current_milestone ?? null;
    let slug = null;
    try {
      slug = resolveZenModel();
    } catch {}

    const baseInvokeZen = deps.invokeZen ?? (req => nativeZen(req));
    let verdict;
    try {
      verdict = await baseInvokeZen(request);
    } catch (error) {
      // Incident WQ-5: verify the durable ledger survived the invocation
      // before recording anything, so a violation is never saved over.
      verifyLedgerIntegrity(opts.ledger, {
        role: 'zen', milestoneId, invocationError: String(error?.message ?? error),
      });
      const elapsed = Math.max(0, Date.now() - startTime);
      if (milestoneId) {
        const ledger = getLedger();
        if (ledger) {
          try {
            ledger.recordUsage(milestoneId, {
              role: 'zen',
              slug,
              duration_ms: elapsed,
              usage: undefined,
              status: error?.code || error?.name || 'ERROR',
            });
            ledger.save(opts.ledger);
          } catch {}
        }
      }
      throw error;
    }

    // Incident WQ-5: the durable ledger must have survived the invocation
    // before its verdict is accounted and saved.
    verifyLedgerIntegrity(opts.ledger, { role: 'zen', milestoneId });

    const elapsed = Math.max(0, Date.now() - startTime);
    const duration_ms = typeof verdict?.duration_ms === 'number' ? verdict.duration_ms : elapsed;
    const usage = verdict?.usage;
    const status = verdict?.verdict ?? verdict?.status ?? 'UNKNOWN';
    if (verdict?.slug) slug = verdict.slug;

    if (milestoneId) {
      const ledger = getLedger();
      if (ledger) {
        try {
          ledger.recordUsage(milestoneId, {
            role: 'zen',
            slug,
            duration_ms,
            usage,
            status: String(status),
          });
          ledger.save(opts.ledger);
        } catch {}
      }
    }
    return verdict;
  };

  const wrappedInvokeSpecialist = async (role, slice, options = {}) => {
    const startTime = Date.now();
    const milestoneId = slice?.milestone_id ?? slice?.milestoneId ?? spine?.state?.current_milestone ?? null;
    const specialistOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    let slug = specialistOptions.slug ?? slice?.slug ?? null;
    try {
      slug = resolveSlug(role, specialistOptions) ?? slug;
    } catch {}

    let result;
    try {
      if (deps.invokeSpecialist) {
        result = await deps.invokeSpecialist(role, slice, specialistOptions);
      } else if (deps.invokeRole) {
        result = await deps.invokeRole(role, slice, { ...spineRunnerOptions, ...specialistOptions });
      } else {
        result = await invoke(role, slice, { ...spineRunnerOptions, ...specialistOptions });
      }
    } catch (error) {
      // Incident WQ-5: verify the durable ledger survived the invocation
      // before recording anything, so a violation is never saved over.
      verifyLedgerIntegrity(opts.ledger, {
        role, milestoneId, invocationError: String(error?.message ?? error),
      });
      const elapsed = Math.max(0, Date.now() - startTime);
      if (milestoneId) {
        const ledger = getLedger();
        if (ledger) {
          try {
            ledger.recordUsage(milestoneId, {
              role,
              slug,
              duration_ms: elapsed,
              usage: undefined,
              status: error?.code || error?.name || 'ERROR',
            });
            ledger.save(opts.ledger);
          } catch {}
        }
      }
      throw error;
    }

    // Incident WQ-5: the durable ledger must have survived the invocation
    // before its result is accounted and saved.
    verifyLedgerIntegrity(opts.ledger, { role, milestoneId });

    const elapsed = Math.max(0, Date.now() - startTime);
    const duration_ms = typeof result?.duration_ms === 'number' ? result.duration_ms : elapsed;
    if (result?.slug) slug = result.slug;
    const usage = result?.usage;
    let status = result?.status ?? result?.verdict ?? (result?.ok === false ? (result?.error ?? 'FAILED') : 'SUCCESS');

    let parsedResponse = null;
    if (typeof result === 'string') {
      try { parsedResponse = JSON.parse(result); } catch {}
    } else if (typeof result?.response === 'string') {
      try { parsedResponse = JSON.parse(result.response); } catch {}
    } else if (result?.response && typeof result.response === 'object') {
      parsedResponse = result.response;
    } else if (result && typeof result === 'object') {
      parsedResponse = result;
    }

    if (parsedResponse && typeof parsedResponse === 'object') {
      if (typeof parsedResponse.status === 'string') status = parsedResponse.status;
      else if (typeof parsedResponse.verdict === 'string') status = parsedResponse.verdict;
    }

    if (milestoneId) {
      const ledger = getLedger();
      if (ledger) {
        try {
          ledger.recordUsage(milestoneId, {
            role,
            slug,
            duration_ms,
            usage,
            status: String(status || 'UNKNOWN'),
          });
          ledger.save(opts.ledger);
        } catch {}
      }
    }
    return result;
  };

  try {
    spine = new MinimalSpine({
      ledgerPath: opts.ledger,
      plan: opts.command === 'init' ? readJson(opts.plan) : undefined,
      invokeRole: wrappedInvokeRole,
      invokeZen: wrappedInvokeZen,
      invokeSpecialist: wrappedInvokeSpecialist,
      runnerOptions: spineRunnerOptions,
      handleSignals: deps.handleSignals ?? true,
    });
    switch (opts.command) {
      case 'init':
      case 'status': {
        const out = {
          state: spine.state,
          next_milestone: nextEligible(spine.state),
          needs_alt: recommendNeedsAlt(spine.state.evidence, spine.state._verification_history),
        };
        const rollup = computeUsageRollup(spine.state);
        if (rollup !== null) {
          out.usage = rollup;
        }
        return {
          code: 0,
          out,
        };
      }
      case 'navi': {
        if (!opts.task) throw new Error('--task is required');
        const desktop = await spine.requestDesktop(opts.task);
        return {
          code: desktop.status === 'NEEDS_CONFIRMATION' || desktop.status === 'BLOCKED' ? 2 : 0,
          out: { desktop, state: spine.state },
        };
      }
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
    spine?.close();
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

export const REPORT_PROMPT_QUESTION = 'Report this problem as an issue? (y/N)';

/**
 * Evaluates whether an issue report prompt should be shown.
 * Prompts only when both stdin and stderr are TTYs, and skips when CI is set
 * or NTG_NO_REPORT_PROMPT=1.
 */
export function shouldPromptForReport({ stdin = process.stdin, stderr = process.stderr, env = process.env } = {}) {
  // Presence check: CI suppresses the prompt even when set to an empty
  // string (#168 B6).
  if ('CI' in env) return false;
  if (env.NTG_NO_REPORT_PROMPT === '1') return false;
  return Boolean(stdin?.isTTY && stderr?.isTTY);
}

/**
 * Top-level CLI execution for ntg-vnext.
 * Runs main(argv, deps), then if the command ended with a problem (rejected
 * promise, or non-zero exit code), prompts interactively or prints the report hint.
 *
 * @param {string[]} argv Command-line arguments without node or script path
 * @param {object} [io={}] Injected I/O, environment, and dependencies for testing
 * @returns {Promise<{ code: number, out?: object, error?: Error }>}
 */
export async function runCli(argv, io = {}) {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const prompt = io.prompt ?? null;
  const reportIssue = io.reportIssue ?? reportIssueCli;
  const deps = io.deps ?? {};

  let result = null;
  let error = null;
  let exitCode = 0;

  try {
    result = await main(argv, deps);
    exitCode = typeof result?.code === 'number' ? result.code : 0;
    if (result?.out !== undefined) {
      stdout.write(JSON.stringify(result.out, null, 2) + '\n');
    }
  } catch (err) {
    error = err;
    exitCode = 1;
    stderr.write(`ntg-vnext: ${err?.message ?? err}\n`);
  }

  const isProblem = error !== null || exitCode !== 0;
  if (isProblem) {
    const ledgerIdx = argv.indexOf('--ledger');
    const ledgerPath = (ledgerIdx !== -1 && argv[ledgerIdx + 1]) ? argv[ledgerIdx + 1] : '<path>';

    if (shouldPromptForReport({ stdin, stderr, env })) {
      stderr.write(`${REPORT_PROMPT_QUESTION}\n`);
      let answer = '';
      if (typeof prompt === 'function') {
        answer = await prompt(REPORT_PROMPT_QUESTION);
      } else {
        const rl = createInterface({ input: stdin, output: stderr });
        answer = await new Promise((res) => {
          let settled = false;
          rl.question('', (ans) => {
            settled = true;
            rl.close();
            res(ans);
          });
          rl.once('close', () => {
            if (!settled) res('');
          });
        });
      }

      const normalized = typeof answer === 'string' ? answer.trim().toLowerCase() : '';
      if (normalized === 'y' || normalized === 'yes') {
        try {
          await reportIssue(['--ledger', ledgerPath], {
            stdin,
            stdout,
            stderr,
            env,
            prompt: io.reportPrompt ?? prompt,
            cwd: io.cwd ?? process.cwd(),
            spawn: io.spawn,
          });
        } catch (reportErr) {
          stderr.write(`ntg-report-issue error: ${reportErr?.message ?? reportErr}\n`);
        }
      }
    } else {
      stderr.write(`To report this issue: ntg-report-issue --ledger ${ledgerPath}\n`);
    }
  }

  return { code: exitCode, out: result?.out, error };
}

if (invokedDirectly()) {
  const argv = process.argv.slice(2);
  runCli(argv).then(({ code }) => {
    process.exitCode = code;
  });
}
