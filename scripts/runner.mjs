import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { withNaviHome } from "./navi.mjs";

// Explicitly bounded to the runner roles; native specialists stay native.
const ROLE_BODY_ROLES = Object.freeze(["steamroller", "piledriver", "bulldozer", "instinct", "navi"]);
// Zen is not runner-supervised: ntg-vnext invokes it natively, outside the
// supervisor's role packets. It is listed here because its exact slug resolves
// from the same frozen policy table and its body loads through the same loader.
// invoke() and composeBoundedPrompt() still reject every role outside
// ROLE_BODY_ROLES, so this grants no runner or delegation authority.
const NATIVE_ROLE_BODY_ROLES = Object.freeze(["zen"]);
const MODEL_RESOLUTION_ROLES = Object.freeze([...ROLE_BODY_ROLES, ...NATIVE_ROLE_BODY_ROLES]);
const RUNNER_DIR = dirname(fileURLToPath(import.meta.url));

/** Leading AGY frontmatter block of a role file (its metadata, not prompt text). */
const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/;

/**
 * Role policy table mapping agent roles to target model families and reasoning effort requirements.
 * Used for runtime resolution against the installed AGY surface (`agy models`).
 */
export const ROLE_POLICY_TABLE = Object.freeze({
  navi: Object.freeze({
    role: "navi",
    family: "Gemini 4 Argon",
    effort: "Medium",
  }),
  piledriver: Object.freeze({
    role: "piledriver",
    family: "Gemini 4 Argon",
    effort: "High",
  }),
  zen: Object.freeze({
    role: "zen",
    family: "Gemini 4 Argon",
    effort: "High",
  }),
  bulldozer: Object.freeze({
    role: "bulldozer",
    family: "Gemini 3.8 Flash",
    effort: "High",
  }),
  steamroller: Object.freeze({
    role: "steamroller",
    family: "Gemini 4 Argon",
    effort: "Medium",
  }),
  instinct: Object.freeze({
    role: "instinct",
    family: "Claude Sonnet 5.5",
    effort: "High",
    // Opus is used only when the caller explicitly escalates; never by default.
    escalated: Object.freeze({
      family: "Claude Opus 5.5",
      effort: "High",
    }),
  }),
});

/**
 * @deprecated Hard-coded slug lookup table is removed as the primary lookup.
 * Model slugs are resolved at runtime against installed AGY surface via ROLE_POLICY_TABLE.
 */
export const ROLE_MODEL_TABLE = Object.freeze({});

export class UnresolvedModelSlugError extends Error {
  constructor(role, message, details = {}) {
    super(message || `Unresolved model slug for role: ${role}`);
    this.name = "UnresolvedModelSlugError";
    this.ok = false;
    this.error = "UNRESOLVED_MODEL_SLUG";
    this.role = role;
    if (details && typeof details === "object") {
      Object.assign(this, details);
    }
  }
}

export class InvalidHandoffPacketError extends Error {
  constructor(message, details = {}) {
    super(message || "Invalid handoff packet");
    this.name = "InvalidHandoffPacketError";
    this.ok = false;
    this.error = "INVALID_HANDOFF_PACKET";
    if (details && typeof details === "object") {
      Object.assign(this, details);
    }
  }
}

export class InvalidResponseFormatError extends Error {
  constructor(role, error = "INVALID_RESPONSE_FORMAT") {
    super(`${role} invocation failed: ${error}`);
    this.name = "InvalidResponseFormatError";
    this.ok = false;
    this.error = error;
    this.role = role;
  }
}

export class RoleBodyError extends Error {
  constructor(role, error, message) {
    super(message);
    this.name = "RoleBodyError";
    this.ok = false;
    this.error = error;
    this.role = role;
  }
}

/**
 * Reads and validates one shipped role file as Markdown, without interpreting
 * AGY frontmatter. Directory precedence: roleBodyDir, opts.env.NTG_ROLE_BODY_DIR,
 * process env, then ../agents relative to this module. Relative overrides also
 * use RUNNER_DIR, never the invocation cwd. Missing/invalid files never fall
 * back to defaults.
 */
function readRoleBody(role, opts = {}) {
  try {
    const directory = opts.roleBodyDir ?? opts.env?.NTG_ROLE_BODY_DIR ??
      process.env.NTG_ROLE_BODY_DIR ?? "../agents";
    if (typeof directory !== "string" || !directory.trim()) {
      throw new Error("Role body directory must be a non-empty path string");
    }
    const path = resolve(RUNNER_DIR, directory, `${role}.md`);
    const body = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
    if (!body.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) {
      throw new Error("Role body must contain non-empty UTF-8 Markdown without non-text control characters");
    }
    return body.trim();
  } catch (err) {
    throw new RoleBodyError(
      role,
      err.code === "ENOENT" ? "ROLE_BODY_MISSING" : "ROLE_BODY_INVALID",
      `Cannot load role body for "${role}": ${err.message}`
    );
  }
}

function normalizedRole(role) {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

function loadRoleBody(role, opts) {
  const normalized = normalizedRole(role);
  if (!ROLE_BODY_ROLES.includes(normalized)) {
    throw new UnresolvedModelSlugError(role, `Unknown runner role: "${role}".`);
  }
  return readRoleBody(normalized, opts);
}

/**
 * Loads a natively invoked role body (Zen) for a prompt the runner does not
 * compose. The AGY frontmatter block is stripped: the body is prepended to a
 * native invocation, not a runner packet, and frontmatter keys are not prompt
 * text. Directory precedence and fail-closed validation match loadRoleBody.
 *
 * @param {string} role - Native role name (currently only "zen")
 * @param {object} [opts] - roleBodyDir / env options (see readRoleBody)
 * @returns {string} Role body without frontmatter
 */
export function loadNativeRoleBody(role, opts = {}) {
  const normalized = normalizedRole(role);
  if (!NATIVE_ROLE_BODY_ROLES.includes(normalized)) {
    throw new UnresolvedModelSlugError(role, `Unknown native role: "${role}".`);
  }
  return readRoleBody(normalized, opts).replace(FRONTMATTER_BLOCK, "").trim();
}

/**
 * Parses raw stdout from `agy models` into an array of model entries.
 *
 * @param {string} stdout
 * @returns {Array<{ slug: string, description: string }>}
 */
export function parseInstalledModels(stdout) {
  if (typeof stdout !== "string") {
    return [];
  }
  const lines = stdout.split(/\r?\n/);
  const models = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^fetching\b/i.test(trimmed)) continue;
    // Slugs contain no whitespace. First non-whitespace sequence is the slug; the remainder is the description.
    const match = trimmed.match(/^(\S+)(?:\s+(.*))?$/);
    if (match) {
      models.push({
        slug: match[1],
        description: (match[2] || "").trim(),
      });
    }
  }
  return models;
}

/**
 * Discovers installed models by querying `agy models` at runtime.
 *
 * @param {object} [opts]
 * @param {string} [opts.agyPath] - Path to agy executable (defaults to AGY_PATH env or "agy")
 * @param {number} [opts.timeout=15000] - Discovery timeout in ms
 * @param {object} [opts.env] - Additional environment variables
 * @param {string} [opts.cwd] - Working directory
 * @returns {Array<{ slug: string, description: string }>}
 */
export function listInstalledModels(opts = {}) {
  const agyPath = opts.agyPath || process.env.AGY_PATH || "agy";
  const timeout = typeof opts.timeout === "number" ? opts.timeout : 15000;

  const result = spawnSync(agyPath, ["models"], {
    timeout,
    env: { ...process.env, ...(opts.env || {}) },
    cwd: opts.cwd || process.cwd(),
    encoding: "utf-8",
    maxBuffer: 5 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Failed to list installed models: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Failed to list installed models (exit code ${result.status}): ${result.stderr || ""}`
    );
  }

  return parseInstalledModels(result.stdout || "");
}

/**
 * Evaluates whether a candidate model entry satisfies a role policy specification.
 *
 * @param {object} policy - Role policy from ROLE_POLICY_TABLE
 * @param {string|{ slug: string, description?: string }} model
 * @returns {boolean}
 */
export function matchesPolicy(policy, model) {
  if (!policy || !model) return false;

  const slug = (typeof model === "string" ? model : model.slug || "").trim().toLowerCase();
  const desc = (typeof model === "object" && model && model.description ? model.description : "").trim().toLowerCase();

  const familySlug = policy.family.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
  // Slugs may render version dots as dashes ("Claude Sonnet 5.5" -> claude-sonnet-5-5).
  const familySlugDashed = familySlug.replace(/\./g, "-");
  const familyText = policy.family.toLowerCase();
  const effort = policy.effort.toLowerCase();

  // Match whole family tokens only, so "5.5"/"5-5" never matches a different
  // version such as "5.50"/"5-50" (fail closed when the requested family is absent).
  const hasToken = (hay, needle) => {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9.])${escaped}(?=$|[^a-z0-9.])`).test(hay);
  };
  const familyMatch = hasToken(slug, familySlug) || hasToken(slug, familySlugDashed)
    || (desc.length > 0 && hasToken(desc, familyText));
  if (!familyMatch) return false;

  const effortMatch =
    slug.endsWith(`-${effort}`) ||
    slug.includes(`-${effort}-`) ||
    (desc.length > 0 &&
      (desc.includes(`(${effort})`) || desc.includes(` ${effort} `) || desc.endsWith(` ${effort}`)));

  return effortMatch;
}

/**
 * Resolves a role name to its exact AGY model slug against the installed AGY surface.
 * Case-insensitive. Throws structured UnresolvedModelSlugError if 0 matches, ambiguous matches,
 * or unknown role. No silent fallback.
 *
 * @param {string} role - Role name (e.g. 'piledriver', 'bulldozer', 'steamroller')
 * @param {object} [opts] - Resolution options
 * @param {Array<string|object>} [opts.installedModels] - Optional pre-fetched/cached model surface for deterministic testing
 * @param {string} [opts.agyPath] - Path to agy executable
 * @returns {string} Exact model slug
 */
export function resolveSlug(role, opts = {}) {
  const normalized = normalizedRole(role);
  const basePolicy = ROLE_POLICY_TABLE[normalized];
  if (!MODEL_RESOLUTION_ROLES.includes(normalized)) {
    throw new UnresolvedModelSlugError(
      role,
      `Unknown role: "${role}". No role policy defined.`
    );
  }
  // Escalation is explicit and role-scoped: only a policy defining an escalated
  // family (instinct) changes target models, and only on an explicit request.
  const policy = basePolicy?.escalated && opts?.escalate
    ? Object.freeze({
      ...basePolicy,
      family: basePolicy.escalated.family,
      effort: basePolicy.escalated.effort,
    })
    : basePolicy;

  let installed = opts.installedModels;
  if (!installed) {
    try {
      installed = listInstalledModels(opts);
    } catch (err) {
      throw new UnresolvedModelSlugError(
        role,
        `Failed to discover installed models for role "${role}": ${err.message}`,
        { cause: err }
      );
    }
  }

  if (!Array.isArray(installed)) {
    installed = [installed];
  }

  const matches = installed.filter((m) => matchesPolicy(policy, m));
  if (matches.length === 0) {
    throw new UnresolvedModelSlugError(
      role,
      `No installed model found matching policy for role "${role}" (family: "${policy.family}", effort: "${policy.effort}").`,
      { reason: "NOT_FOUND" }
    );
  }

  if (matches.length > 1) {
    const candidateSlugs = matches.map((m) => (typeof m === "string" ? m : m.slug));
    throw new UnresolvedModelSlugError(
      role,
      `Ambiguous model slug resolution for role "${role}": multiple matching models found: ${candidateSlugs.join(", ")}`,
      { reason: "AMBIGUOUS", matches: candidateSlugs }
    );
  }

  const resolved = matches[0];
  return typeof resolved === "string" ? resolved : resolved.slug;
}

/**
 * Composes a deterministic bounded prompt from the role body and handoff packet.
 * Enforces packet contract and strictly forbids raw conversational state.
 *
 * @param {string} role - Role name
 * @param {object} packet - Structured handoff packet
 * @param {object} [opts] - roleBodyDir / env options (see loadRoleBody)
 * @returns {string} Deterministically formatted bounded prompt
 */
export function composeBoundedPrompt(role, packet, opts = {}) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    throw new InvalidHandoffPacketError("Handoff packet must be a non-null object");
  }

  const FORBIDDEN_KEYS = ["messages", "conversation", "history", "transcript"];
  for (const forbidden of FORBIDDEN_KEYS) {
    if (forbidden in packet && packet[forbidden] !== undefined) {
      throw new InvalidHandoffPacketError(
        `Forbidden conversational state field in handoff packet: "${forbidden}". Raw conversational state is prohibited.`
      );
    }
  }

  const roleName = typeof role === "string" ? role.trim() : String(role || "");
  const task =
    typeof packet.task === "string"
      ? packet.task.trim()
      : typeof packet.objective === "string"
      ? packet.objective.trim()
      : "";
  if (!task) {
    throw new InvalidHandoffPacketError(
      "Handoff packet requires a non-empty 'task' or 'objective' string"
    );
  }

  const sections = [];

  if (roleName) {
    sections.push(`## Role\n${roleName}`);
  }

  sections.push(`## Role Body\n${loadRoleBody(role, opts)}`);
  sections.push(`## Task\n${task}`);

  const contextFiles = packet.contextFiles ?? packet.context_files;
  if (contextFiles) {
    if (Array.isArray(contextFiles) && contextFiles.length > 0) {
      sections.push(`## Context Files\n${contextFiles.map((f) => `- ${f}`).join("\n")}`);
    } else if (typeof contextFiles === "string" && contextFiles.trim()) {
      sections.push(`## Context Files\n${contextFiles.trim()}`);
    }
  }

  const evidence = packet.evidence;
  if (evidence) {
    if (Array.isArray(evidence) && evidence.length > 0) {
      sections.push(`## Evidence\n${evidence.map((e) => `- ${e}`).join("\n")}`);
    } else if (typeof evidence === "string" && evidence.trim()) {
      sections.push(`## Evidence\n${evidence.trim()}`);
    } else if (typeof evidence === "object" && Object.keys(evidence).length > 0) {
      sections.push(`## Evidence\n${JSON.stringify(evidence, null, 2)}`);
    }
  }

  const constraints = packet.constraints;
  if (constraints) {
    if (Array.isArray(constraints) && constraints.length > 0) {
      sections.push(`## Constraints\n${constraints.map((c) => `- ${c}`).join("\n")}`);
    } else if (typeof constraints === "string" && constraints.trim()) {
      sections.push(`## Constraints\n${constraints.trim()}`);
    }
  }

  const expectedOutput = packet.expectedOutput ?? packet.expected_output;
  if (expectedOutput) {
    if (Array.isArray(expectedOutput) && expectedOutput.length > 0) {
      sections.push(`## Expected Output\n${expectedOutput.map((o) => `- ${o}`).join("\n")}`);
    } else if (typeof expectedOutput === "string" && expectedOutput.trim()) {
      sections.push(`## Expected Output\n${expectedOutput.trim()}`);
    }
  }

  return sections.join("\n\n");
}

/**
 * Validates and parses the JSON response envelope from an AGY execution.
 * Only SUCCESS with valid string response and no explicit tool denials succeeds.
 * Denials return TOOL_PERMISSION_DENIED; other invalid envelopes return
 * structured INVALID_OUTPUT or MODEL_ERROR failure.
 *
 * @param {string} stdout - Raw stdout from agy
 * @param {object} [meta] - Context metadata (role, slug)
 * @returns {object} Structured result
 */
export function parseResponseEnvelope(stdout, meta = {}) {
  const role = meta.role;
  const slug = meta.slug;

  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (parseErr) {
    return {
      ok: false,
      error: "INVALID_OUTPUT",
      ...(role ? { role } : {}),
      ...(slug ? { slug } : {}),
      message: `Failed to parse JSON response: ${parseErr.message}`,
      raw: stdout,
      usage: undefined,
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: "INVALID_OUTPUT",
      ...(role ? { role } : {}),
      ...(slug ? { slug } : {}),
      message: "JSON response is not a valid object envelope",
      raw: parsed,
      usage: undefined,
    };
  }

  const usage = parsed.usage !== null && typeof parsed.usage === "object" ? parsed.usage : undefined;

  if (parsed.status === "ERROR") {
    return {
      ok: false,
      error: "MODEL_ERROR",
      ...(role ? { role } : {}),
      ...(slug ? { slug } : {}),
      usage,
      details: parsed,
    };
  }

  if (parsed.status === "SUCCESS") {
    if (Array.isArray(parsed.denied_actions) && parsed.denied_actions.length > 0) {
      return {
        ok: false,
        error: "TOOL_PERMISSION_DENIED",
        ...(role ? { role } : {}),
        ...(slug ? { slug } : {}),
        denied_actions: parsed.denied_actions,
        usage,
        details: parsed,
      };
    }

    if (typeof parsed.response !== "string") {
      return {
        ok: false,
        error: "INVALID_OUTPUT",
        ...(role ? { role } : {}),
        ...(slug ? { slug } : {}),
        message: "Missing or invalid 'response' field in SUCCESS envelope",
        usage,
        details: parsed,
      };
    }

    return {
      ok: true,
      ...(role ? { role } : {}),
      ...(slug ? { slug } : {}),
      response: parsed.response,
      duration: parsed.duration_seconds,
      usage,
      raw: parsed,
    };
  }

  return {
    ok: false,
    error: "INVALID_OUTPUT",
    ...(role ? { role } : {}),
    ...(slug ? { slug } : {}),
    message: `Unexpected response status: "${parsed.status}"`,
    usage,
    details: parsed,
  };
}

/**
 * Validates the inner response when a caller requires a JSON object packet.
 * Generic text responses remain supported by the envelope/transport boundary.
 * Only narration/fences around one object may be removed, plus the trailing
 * packet behind an AGY subagent relay preamble. Role-specific schema and
 * authority checks remain at the spine/ledger boundary, after extraction.
 * response and raw are never rewritten: they retain the original provenance.
 */
export function parseResponsePacket(result) {
  if (!result.ok) return result;
  if (!result.response.trim()) return { ...result, ok: false, error: "EMPTY_RESPONSE" };
  let packet;
  let relayPreambleStripped = false;
  try {
    packet = JSON.parse(result.response);
  } catch {
    packet = extractNarratedObject(result.response);
    if (packet === undefined) {
      packet = extractRelayTailObject(result.response);
      if (packet === undefined) {
        return { ...result, ok: false, error: "INVALID_RESPONSE_FORMAT" };
      }
      relayPreambleStripped = true;
    }
  }
  if (packet === null || typeof packet !== "object" || Array.isArray(packet)) {
    return { ...result, ok: false, error: "INVALID_RESPONSE_FORMAT" };
  }
  return {
    ...result,
    packet,
    ...(relayPreambleStripped ? { relayPreambleStripped: true } : {}),
  };
}

/** One object surrounded by narration/fences, or undefined when ambiguous. */
function extractNarratedObject(response) {
  const start = response.indexOf("{");
  const end = response.lastIndexOf("}");
  if (start === -1 || end < start) return undefined;
  // Do not search for a parsable subset or choose between successive packets.
  // Parsing first-to-last braces rejects multiple objects and malformed outer
  // objects, while JSON.parse handles nested objects and escaped string braces.
  const surrounding = response.slice(0, start) + "\n" + response.slice(end + 1);
  const narration = surrounding.replace(/^[ \t]*```(?:json)?[ \t]*$/gim, "");
  // Arrays, quoted JSON, unmatched delimiters and extra JSON scalar values
  // outside the candidate are not narration. Ambiguity must fail closed.
  if (/[{}\[\]"`]/.test(narration)
      || /(?:^|\s)(?:null|true|false|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s|$)/.test(narration)) {
    return undefined;
  }
  try {
    return JSON.parse(response.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** AGY relay header, e.g. "Subagent `<uuid>` has sent the following message:". */
const SUBAGENT_RELAY_MARKER = /^Subagent `[0-9a-fA-F-]{8,}` has sent the following message:\s*$/m;

/**
 * The trailing packet behind a relayed subagent message, or undefined.
 * Only consulted after the two strict paths failed and only when the relay
 * marker is present, so ordinary narration gains no slack. Everything before
 * the trailing object is preamble and is discarded; response and raw keep the
 * original provenance for the caller.
 */
function extractRelayTailObject(response) {
  if (!SUBAGENT_RELAY_MARKER.test(response)) return undefined;
  // The packet must be the tail: at most one closing fence may follow it.
  let text = response.trim();
  if (text.endsWith("```")) text = text.slice(0, -3).trimEnd();
  if (!text.endsWith("}")) return undefined;
  // Candidates open a line (optionally after opening fences (``` or ~~~) or relay
  // headers). Scan first to last, and accept only a slice that parses to one
  // plain object through the final brace; ambiguous tails keep the strict failure.
  // Anchor on \n only: a /m ^ also matches after U+2028/U+2029, which JSON
  // strings may contain raw, so a candidate could sit inside an open string.
  for (const match of text.matchAll(/(?:^|\n)[ \t]*\{/g)) {
    const start = match.index + match[0].length - 1;
    // A candidate nested inside an unfinished outer value ("[\n{...}",
    // "{\"k\":\n{...}", "[\"]\",\n{...}") is not a tail packet. In JSON a nested
    // value can follow only '[', ',' or ':' (plus whitespace), so a candidate
    // after one of those, or after '{', is skipped. This is a local token rule:
    // it needs no bracket or quote tracking in the free-form preamble.
    if (mayContinueJsonValue(text.slice(0, start))) continue;
    let value;
    try {
      value = JSON.parse(text.slice(start));
    } catch {
      continue;
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return undefined;
}

/**
 * True when a value starting right after `before` could be a nested element
 * of an unfinished JSON container: the last non-whitespace character is one
 * of [ , : {. Opening fences (``` or ~~~) and relay headers directly before
 * the candidate are looked through, so fences or headers cannot hide such a
 * character.
 */
function mayContinueJsonValue(before) {
  // Look through trailing whitespace (\s covers \r, NBSP, BOM and line
  // separators), fence lines with any info string, and relay header lines.
  // The last character is checked before every strip (except a header's own
  // prose ':'), and every logical line inside a stripped fence segment is
  // checked too, so stripping can never hide a preceding '[', ',', ':' or '{'.
  // A fence may start after \n, \r, U+2028 or U+2029; its tail runs to the end
  // like #158's, so this strips at least what #158 stripped and checks more.
  const fenceLine = /(?:^|[\n\r\u2028\u2029])[^\S\n\r\u2028\u2029]*(?:```|~~~)[^\n]*$/u;
  // Headers keep the #158 boundary (LF line start only): exempting a header's
  // ':' after CR/U+2028/U+2029 would accept inputs #158 rejected.
  const headerLine = /(?:^|\n)[^\S\n]*Subagent `[0-9a-fA-F-]{8,}` has sent the following message:$/u;
  const continues = text => /[[,:{]$/u.test(text.trimEnd());
  let rest = before.trimEnd();
  for (;;) {
    const isHeader = headerLine.test(rest);
    if (!isHeader && continues(rest)) return true;
    if (isHeader) {
      rest = rest.replace(headerLine, "").trimEnd();
      continue;
    }
    const fence = rest.match(fenceLine);
    if (!fence) return false;
    if (fence[0].split(/[\n\r\u2028\u2029]/u).some(continues)) return true;
    rest = rest.slice(0, fence.index).trimEnd();
  }
}

/**
 * Low-level transport helper that executes the `agy` process directly with raw prompt,
 * handling timeout, recursion protection, and envelope parsing.
 *
 * Supports both signatures:
 * - invokeTransport({ slug, prompt, ...opts })
 * - invokeTransport(slug, prompt, opts)
 *
 * @param {string|object} slugOrOpts
 * @param {string} [maybePrompt]
 * @param {object} [maybeOpts]
 * @returns {object} Structured result
 */
export function invokeTransport(slugOrOpts, maybePrompt, maybeOpts) {
  const startTime = Date.now();
  let slug;
  let prompt;
  let opts;

  if (typeof slugOrOpts === "object" && slugOrOpts !== null) {
    opts = slugOrOpts;
    slug = opts.slug;
    prompt = opts.prompt;
  } else {
    slug = slugOrOpts;
    prompt = maybePrompt;
    opts = maybeOpts || {};
  }

  const request = { ...opts, slug, prompt };
  let result;
  if (typeof opts.role !== "string" || opts.role.trim().toLowerCase() !== "navi") {
    result = invokeAgyTransport(request);
  } else {
    try {
      result = withNaviHome(request, (env, prefix) => invokeAgyTransport({ ...request, env }, prefix));
    } catch (error) {
      result = {
        ok: false, error: "NAVI_SETUP_ERROR", role: "navi",
        code: error.code || "NAVI_SETUP_FAILED",
        ...(error.variable ? { variable: error.variable } : {}),
        usage: undefined,
      };
    }
  }

  const duration_ms = Math.max(0, Date.now() - startTime);
  if (result.code === "NAVI_TIMEOUT" || result.code === "NAVI_EXECUTION_FAILED") {
    return result;
  }
  return {
    ...result,
    duration_ms,
    usage: result.usage,
  };
}

function invokeAgyTransport(opts, prefix = []) {
  const { slug, prompt } = opts;
  const role = opts.role;
  const timeout = typeof opts.timeout === "number" ? opts.timeout : 90000;
  const outputFormat = opts.outputFormat || "json";
  const agyPath = opts.agyPath || process.env.AGY_PATH || "agy";

  // Recursion protection
  const chainRaw = process.env.NTG_RUNNER_CHAIN;
  if (role && chainRaw) {
    const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : String(role);
    const parts = chainRaw.split(":").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (parts.includes(normalizedRole)) {
      return {
        ok: false,
        error: "RECURSION_DETECTED",
        role,
        chain: chainRaw,
      };
    }
  }

  const nextChain = role ? (chainRaw ? `${chainRaw}:${role}` : role) : chainRaw;
  const childEnv = {
    ...process.env,
    ...(opts.env || {}),
    ...(nextChain ? { NTG_RUNNER_CHAIN: nextChain } : {}),
  };

  // Exact-model roles use their composed body. Navi's MCP registration lives
  // only in its per-process HOME; no native --agent selection is needed.
  const args = [
    "--model",
    slug,
    "--output-format",
    outputFormat,
  ];

  // Permission grant: owner decision 2026-10-07 — bulldozer may inspect
  // known execution context via tools (incl. RunCommand); discovery still
  // delegated. Navi's scoped MCP calls use its own confirmation contract.
  // Must precede --print: agy consumes the token after --print as the prompt.
  const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (normalizedRole === "navi") {
    args.push("--dangerously-skip-permissions");
  }
  if (normalizedRole === "bulldozer") {
    args.push("--dangerously-skip-permissions");
  }
  args.push("--print", prompt);

  // Linux caps a single argv element at MAX_ARG_STRLEN (128 KiB); oversize
  // prompts would otherwise surface as an E2BIG SPAWN_ERROR that looks like
  // a broken agy install. Fail with a typed error before spawning (Refs #91).
  const promptBytes = Buffer.byteLength(typeof prompt === "string" ? prompt : String(prompt), "utf8");
  const MAX_ARG_STRLEN = 128 * 1024;
  if (promptBytes > MAX_ARG_STRLEN) {
    return {
      ok: false,
      error: "PROMPT_TOO_LARGE",
      ...(role ? { role } : {}),
      slug,
      promptBytes,
      limit: MAX_ARG_STRLEN,
    };
  }

  let result;
  try {
    result = spawnSync(prefix.length ? "bwrap" : agyPath, prefix.length ? [...prefix, agyPath, ...args] : args, {
      timeout,
      killSignal: "SIGKILL",
      detached: process.platform !== "win32",
      env: childEnv,
      cwd: opts.cwd || process.cwd(),
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err) {
    return {
      ok: false,
      error: "SPAWN_ERROR",
      ...(role ? { role } : {}),
      slug,
      message: err.message,
    };
  }

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      // POSIX detached children lead their own group; kill remaining descendants.
      if (process.platform !== "win32" && result.pid) {
        try {
          process.kill(-result.pid, "SIGKILL");
        } catch (err) {
          if (err.code !== "ESRCH") throw err;
        }
      }
      if (normalizedRole === "navi") {
        // Navi's private root holds the MCP registration and credential path,
        // so its raw streams never leave the runner (Refs #156 gate review).
        return {
          ok: false,
          error: "TIMEOUT",
          code: "NAVI_TIMEOUT",
          exitStatus: result.status ?? null,
        };
      }
      const stderr = (result.stderr || "").toString();
      const bgMatch = stderr.split(/\r?\n|\r/).find((l) => /waiting up to \S+ for \d+ background task\(s\)/.test(l));
      if (bgMatch !== undefined) {
        const line = bgMatch.replace(/[\r\n]+$/, "");
        return {
          ok: false,
          error: "BACKGROUND_TASK_PENDING",
          ...(role ? { role } : {}),
          slug,
          timeout,
          stderr,
          line,
          message: line,
        };
      }
      return {
        ok: false,
        error: "TIMEOUT",
        ...(role ? { role } : {}),
        slug,
        timeout,
        stderr,
      };
    }
    return {
      ok: false,
      error: "SPAWN_ERROR",
      ...(role ? { role } : {}),
      slug,
      message: result.error.message,
    };
  }

  if (result.status !== 0) {
    if (normalizedRole === "navi") {
      // Fixed taxonomy only; raw stderr may carry the private config root,
      // credential paths or provider tokens (Refs #156 gate review).
      return {
        ok: false,
        error: "EXECUTION_FAILED",
        code: "NAVI_EXECUTION_FAILED",
        exitStatus: result.status,
      };
    }
    let usage = undefined;
    const stdout = (result.stdout || "").toString();
    if (stdout.trim()) {
      try {
        const parsed = JSON.parse(stdout.trim());
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.usage !== null && typeof parsed.usage === "object") {
          usage = parsed.usage;
        }
      } catch {}
    }
    return {
      ok: false,
      error: "EXECUTION_FAILED",
      ...(role ? { role } : {}),
      slug,
      exitCode: result.status,
      stderr: (result.stderr || "").toString(),
      usage,
    };
  }

  const stdout = (result.stdout || "").toString();

  if (outputFormat === "json") {
    return parseResponseEnvelope(stdout, { role, slug });
  }

  return {
    ok: true,
    ...(role ? { role } : {}),
    slug,
    response: stdout,
  };
}

/**
 * Contract-level runner that validates and resolves slug via role policy,
 * validates the handoff packet, loads the role body, composes a bounded prompt,
 * and executes via invokeTransport.
 *
 * @param {string} role - Target role (e.g. 'piledriver', 'bulldozer', 'steamroller')
 * @param {object} packet - Structured handoff packet ({ task, ... })
 * @param {object} [opts] - Invocation options, including roleBodyDir / env overrides
 * @returns {object} Structured result
 */
export function invoke(role, packet, opts = {}) {
  const startTime = Date.now();
  const options = opts || {};
  if (options.outputFormat && options.outputFormat !== "json") {
    return {
      ok: false,
      error: "INVALID_OUTPUT_FORMAT",
      role,
      message:
        "invoke() requires JSON output format; envelope validation cannot be bypassed. Use invokeTransport() if text format is needed.",
      duration_ms: Math.max(0, Date.now() - startTime),
      usage: undefined,
    };
  }

  // Recursion protection early check
  const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : String(role);
  const chainRaw = process.env.NTG_RUNNER_CHAIN;
  if (chainRaw) {
    const parts = chainRaw.split(":").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (parts.includes(normalizedRole)) {
      return {
        ok: false,
        error: "RECURSION_DETECTED",
        role,
        chain: chainRaw,
        duration_ms: Math.max(0, Date.now() - startTime),
        usage: undefined,
      };
    }
  }

  // Slug resolution
  let slug;
  try {
    slug = resolveSlug(role, options);
  } catch (err) {
    return {
      ok: false,
      error: err.error || "UNRESOLVED_MODEL_SLUG",
      role,
      message: err.message,
      ...(err.matches ? { matches: err.matches } : {}),
      duration_ms: Math.max(0, Date.now() - startTime),
      usage: undefined,
    };
  }

  // Packet validation & bounded prompt composition
  let prompt;
  try {
    prompt = composeBoundedPrompt(role, packet, options);
  } catch (err) {
    return {
      ok: false,
      error: err.error || "INVALID_HANDOFF_PACKET",
      role,
      message: err.message,
      duration_ms: Math.max(0, Date.now() - startTime),
      usage: undefined,
    };
  }

  // One wall-clock budget (the original timeout) is shared by all attempts.
  const totalTimeout = typeof options.timeout === "number" ? options.timeout : 90000;
  const deadline = Date.now() + totalTimeout;
  const run = () => invokeTransport({
    ...options,
    timeout: Math.max(1, deadline - Date.now()),
    slug,
    prompt,
    role,
    outputFormat: "json",
  });

  let attempt = run();
  let attempts = 1;

  // Retry boundedly only when SUCCESS has an empty response and no explicit
  // denied_actions. Explicit tool denials are classified by parseResponseEnvelope.
  // Bulldozer and Navi are never retried: either may have caused effects
  // before returning empty, so replay could duplicate those effects.
  const MAX_EMPTY_RETRIES = 3;
  const retryable = normalizedRole !== "bulldozer" && normalizedRole !== "navi";
  while (retryable && attempts <= MAX_EMPTY_RETRIES && Date.now() < deadline
    && attempt.ok && (attempt.response || "").trim() === "") {
    attempt = run();
    attempts++;
  }
  const totalDurationMs = Math.max(0, Date.now() - startTime);
  if (attempt.ok && (attempt.response || "").trim() === "") {
    return {
      ok: false,
      error: "EMPTY_RESPONSE",
      role,
      slug,
      attempts,
      duration_ms: totalDurationMs,
      usage: attempt.usage,
    };
  }
  return {
    ...attempt,
    attempts,
    duration_ms: totalDurationMs,
    usage: attempt.usage,
  };
}

// CLI execution support
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , role, ...promptParts] = process.argv;
  if (!role || promptParts.length === 0) {
    console.error("Usage: node scripts/runner.mjs <role> <prompt>");
    process.exit(1);
  }

  const prompt = promptParts.join(" ");
  const res = invoke(role, { task: prompt });
  if (res.ok) {
    if (typeof res.response === "string") {
      process.stdout.write(res.response);
    } else {
      console.log(JSON.stringify(res, null, 2));
    }
    process.exitCode = 0;
  } else {
    console.error(JSON.stringify(res, null, 2));
    process.exitCode = 1;
  }
}
