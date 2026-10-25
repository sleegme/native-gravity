#!/usr/bin/env node
/**
 * excavator-agy — TEMPORARY headless Excavator path (follow-up to #173).
 *
 * AGY 1.3.6+ native subagents cannot select Gemini 4 Argon (`model: pro` and
 * `model: flash` both run gemini-3.8-flash-tiered; exact slugs fail
 * registration), so Excavator stays `subagent: false`. TEMPORARY alternative
 * (owner decision): Bulldozer invokes this script via run_command, and the
 * script runs Excavator HEADLESSLY through the agy CLI on the exact
 * policy-resolved Argon slug (`gemini-4-argon-high`, same fail-closed
 * ROLE_POLICY_TABLE resolution the runner uses for Piledriver/Zen/Steamroller)
 * inside the milestone workspace. It prints Excavator's worker result in the
 * shape Bulldozer's contract already expects (ROOT_CAUSE, CHANGES,
 * VERIFICATION_EVIDENCE, ROLLBACK, RESIDUAL_RISK, STATUS).
 *
 * Revert to a native Argon subagent once agy allows it; see
 * agents/excavator.md for the re-enablement steps.
 *
 * Every failure mode is loud: the script exits non-zero with a typed error
 * (AGY_MISSING | RATE_LIMITED | TIMEOUT | UNRESOLVED_MODEL_SLUG |
 * UNPARSEABLE_OUTPUT | INVALID_WORKER_RESULT | TELEMETRY_LOG_FAILED | ...) so
 * Bulldozer falls back to the existing BLOCKED/NEEDS_DEEP path instead of
 * proceeding silently. Worker results are validated against the full
 * contract (ROOT_CAUSE, CHANGES, VERIFICATION_EVIDENCE, ROLLBACK when
 * changes were made, RESIDUAL_RISK, STATUS). Each
 * attempt — success or failure — is appended to
 * <workspace>/.ntg/excavator-agy-calls.jsonl with start/end/model/exit so the
 * call is visible in runner telemetry; if that required log write fails, the
 * call reports TELEMETRY_LOG_FAILED (exit 1) with the worker result preserved
 * in `worker_result`, never a silent success.
 *
 * Usage (from the milestone workspace; Bulldozer via run_command):
 *   node scripts/excavator-agy.mjs --milestone <id> --blocker "<one-line observed failure>"
 *   node scripts/excavator-agy.mjs --packet packet.json --blocker "..."     (packet file)
 *   node scripts/excavator-agy.mjs --packet - --blocker "..."              (packet on stdin)
 *
 * Options:
 *   --ledger PATH    Authoritative ledger holding the milestone packet
 *                    (default: NTG_SUPERVISOR_LEDGER from the supervisor env;
 *                    the packet is read read-only, never retyped by the caller)
 *   --timeout SECS   Outer wall-clock bound (default 600; env
 *                    NTG_EXCAVATOR_TIMEOUT_S). agy gets --print-timeout 30s
 *                    below the outer bound and self-terminates first.
 *   --agy PATH       agy executable (default AGY_PATH or "agy")
 *   --cwd DIR        Milestone workspace (default: current directory)
 *
 * Exit 0 prints one JSON object { ok: true, result, ... } on stdout (worker
 * STATUS READY or BLOCKED are both valid results). Any failure exits 1 with
 * { ok: false, error, message } on stderr.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { AuthoritativeLedger } from "./ledger.mjs";
import { loadNativeRoleBody, resolveSlug } from "./runner.mjs";

export const EXCAVATOR_ROLE = "excavator";
export const DEFAULT_TIMEOUT_S = 600;
/** agy terminates itself this many seconds before the outer spawn timeout. */
const PRINT_TIMEOUT_GRACE_S = 30;
/** JSONL call log relative to the milestone workspace. */
const CALL_LOG_RELATIVE_PATH = join(".ntg", "excavator-agy-calls.jsonl");

/** Typed invocation failure; `error` is the stable code Bulldozer relays. */
export class ExcavatorHeadlessError extends Error {
  constructor(error, message, details = {}) {
    super(message || error);
    this.name = "ExcavatorHeadlessError";
    this.ok = false;
    this.error = error;
    if (details && typeof details === "object") Object.assign(this, details);
  }
}

/**
 * Parses CLI arguments. Exactly one packet source is required: --packet
 * (path or "-" for stdin) or --milestone (with --ledger or
 * NTG_SUPERVISOR_LEDGER). --blocker is required.
 *
 * @param {string[]} argv
 * @returns {object} parsed options
 */
export function parseCliArgs(argv) {
  const opts = {
    ledger: undefined,
    packet: undefined,
    milestone: undefined,
    blocker: undefined,
    timeoutSeconds: undefined,
    agyPath: undefined,
    cwd: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = {
      "--ledger": "ledger",
      "--packet": "packet",
      "--milestone": "milestone",
      "--blocker": "blocker",
      "--timeout": "timeoutSeconds",
      "--agy": "agyPath",
      "--cwd": "cwd",
    }[arg];
    if (!key || argv[i + 1] === undefined) {
      throw new ExcavatorHeadlessError("INVALID_ARGS", `Unknown or incomplete option: ${arg}`);
    }
    opts[key] = argv[i + 1];
    i += 1;
  }
  const hasPacketSource = opts.packet !== undefined || opts.milestone !== undefined;
  if (!hasPacketSource) {
    throw new ExcavatorHeadlessError("INVALID_ARGS", "One of --packet or --milestone is required");
  }
  if (opts.packet !== undefined && opts.milestone !== undefined) {
    throw new ExcavatorHeadlessError("INVALID_ARGS", "--packet and --milestone are mutually exclusive");
  }
  if (typeof opts.blocker !== "string" || !opts.blocker.trim()) {
    throw new ExcavatorHeadlessError("INVALID_ARGS", "--blocker is required (one-line observed failure context)");
  }
  const rawSeconds = opts.timeoutSeconds ?? process.env.NTG_EXCAVATOR_TIMEOUT_S ?? DEFAULT_TIMEOUT_S;
  const seconds = Number(rawSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new ExcavatorHeadlessError("INVALID_ARGS", `--timeout must be a positive number of seconds (got ${rawSeconds})`);
  }
  opts.timeoutSeconds = seconds;
  return opts;
}

/**
 * Minimal packet contract: the assignment must identify the milestone and its
 * acceptance criteria; everything else Bulldozer passes through verbatim.
 *
 * @param {object} packet
 * @returns {string|null} validation error message or null when valid
 */
export function validatePacket(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return "packet must be a non-null JSON object";
  }
  if (typeof packet.milestone_id !== "string" || !packet.milestone_id.trim()) return "packet.milestone_id must be a non-empty string";
  if (typeof packet.objective !== "string" || !packet.objective.trim()) return "packet.objective must be a non-empty string";
  if (!Array.isArray(packet.acceptance_criteria) || packet.acceptance_criteria.length === 0) {
    return "packet.acceptance_criteria must be a non-empty array";
  }
  return null;
}

/**
 * Builds the excavator assignment packet, read-only, from exactly one source:
 * an already-parsed object (tests/probe), a JSON file / stdin, or the
 * authoritative ledger's milestone entry. The ledger is never written.
 *
 * @param {object} assignment - { packetObject } | { packetPath, readStdin } | { ledgerPath, milestoneId }
 * @param {object} [deps] - { readFileSync, readStdin } for tests
 * @returns {object} validated packet
 */
export function loadAssignment(assignment, deps = {}) {
  const readFile = deps.readFileSync ?? readFileSync;
  if (assignment.packetObject !== undefined) {
    const invalid = validatePacket(assignment.packetObject);
    if (invalid) throw new ExcavatorHeadlessError("INVALID_PACKET", invalid);
    return assignment.packetObject;
  }
  if (assignment.packetPath !== undefined) {
    let raw;
    if (assignment.packetPath === "-") {
      const readStdin = deps.readStdin;
      if (typeof readStdin !== "function") {
        throw new ExcavatorHeadlessError("INVALID_PACKET", "stdin packet requested but no stdin reader available");
      }
      raw = readStdin();
    } else {
      try {
        raw = readFile(assignment.packetPath, "utf-8");
      } catch (err) {
        throw new ExcavatorHeadlessError("INVALID_PACKET", `cannot read packet file: ${err.message}`);
      }
    }
    let packet;
    try {
      packet = JSON.parse(raw);
    } catch (err) {
      throw new ExcavatorHeadlessError("INVALID_PACKET", `packet is not valid JSON: ${err.message}`);
    }
    const invalid = validatePacket(packet);
    if (invalid) throw new ExcavatorHeadlessError("INVALID_PACKET", invalid);
    return packet;
  }
  if (assignment.ledgerPath !== undefined) {
    let ledger;
    try {
      ledger = AuthoritativeLedger.load(assignment.ledgerPath);
    } catch (err) {
      throw new ExcavatorHeadlessError("LEDGER_UNREADABLE", `cannot read ledger read-only: ${err.message}`);
    }
    const state = ledger.getState();
    const milestone = (state.milestones ?? []).find((m) => m && m.id === assignment.milestoneId);
    if (!milestone) {
      throw new ExcavatorHeadlessError("MILESTONE_NOT_FOUND", `milestone "${assignment.milestoneId}" not found in ledger`);
    }
    // Same packet shape spine delegate() hands Bulldozer; read-only accessors.
    const packet = {
      milestone_id: milestone.id,
      plan_version: state.plan_version,
      objective: milestone.objective,
      bounded_scope: Array.isArray(milestone.bounded_scope) ? [...milestone.bounded_scope] : [],
      non_goals: Array.isArray(milestone.non_goals) ? [...milestone.non_goals] : [],
      acceptance_criteria: Array.isArray(milestone.acceptance_criteria) ? [...milestone.acceptance_criteria] : [],
      constraints: Array.isArray(state.constraints) ? [...state.constraints] : [],
      relevant_evidence: ledger.getRelevantEvidence(assignment.milestoneId),
      decision_invariants: ledger.getRelevantDecisionInvariants(assignment.milestoneId),
    };
    const invalid = validatePacket(packet);
    if (invalid) throw new ExcavatorHeadlessError("INVALID_PACKET", invalid);
    return packet;
  }
  throw new ExcavatorHeadlessError("INVALID_ARGS", "no packet source provided");
}

/**
 * Composes the headless prompt: the shipped Excavator contract (frontmatter
 * stripped, loaded through the runner's fail-closed loader) plus the machine
 * invocation assignment. Mirrors ntg-vnext's nativeZen prompt shape.
 *
 * @param {object} parts - { roleBody, packet, blocker, slug, workspace }
 * @returns {string} prompt
 */
export function composeExcavatorPrompt({ roleBody, packet, blocker, slug, workspace }) {
  const instruction = "You are invoked through the TEMPORARY headless Excavator path "
    + "(scripts/excavator-agy.mjs) on the exact model "
    + `"${slug}" because agy native subagents cannot select Argon yet (#173). `
    + "This is the sanctioned invocation of your contract below; you are still "
    + "not a native subagent and have no children. Work only inside this "
    + `workspace ("${workspace}") and the packet below; return control after one result.\n\n`
    + "## Blocker context from Bulldozer\n"
    + `${blocker.trim()}\n\n`
    + "## Milestone packet\n"
    + `${JSON.stringify(packet, null, 2)}\n\n`
    + "## Required output format\n"
    + "Return exactly one bare JSON object and nothing else: the first byte of "
    + "your response must be `{`. No prose, no code fences, no trailing text. "
    + "Use exactly the fields your contract's \"Worker result to Bulldozer\" "
    + "section defines: ROOT_CAUSE (labeled CONFIRMED, LIKELY or SPECULATIVE), "
    + "CHANGES, VERIFICATION_EVIDENCE, ROLLBACK, RESIDUAL_RISK and STATUS "
    + "(\"READY\" or \"BLOCKED\"). READY requires your own observed verification "
    + "of the repair inside this workspace.";
  return `${roleBody}\n\n${instruction}`;
}

/**
 * Builds the agy argument vector. `-p` stays last: agy consumes the token
 * after it as the prompt. `--print-timeout` lets agy terminate itself before
 * the outer spawn timeout fires.
 *
 * @param {object} parts - { slug, prompt, printTimeoutSeconds }
 * @returns {string[]} agy argv
 */
export function buildAgyArgs({ slug, prompt, printTimeoutSeconds }) {
  return [
    "--model", slug,
    "--output-format", "stream-json",
    "--print-timeout", `${printTimeoutSeconds}s`,
    "--dangerously-skip-permissions",
    "-p", prompt,
  ];
}

/**
 * Parses agy stream-json stdout (one JSON event per line). Prefers the final
 * `result` event; falls back to the concatenated text deltas of the last
 * agent_response step when no result event was emitted.
 *
 * @param {string} stdout
 * @returns {{ events: object[], malformed: number, resultEvent: object|null, lastAgentText: string }}
 */
export function parseStreamJson(stdout) {
  const events = [];
  let malformed = 0;
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      malformed += 1;
    }
  }
  let resultEvent = null;
  const deltas = new Map();
  for (const event of events) {
    if (event && event.event === "result" && event.result && typeof event.result === "object") {
      resultEvent = event.result;
    }
    const step = event?.step_update;
    if (step && step.step_type === "agent_response" && typeof step.text_delta === "string") {
      deltas.set(step.step_index, (deltas.get(step.step_index) ?? "") + step.text_delta);
    }
  }
  let lastAgentText = "";
  if (deltas.size) {
    const lastKey = [...deltas.keys()].sort((a, b) => a - b).at(-1);
    lastAgentText = deltas.get(lastKey) ?? "";
  }
  return { events, malformed, resultEvent, lastAgentText };
}

/**
 * Validates a parsed worker result against the full contract shape Bulldozer
 * expects (gate B2, #174): STATUS, labeled ROOT_CAUSE, material CHANGES and
 * VERIFICATION_EVIDENCE (both required for READY), RESIDUAL_RISK always, and
 * ROLLBACK whenever persistent changes were made (non-empty CHANGES).
 * Returns an error message or null.
 *
 * @param {object} result
 * @returns {string|null}
 */
export function validateWorkerResult(result) {
  const status = typeof result.STATUS === "string" ? result.STATUS.trim().toUpperCase() : "";
  if (!['READY', 'BLOCKED'].includes(status)) {
    return 'STATUS must be "READY" or "BLOCKED"';
  }
  if (typeof result.ROOT_CAUSE !== "string" || !result.ROOT_CAUSE.trim()) {
    return "ROOT_CAUSE must be a non-empty string";
  }
  if (status === 'READY' && !/\b(CONFIRMED|LIKELY|SPECULATIVE)\b/.test(result.ROOT_CAUSE)) {
    return "ROOT_CAUSE for READY must be labeled CONFIRMED, LIKELY or SPECULATIVE";
  }
  if (!Array.isArray(result.CHANGES)) {
    return "CHANGES must be an array of files, edits or artifacts produced";
  }
  if (status === 'READY' && result.CHANGES.length === 0) {
    return "CHANGES for READY must be a non-empty array (files, edits or artifacts produced)";
  }
  if (!Array.isArray(result.VERIFICATION_EVIDENCE)) {
    return "VERIFICATION_EVIDENCE must be an array";
  }
  if (status === 'READY' && result.VERIFICATION_EVIDENCE.length === 0) {
    return "VERIFICATION_EVIDENCE for READY must be a non-empty array of OBSERVED results";
  }
  if (typeof result.RESIDUAL_RISK !== "string" || !result.RESIDUAL_RISK.trim()) {
    return "RESIDUAL_RISK must be a non-empty string";
  }
  if (result.CHANGES.length > 0
      && (typeof result.ROLLBACK !== "string" || !result.ROLLBACK.trim())) {
    return "ROLLBACK is required whenever persistent changes were made (non-empty CHANGES)";
  }
  return null;
}

/**
 * Extracts the worker result JSON from the model's response text. Tries the
 * whole text, a whole-body code fence, then the outermost brace span.
 *
 * @param {string} text
 * @returns {{ ok: true, result: object } | { ok: false, error: string, message: string }}
 */
export function extractWorkerResult(text) {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return { ok: false, error: "UNPARSEABLE_OUTPUT", message: "response text is empty" };
  }
  const candidates = [];
  const fenced = raw.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(raw);
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const candidate of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const invalid = validateWorkerResult(parsed);
    if (invalid) return { ok: false, error: "INVALID_WORKER_RESULT", message: invalid };
    return { ok: true, result: parsed };
  }
  return { ok: false, error: "UNPARSEABLE_OUTPUT", message: "no parseable JSON worker result in response" };
}

const RATE_LIMIT_RE = /(?:\b429\b|http\s*429|rate[ ._:-]?limit|resource[ ._:-]?exhausted|quota.*(exhaust|exceed)|too many requests)/i;

/**
 * Classifies a transport failure into a stable error code Bulldozer can relay.
 *
 * @param {object} parts - { spawnError, status, stderr, stdout }
 * @returns {{ error: string, message: string } | null} null when no failure
 */
export function classifyAgyFailure({ spawnError, status, stderr, stdout }) {
  if (spawnError) {
    if (spawnError.code === "ENOENT") {
      return { error: "AGY_MISSING", message: "agy executable not found (ENOENT)" };
    }
    if (spawnError.code === "ETIMEDOUT") {
      return { error: "TIMEOUT", message: "agy invocation exceeded the outer timeout and was killed" };
    }
    return { error: "SPAWN_ERROR", message: spawnError.message ?? String(spawnError) };
  }
  if (status !== 0) {
    const combined = `${stderr ?? ""}\n${stdout ?? ""}`;
    if (RATE_LIMIT_RE.test(combined)) {
      return { error: "RATE_LIMITED", message: "agy reported a rate limit or exhausted quota (429)" };
    }
    const tail = String(stderr ?? "").replace(/\s+/g, " ").trim().slice(-300);
    return { error: "AGY_EXIT_NONZERO", message: `agy exited ${status}${tail ? `: ${tail}` : ""}` };
  }
  return null;
}

/**
 * Runs one headless Excavator invocation end to end.
 *
 * @param {object} options - {
 *   assignment: { packetObject } | { packetPath } | { ledgerPath, milestoneId },
 *   blocker: string,
 *   cwd?: string, agyPath?: string, timeoutSeconds?: number,
 *   installedModels?: Array (slug-resolution passthrough for tests),
 *   roleBodyDir?: string (role-body passthrough for tests) }
 * @param {object} [deps] - { spawn, now, appendFile, env } for tests
 * @returns {{ ok: boolean, telemetryPath: string, [error]: string, ... }}
 */
export function runExcavatorHeadless(options, deps = {}) {
  const spawn = deps.spawn ?? spawnSync;
  const now = deps.now ?? Date.now;
  const env = deps.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const timeoutSeconds = typeof options.timeoutSeconds === "number" ? options.timeoutSeconds : DEFAULT_TIMEOUT_S;
  const agyPath = options.agyPath ?? env.AGY_PATH ?? "agy";
  const telemetryPath = join(cwd, CALL_LOG_RELATIVE_PATH);
  const startedWall = new Date(now()).toISOString();
  const startedMs = now();

  const outcome = { ok: false, telemetryPath };
  const recordTelemetry = (extra) => {
    const record = {
      tool: "excavator-agy",
      started_at: startedWall,
      ended_at: new Date(now()).toISOString(),
      duration_ms: Math.max(0, now() - startedMs),
      model: extra.model ?? null,
      exit_status: extra.exit_status ?? null,
      ok: extra.ok === true,
      error: extra.ok === true ? null : (extra.error ?? "UNKNOWN"),
      worker_status: extra.worker_status ?? null,
      milestone_id: extra.milestone_id ?? null,
      usage: extra.usage ?? null,
    };
    try {
      mkdirSync(join(cwd, ".ntg"), { recursive: true });
      (deps.appendFile ?? appendFileSync)(telemetryPath, `${JSON.stringify(record)}\n`);
      return { record, logged: true, logError: null };
    } catch (err) {
      // Required audit logging (gate B3, #174): never silent. The outcome is
      // surfaced by the callers; the record is still returned in memory.
      return { record, logged: false, logError: err?.message ?? String(err) };
    }
  };

  let packet;
  let slug = null;
  try {
    packet = loadAssignment(options.assignment ?? {}, { readStdin: deps.readStdin });

    // Recursion protection, same mechanism as the runner: refuse when an
    // excavator frame is already on the chain, and mark the child frame.
    const chainRaw = env.NTG_RUNNER_CHAIN;
    const parts = typeof chainRaw === "string" ? chainRaw.split(":").map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
    if (parts.includes(EXCAVATOR_ROLE)) {
      throw new ExcavatorHeadlessError("RECURSION_DETECTED", `NTG_RUNNER_CHAIN already contains "${EXCAVATOR_ROLE}"`);
    }

    try {
      slug = resolveSlug(EXCAVATOR_ROLE, { agyPath, installedModels: options.installedModels });
    } catch (err) {
      throw new ExcavatorHeadlessError(err.error ?? "UNRESOLVED_MODEL_SLUG", err.message, { reason: err.reason });
    }

    let roleBody;
    try {
      roleBody = loadNativeRoleBody(EXCAVATOR_ROLE, { roleBodyDir: options.roleBodyDir, env });
    } catch (err) {
      throw new ExcavatorHeadlessError(err.error ?? "ROLE_BODY_ERROR", err.message);
    }

    const prompt = composeExcavatorPrompt({ roleBody, packet, blocker: options.blocker, slug, workspace: cwd });
    const printTimeoutSeconds = Math.max(30, timeoutSeconds - PRINT_TIMEOUT_GRACE_S);
    const args = buildAgyArgs({ slug, prompt, printTimeoutSeconds });
    const childEnv = {
      ...env,
      NTG_RUNNER_CHAIN: [...parts, EXCAVATOR_ROLE].join(":"),
    };

    const result = spawn(agyPath, args, {
      cwd,
      timeout: Math.round(timeoutSeconds * 1000),
      killSignal: "SIGKILL",
      detached: process.platform !== "win32",
      env: childEnv,
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
    });

    if (result.error) {
      // POSIX detached children lead their own group; kill remaining descendants.
      if (result.error.code === "ETIMEDOUT" && process.platform !== "win32" && result.pid) {
        try {
          process.kill(-result.pid, "SIGKILL");
        } catch (err) {
          if (err.code !== "ESRCH") throw err;
        }
      }
      const failure = classifyAgyFailure({ spawnError: result.error, status: result.status, stderr: result.stderr, stdout: result.stdout });
      throw new ExcavatorHeadlessError(failure.error, failure.message, {
        slug, milestone_id: packet.milestone_id, exit_status: result.status ?? null,
      });
    }

    const failure = classifyAgyFailure({ spawnError: null, status: result.status, stderr: result.stderr, stdout: result.stdout });
    if (failure) {
      throw new ExcavatorHeadlessError(failure.error, failure.message, {
        slug, milestone_id: packet.milestone_id, exit_status: result.status,
      });
    }

    const stream = parseStreamJson(result.stdout);
    if (!stream.resultEvent) {
      throw new ExcavatorHeadlessError("UNPARSEABLE_OUTPUT", "agy stream-json contained no result event", {
        slug, milestone_id: packet.milestone_id, exit_status: result.status, malformed_lines: stream.malformed,
      });
    }
    if (stream.resultEvent.status !== "SUCCESS") {
      throw new ExcavatorHeadlessError("AGY_NON_SUCCESS", `agy result status was "${stream.resultEvent.status}"`, {
        slug, milestone_id: packet.milestone_id, exit_status: result.status,
      });
    }
    const extracted = extractWorkerResult(stream.resultEvent.response ?? stream.lastAgentText);
    if (!extracted.ok) {
      throw new ExcavatorHeadlessError(extracted.error, extracted.message, {
        slug, milestone_id: packet.milestone_id, exit_status: result.status,
      });
    }

    Object.assign(outcome, {
      ok: true,
      result: extracted.result,
      worker_status: extracted.result.STATUS.trim().toUpperCase(),
      slug,
      milestone_id: packet.milestone_id,
      started_at: startedWall,
      ended_at: new Date(now()).toISOString(),
      duration_ms: Math.max(0, now() - startedMs),
      exit_status: result.status,
      usage: stream.resultEvent.usage && typeof stream.resultEvent.usage === "object"
        ? stream.resultEvent.usage
        : null,
    });
    const telemetry = recordTelemetry({ ...outcome, model: slug });
    if (!telemetry.logged) {
      // The worker result is valid but this call cannot satisfy its required
      // audit logging: report an explicit unsuccessful outcome while keeping
      // the worker result for Bulldozer's fallback evidence (gate B3).
      return {
        ...outcome,
        ok: false,
        error: "TELEMETRY_LOG_FAILED",
        message: `worker result obtained but the required call log could not be written: ${telemetry.logError}`,
        worker_result: outcome.result,
        telemetry_logged: false,
        telemetry_error: telemetry.logError,
        telemetry: telemetry.record,
      };
    }
    return { ...outcome, telemetry_logged: true, telemetry: telemetry.record };
  } catch (err) {
    const failure = err instanceof ExcavatorHeadlessError
      ? err
      : new ExcavatorHeadlessError("INTERNAL_ERROR", err?.message ?? String(err));
    Object.assign(outcome, {
      ok: false,
      error: failure.error,
      message: failure.message,
      ...(failure.slug !== undefined ? { slug: failure.slug } : {}),
      ...(failure.milestone_id !== undefined ? { milestone_id: failure.milestone_id } : {}),
      ...(failure.exit_status !== undefined ? { exit_status: failure.exit_status } : {}),
      ...(failure.reason !== undefined ? { reason: failure.reason } : {}),
    });
    const telemetry = recordTelemetry({ ...outcome, model: failure.slug ?? slug ?? null });
    return {
      ...outcome,
      telemetry_logged: telemetry.logged,
      ...(telemetry.logged ? {} : { telemetry_error: telemetry.logError }),
      telemetry: telemetry.record,
    };
  }
}

function readStdinSync() {
  try {
    return readFileSync(0, "utf-8");
  } catch (err) {
    throw new ExcavatorHeadlessError("INVALID_PACKET", `cannot read packet from stdin: ${err.message}`);
  }
}

/** CLI entry. Returns the outcome object; the caller sets the exit code. */
export function main(argv, deps = {}) {
  let opts;
  try {
    opts = parseCliArgs(argv);
  } catch (err) {
    const failure = { ok: false, error: err.error ?? "INVALID_ARGS", message: err.message };
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    return { ...failure, exitCode: 1 };
  }
  const env = deps.env ?? process.env;
  const ledger = opts.ledger ?? env.NTG_SUPERVISOR_LEDGER;
  if (opts.milestone !== undefined && ledger === undefined) {
    const failure = { ok: false, error: "INVALID_ARGS", message: "--milestone requires --ledger or NTG_SUPERVISOR_LEDGER in the environment" };
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    return { ...failure, exitCode: 1 };
  }
  const assignment = opts.packet !== undefined
    ? { packetPath: opts.packet }
    : { ledgerPath: ledger, milestoneId: opts.milestone };
  const outcome = runExcavatorHeadless({
    assignment,
    blocker: opts.blocker,
    cwd: opts.cwd,
    agyPath: opts.agyPath,
    timeoutSeconds: opts.timeoutSeconds,
    ...(deps.installedModels !== undefined ? { installedModels: deps.installedModels } : {}),
    ...(deps.roleBodyDir !== undefined ? { roleBodyDir: deps.roleBodyDir } : {}),
  }, { ...deps, readStdin: deps.readStdin ?? readStdinSync });

  if (outcome.ok) {
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
    return { ...outcome, exitCode: 0 };
  }
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: outcome.error,
    message: outcome.message,
    ...(outcome.slug ? { slug: outcome.slug } : {}),
    ...(outcome.milestone_id ? { milestone_id: outcome.milestone_id } : {}),
    ...(outcome.worker_result ? { worker_result: outcome.worker_result } : {}),
    ...(outcome.telemetry_logged === false ? { telemetry_logged: false, telemetry_error: outcome.telemetry_error } : {}),
  })}\n`);
  return { ...outcome, exitCode: 1 };
}

// CLI execution support
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2)).exitCode;
}
