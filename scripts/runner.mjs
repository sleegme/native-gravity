import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

// Explicitly bounded to the three runner roles; native specialists stay native.
const ROLE_BODY_ROLES = Object.freeze(["steamroller", "piledriver", "bulldozer"]);
const RUNNER_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Role policy table mapping agent roles to target model families and reasoning effort requirements.
 * Used for runtime resolution against the installed AGY surface (`agy models`).
 */
export const ROLE_POLICY_TABLE = Object.freeze({
  piledriver: Object.freeze({
    role: "piledriver",
    family: "Gemini 3.1 Pro",
    effort: "High",
  }),
  bulldozer: Object.freeze({
    role: "bulldozer",
    family: "Gemini 3.8 Flash",
    effort: "High",
  }),
  steamroller: Object.freeze({
    role: "steamroller",
    family: "Gemini 3.8 Flash",
    effort: "High",
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
 * Loads the role file as Markdown content, without interpreting AGY frontmatter.
 * Directory precedence: roleBodyDir, opts.env.NTG_ROLE_BODY_DIR, process env,
 * then ../agents relative to this module. Relative overrides also use RUNNER_DIR,
 * never the invocation cwd. Missing/invalid files never fall back to defaults.
 */
function loadRoleBody(role, opts) {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (!ROLE_BODY_ROLES.includes(normalized)) {
    throw new UnresolvedModelSlugError(role, `Unknown runner role: "${role}".`);
  }

  try {
    const directory = opts.roleBodyDir ?? opts.env?.NTG_ROLE_BODY_DIR ??
      process.env.NTG_ROLE_BODY_DIR ?? "../agents";
    if (typeof directory !== "string" || !directory.trim()) {
      throw new Error("Role body directory must be a non-empty path string");
    }
    const path = resolve(RUNNER_DIR, directory, `${normalized}.md`);
    const body = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
    if (!body.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) {
      throw new Error("Role body must contain non-empty UTF-8 Markdown without non-text control characters");
    }
    return body.trim();
  } catch (err) {
    throw new RoleBodyError(
      role,
      err.code === "ENOENT" ? "ROLE_BODY_MISSING" : "ROLE_BODY_INVALID",
      `Cannot load role body for "${normalized}": ${err.message}`
    );
  }
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
  const familyText = policy.family.toLowerCase();
  const effort = policy.effort.toLowerCase();

  const familyMatch = slug.includes(familySlug) || (desc.length > 0 && desc.includes(familyText));
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
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
  const policy = ROLE_POLICY_TABLE[normalized];
  if (!ROLE_BODY_ROLES.includes(normalized)) {
    throw new UnresolvedModelSlugError(
      role,
      `Unknown role: "${role}". No role policy defined.`
    );
  }

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
 * Only SUCCESS with valid string response succeeds. Any other status, unparseable JSON,
 * or malformed envelope returns structured INVALID_OUTPUT or MODEL_ERROR failure.
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
    };
  }

  if (parsed.status === "ERROR") {
    return {
      ok: false,
      error: "MODEL_ERROR",
      ...(role ? { role } : {}),
      ...(slug ? { slug } : {}),
      details: parsed,
    };
  }

  if (parsed.status === "SUCCESS") {
    if (typeof parsed.response !== "string") {
      return {
        ok: false,
        error: "INVALID_OUTPUT",
        ...(role ? { role } : {}),
        ...(slug ? { slug } : {}),
        message: "Missing or invalid 'response' field in SUCCESS envelope",
        details: parsed,
      };
    }

    return {
      ok: true,
      ...(role ? { role } : {}),
      ...(slug ? { slug } : {}),
      response: parsed.response,
      duration: parsed.duration_seconds,
      usage: parsed.usage,
      raw: parsed,
    };
  }

  return {
    ok: false,
    error: "INVALID_OUTPUT",
    ...(role ? { role } : {}),
    ...(slug ? { slug } : {}),
    message: `Unexpected response status: "${parsed.status}"`,
    details: parsed,
  };
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

  const args = [
    "--model",
    slug,
    "--output-format",
    outputFormat,
    "--print",
    prompt,
  ];

  let result;
  try {
    result = spawnSync(agyPath, args, {
      timeout,
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
      return {
        ok: false,
        error: "TIMEOUT",
        ...(role ? { role } : {}),
        slug,
        timeout,
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
    return {
      ok: false,
      error: "EXECUTION_FAILED",
      ...(role ? { role } : {}),
      slug,
      exitCode: result.status,
      stderr: (result.stderr || "").toString(),
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
  const options = opts || {};
  if (options.outputFormat && options.outputFormat !== "json") {
    return {
      ok: false,
      error: "INVALID_OUTPUT_FORMAT",
      role,
      message:
        "invoke() requires JSON output format; envelope validation cannot be bypassed. Use invokeTransport() if text format is needed.",
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
    };
  }

  return invokeTransport({
    ...options,
    slug,
    prompt,
    role,
    outputFormat: "json",
  });
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
