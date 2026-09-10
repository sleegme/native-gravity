import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const ROLE_MODEL_TABLE = Object.freeze({
  piledriver: "gemini-3.1-pro-high",
  bulldozer: "gemini-3.8-flash-high",
  steamroller: "gemini-3.8-flash-high",
});

export class UnresolvedModelSlugError extends Error {
  constructor(role, message) {
    super(message || `Unresolved model slug for role: ${role}`);
    this.name = "UnresolvedModelSlugError";
    this.ok = false;
    this.error = "UNRESOLVED_MODEL_SLUG";
    this.role = role;
  }
}

/**
 * Resolves a role name to its exact AGY model slug.
 * Case-insensitive. Throws structured Error if role cannot be resolved.
 * No silent fallback.
 *
 * @param {string} role
 * @returns {string} Model slug
 */
export function resolveSlug(role) {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
  const slug = ROLE_MODEL_TABLE[normalized];
  if (!slug) {
    throw new UnresolvedModelSlugError(role, `Unresolved model slug for role: ${role}`);
  }
  return slug;
}

function getDefaultAgyPath() {
  if (existsSync("/home/sleeg/.local/bin/agy")) {
    return "/home/sleeg/.local/bin/agy";
  }
  return "agy";
}

/**
 * Invokes an agent role with an exact model and reasoning effort.
 *
 * @param {string} role - Role name (e.g. 'piledriver', 'bulldozer', 'steamroller')
 * @param {string} prompt - Prompt string
 * @param {object} [opts] - Invocation options
 * @param {number} [opts.timeout=90000] - Process timeout in milliseconds
 * @param {string} [opts.outputFormat="json"] - Output format ("json" | "text")
 * @param {string} [opts.agyPath] - Path to agy binary
 * @param {object} [opts.env] - Additional environment variables
 * @param {string} [opts.cwd] - Working directory
 * @returns {object} Structured result
 */
export function invoke(role, prompt, opts = {}) {
  const timeout = typeof opts.timeout === "number" ? opts.timeout : 90000;
  const outputFormat = opts.outputFormat || "json";
  const agyPath = opts.agyPath || process.env.AGY_PATH || getDefaultAgyPath();

  // Recursion protection
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
    slug = resolveSlug(role);
  } catch (err) {
    return {
      ok: false,
      error: err.error || "UNRESOLVED_MODEL_SLUG",
      role,
      message: err.message,
    };
  }

  const nextChain = chainRaw ? `${chainRaw}:${role}` : role;
  const childEnv = {
    ...process.env,
    ...(opts.env || {}),
    NTG_RUNNER_CHAIN: nextChain,
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
      role,
      slug,
      message: err.message,
    };
  }

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      return {
        ok: false,
        error: "TIMEOUT",
        role,
        slug,
        timeout: opts.timeout ?? timeout,
      };
    }
    return {
      ok: false,
      error: "SPAWN_ERROR",
      role,
      slug,
      message: result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: "EXECUTION_FAILED",
      role,
      slug,
      exitCode: result.status,
      stderr: (result.stderr || "").toString(),
    };
  }

  const stdout = (result.stdout || "").toString();

  if (outputFormat === "json") {
    let parsed;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch (parseErr) {
      return {
        ok: false,
        error: "EXECUTION_FAILED",
        role,
        slug,
        exitCode: result.status,
        stderr: `Failed to parse JSON response: ${parseErr.message}\nRaw stdout: ${stdout}`,
      };
    }

    if (parsed.status === "ERROR") {
      return {
        ok: false,
        error: "MODEL_ERROR",
        role,
        slug,
        details: parsed,
      };
    }

    if (parsed.status === "SUCCESS") {
      return {
        ok: true,
        role,
        slug,
        response: parsed.response,
        duration: parsed.duration_seconds,
        usage: parsed.usage,
        raw: parsed,
      };
    }

    return {
      ok: true,
      role,
      slug,
      response: parsed.response ?? stdout,
      raw: parsed,
    };
  }

  return {
    ok: true,
    role,
    slug,
    response: stdout,
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
  const res = invoke(role, prompt);
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
