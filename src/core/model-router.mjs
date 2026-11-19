import { spawnSync } from "node:child_process";
import process from "node:process";

/**
 * Models explicitly excluded from default routing (PO_CONFIRMED).
 */
export const EXCLUDED_DEFAULT_MODELS = Object.freeze([
  "gemini-pro-orchestrator-g1-pro",
  "gemini-pro-orchestrator-neon",
]);

/**
 * Canonical NTG v2.1.0 role model policy table (ModelRouter).
 * Capability selection only; never grants or expands role authority.
 */
export const ROLE_POLICY_TABLE = Object.freeze({
  steamroller: Object.freeze({
    role: "steamroller",
    family: "Gemini 4 Neon",
    effort: "Medium",
    provenance: "PO_CONFIRMED",
    priorityCandidates: Object.freeze([
      Object.freeze({ family: "Gemini 4 Neon", effort: "Medium", provenance: "PO_CONFIRMED" }),
      Object.freeze({ family: "Carbon", effort: "Medium", provenance: "PO_CONFIRMED" }),
      Object.freeze({ family: "Gemini 4 Argon", effort: "Medium", provenance: "PO_CONFIRMED" }),
    ]),
    excludedSlugs: EXCLUDED_DEFAULT_MODELS,
  }),
  piledriver: Object.freeze({
    role: "piledriver",
    family: "Gemini 4 Argon",
    effort: "High",
    provenance: "PO_CONFIRMED",
    priorityCandidates: Object.freeze([
      Object.freeze({ family: "Carbon", effort: "High", provenance: "PO_CONFIRMED" }),
      Object.freeze({ family: "Gemini 4 Argon", effort: "High", provenance: "PO_CONFIRMED" }),
    ]),
    excludedSlugs: EXCLUDED_DEFAULT_MODELS,
  }),
  bulldozer: Object.freeze({
    role: "bulldozer",
    family: "Gemini 4 Neon",
    effort: "High",
    provenance: "PO_CONFIRMED",
    escalated: Object.freeze({
      family: "Gemini 4 Neon",
      effort: "XHigh",
      provenance: "PO_CONFIRMED",
    }),
    excludedSlugs: EXCLUDED_DEFAULT_MODELS,
  }),
  "strix-halo": Object.freeze({
    role: "strix-halo",
    family: "Gemini 4 Neon",
    effort: "Medium",
    provenance: "PO_CONFIRMED",
    escalated: Object.freeze({
      family: "Gemini 4 Neon",
      effort: "High",
      provenance: "PO_CONFIRMED",
    }),
    excludedSlugs: EXCLUDED_DEFAULT_MODELS,
  }),
  bobcat: Object.freeze({
    role: "bobcat",
    family: "Gemini 4 Hydrogen",
    effort: "Medium",
    provenance: "PO_CONFIRMED",
  }),
  jaguar: Object.freeze({
    role: "jaguar",
    family: "Gemini 3.8 Flash",
    effort: "Low",
    provenance: "PO_CONFIRMED",
  }),
  puma: Object.freeze({
    role: "puma",
    family: "Gemini 3.8 Flash",
    effort: "Low",
    provenance: "PO_CONFIRMED",
  }),
  zen: Object.freeze({
    role: "zen",
    family: "Claude Sonnet 5.5",
    effort: "High",
    provenance: "PO_CONFIRMED",
    quotaFallback: Object.freeze({
      family: "Gemini 4 Argon",
      effort: "High",
      provenance: "EXISTING_BASELINE_DEFAULT",
    }),
  }),
  instinct: Object.freeze({
    role: "instinct",
    family: "Claude Opus 5.5",
    effort: "Low",
    provenance: "PO_CONFIRMED",
    escalated: Object.freeze({
      family: "Claude Opus 5.5",
      effort: "High",
      provenance: "EXISTING_BASELINE_DEFAULT",
    }),
  }),
  navi: Object.freeze({
    role: "navi",
    family: "Gemini 4 Neon",
    effort: "Medium",
    experimental: true,
    provenance: "PO_CONFIRMED",
    legacyFallback: Object.freeze({
      family: "Gemini 4 Argon",
      effort: "Medium",
      provenance: "EXISTING_BASELINE_DEFAULT",
    }),
    excludedSlugs: EXCLUDED_DEFAULT_MODELS,
  }),
});

/**
 * Immutable per-role authority boundaries, strictly decoupled from model routing.
 * Dynamic capability overrides never alter any field in this table.
 */
export const ROLE_AUTHORITY_TABLE = Object.freeze({
  steamroller: Object.freeze({
    role: "steamroller",
    readOnly: false,
    canMutateProjectFiles: false,
    canRunCommand: false,
    allowedDelegations: Object.freeze([
      "piledriver", "bulldozer", "bobcat", "jaguar", "puma", "strix-halo", "instinct", "zen", "navi",
    ]),
    canInvokeZen: true,
    canWriteLedger: true,
    verificationRequirement: "ORCHESTRATOR",
    harnessTier: "orchestrator",
  }),
  piledriver: Object.freeze({
    role: "piledriver",
    readOnly: true,
    canMutateProjectFiles: false,
    canRunCommand: false,
    allowedDelegations: Object.freeze([]),
    canInvokeZen: false,
    canWriteLedger: false,
    verificationRequirement: "NONE",
    harnessTier: "advisory",
  }),
  bulldozer: Object.freeze({
    role: "bulldozer",
    readOnly: false,
    canMutateProjectFiles: true,
    canRunCommand: true,
    allowedDelegations: Object.freeze(["jaguar", "puma", "bobcat", "strix-halo"]),
    canInvokeZen: false,
    canWriteLedger: false,
    verificationRequirement: "CANDIDATE_FOR_ZEN",
    harnessTier: "coordinator",
  }),
  "strix-halo": Object.freeze({
    role: "strix-halo",
    readOnly: true,
    canMutateProjectFiles: false,
    canRunCommand: false,
    allowedDelegations: Object.freeze([]),
    allowedCallers: Object.freeze(["steamroller", "bulldozer", "bobcat"]),
    canInvokeZen: false,
    canWriteLedger: false,
    verificationRequirement: "HALO_REVIEW_ONLY",
    harnessTier: "reviewer",
  }),
  bobcat: Object.freeze({
    role: "bobcat",
    readOnly: false,
    canMutateProjectFiles: true,
    canRunCommand: true,
    allowedDelegations: Object.freeze(["strix-halo"]),
    canInvokeZen: false,
    canWriteLedger: false,
    verificationRequirement: "LOCAL_PLUS_HALO_WHEN_REQUIRED",
    harnessTier: "standard-worker",
  }),
  jaguar: Object.freeze({
    role: "jaguar",
    readOnly: true,
    canMutateProjectFiles: false,
    canRunCommand: false,
    allowedDelegations: Object.freeze([]),
    canInvokeZen: false,
    canWriteLedger: false,
    verificationRequirement: "FACTUAL_RETRIEVAL_ONLY",
    harnessTier: "lightweight-worker-harness",
  }),
  puma: Object.freeze({
    role: "puma",
    readOnly: false,
    canMutateProjectFiles: true,
    canRunCommand: false,
    allowedDelegations: Object.freeze([]),
    canInvokeZen: false,
    canWriteLedger: false,
    verificationRequirement: "MECHANICAL_EDIT_ONLY",
    harnessTier: "lightweight-worker-harness",
  }),
  zen: Object.freeze({
    role: "zen",
    readOnly: true,
    canMutateProjectFiles: false,
    canRunCommand: true,
    allowedDelegations: Object.freeze([]),
    canInvokeZen: false,
    canWriteLedger: false,
    verificationRequirement: "SUMMATIVE_VERIFIER",
    harnessTier: "summative-gate",
  }),
  instinct: Object.freeze({
    role: "instinct",
    readOnly: true,
    canMutateProjectFiles: false,
    canRunCommand: false,
    allowedDelegations: Object.freeze([]),
    canInvokeZen: false,
    canWriteLedger: false,
    verificationRequirement: "ADVISORY_ONLY",
    harnessTier: "advisory",
  }),
  navi: Object.freeze({
    role: "navi",
    readOnly: true,
    canMutateProjectFiles: false,
    canRunCommand: false,
    allowedDelegations: Object.freeze([]),
    canInvokeZen: false,
    canWriteLedger: false,
    verificationRequirement: "DESKTOP_OBSERVATION_ONLY",
    harnessTier: "desktop-leaf",
  }),
});

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

export class AuthorityExpansionError extends Error {
  constructor(role, message, details = {}) {
    super(message || `Authority expansion prohibited for role: ${role}`);
    this.name = "AuthorityExpansionError";
    this.ok = false;
    this.error = "AUTHORITY_EXPANSION_DENIED";
    this.role = role;
    if (details && typeof details === "object") {
      Object.assign(this, details);
    }
  }
}

/**
 * Normalizes role names cleanly (e.g. "strix_halo" -> "strix-halo", case-insensitive).
 */
export function normalizeRoleName(role) {
  const trimmed = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (trimmed === "strix_halo") return "strix-halo";
  return trimmed;
}

/**
 * Refuses to launch the ambient `agy` binary while running under `node --test`.
 */
export function realAgyRefusalUnderNodeTest(explicitAgyPath) {
  if (!process.env.NODE_TEST_CONTEXT) return null;
  if (process.env.NTG_LIVE_TESTS === "1") return null;
  if (explicitAgyPath || process.env.AGY_PATH) return null;
  return {
    error: "AGY_REFUSED_UNDER_NODE_TEST",
    message:
      "refusing to spawn the ambient agy binary under `node --test` (NODE_TEST_CONTEXT is set): " +
      "live model tests are opt-in — set NTG_LIVE_TESTS=1 or point AGY_PATH at a mock",
  };
}

/**
 * Parses raw stdout from `agy models` into an array of `{ slug, description }`.
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

/** Session-scoped catalog cache keyed by resolved agy executable path (#230). */
const sessionModelCatalogCache = new Map();

/** Clears the session-level `agy models` catalog cache (primarily for tests). */
export function clearModelCatalogCache() {
  sessionModelCatalogCache.clear();
}

/**
 * Discovers installed models by querying `agy models` once per session per agyPath (#230).
 */
export function listInstalledModels(opts = {}) {
  const agyPath = opts.agyPath || process.env.AGY_PATH || "agy";
  const timeout = typeof opts.timeout === "number" ? opts.timeout : 15000;

  const refusal = realAgyRefusalUnderNodeTest(opts.agyPath);
  if (refusal) {
    throw new Error(`Failed to list installed models: ${refusal.message}`);
  }

  const cacheable = !opts.naviSpawn && !opts.noCache && !opts.refreshCache;
  if (cacheable && sessionModelCatalogCache.has(agyPath)) {
    return sessionModelCatalogCache.get(agyPath).map((entry) => ({ ...entry }));
  }

  const result = (opts.naviSpawn || spawnSync)(agyPath, ["models"], {
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
    if (opts.naviSpawn) throw new Error("NAVI_MODEL_DISCOVERY_FAILED");
    throw new Error(
      `Failed to list installed models (exit code ${result.status}): ${result.stderr || ""}`
    );
  }

  const parsed = parseInstalledModels(result.stdout || "");
  if (cacheable) {
    sessionModelCatalogCache.set(
      agyPath,
      Object.freeze(parsed.map((entry) => Object.freeze({ ...entry })))
    );
  }
  return parsed;
}

/**
 * Evaluates whether a candidate model entry satisfies a policy specification.
 */
export function matchesPolicy(policy, model) {
  if (!policy || !model) return false;

  const slug = (typeof model === "string" ? model : model.slug || "").trim().toLowerCase();
  const desc = (typeof model === "object" && model && model.description ? model.description : "").trim().toLowerCase();

  if (Array.isArray(policy.excludedSlugs)) {
    const excluded = policy.excludedSlugs.map((s) => String(s).trim().toLowerCase());
    if (excluded.includes(slug)) {
      return false;
    }
  }

  const familySlug = policy.family.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
  const familySlugDashed = familySlug.replace(/\./g, "-");
  const familyText = policy.family.toLowerCase();
  const effort = policy.effort.toLowerCase();

  const hasToken = (hay, needle) => {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9.])${escaped}(?=$|[^a-z0-9.])`).test(hay);
  };
  const familyMatch =
    hasToken(slug, familySlug) ||
    hasToken(slug, familySlugDashed) ||
    (desc.length > 0 && hasToken(desc, familyText));
  if (!familyMatch) return false;

  const effortMatch =
    slug.endsWith(`-${effort}`) ||
    slug.includes(`-${effort}-`) ||
    (desc.length > 0 &&
      (desc.includes(`(${effort})`) || desc.includes(` ${effort} `) || desc.endsWith(` ${effort}`)));

  return effortMatch;
}

/**
 * Returns the immutable authority descriptor for a role, independent of any selected model.
 */
export function getRoleAuthority(role) {
  const normalized = normalizeRoleName(role);
  const authority = ROLE_AUTHORITY_TABLE[normalized];
  if (!authority) {
    throw new UnresolvedModelSlugError(role, `Unknown role: "${role}". No authority contract defined.`);
  }
  return authority;
}

/**
 * Ensures callers cannot expand tool, mutation, delegation, or verification permissions
 * alongside a dynamic model override.
 */
function assertNoAuthorityExpansion(role, opts = {}) {
  const override = opts.modelOverride;
  const expansionRequested =
    Boolean(opts.expandTools) ||
    Boolean(opts.expandMutation) ||
    Boolean(opts.expandDelegation) ||
    Boolean(opts.bypassVerification) ||
    (override &&
      typeof override === "object" &&
      ("permissions" in override ||
        "tools" in override ||
        "allowedDelegations" in override ||
        "canWriteLedger" in override ||
        "bypassVerification" in override ||
        Boolean(override.expandAuthority)));
  if (expansionRequested) {
    throw new AuthorityExpansionError(
      role,
      `Dynamic model routing for role "${role}" cannot expand tool, mutation, delegation, or verification authority.`
    );
  }
}

/**
 * Validates and resolves a Steamroller dynamic model override fail-closed against `installedModels`.
 */
export function validateDynamicOverride(role, override, installedModels, opts = {}) {
  const normalized = normalizeRoleName(role);
  const basePolicy = ROLE_POLICY_TABLE[normalized];
  if (!basePolicy) {
    throw new UnresolvedModelSlugError(role, `Unknown role: "${role}". No role policy defined.`);
  }
  assertNoAuthorityExpansion(normalized, { ...opts, modelOverride: override });

  const catalog = Array.isArray(installedModels) ? installedModels : [installedModels];
  let matched = [];

  if (typeof override === "string") {
    const targetSlug = override.trim().toLowerCase();
    if (!targetSlug) {
      throw new UnresolvedModelSlugError(role, `Dynamic model override for "${role}" cannot be empty.`, {
        reason: "INVALID_OVERRIDE",
      });
    }
    if (EXCLUDED_DEFAULT_MODELS.includes(targetSlug) && !opts.allowExcluded) {
      throw new UnresolvedModelSlugError(
        role,
        `Model "${override.trim()}" is excluded from default routing for role "${role}".`,
        { reason: "EXCLUDED_MODEL" }
      );
    }
    matched = catalog.filter((m) => {
      const s = (typeof m === "string" ? m : m?.slug || "").trim().toLowerCase();
      return s === targetSlug;
    });
  } else if (override && typeof override === "object" && !Array.isArray(override)) {
    if (typeof override.slug === "string" && override.slug.trim()) {
      const targetSlug = override.slug.trim().toLowerCase();
      if (EXCLUDED_DEFAULT_MODELS.includes(targetSlug) && !opts.allowExcluded) {
        throw new UnresolvedModelSlugError(
          role,
          `Model "${override.slug.trim()}" is excluded from default routing for role "${role}".`,
          { reason: "EXCLUDED_MODEL" }
        );
      }
      matched = catalog.filter((m) => {
        const s = (typeof m === "string" ? m : m?.slug || "").trim().toLowerCase();
        return s === targetSlug;
      });
    } else if (typeof override.family === "string" && typeof override.effort === "string") {
      const overridePolicy = {
        family: override.family,
        effort: override.effort,
        excludedSlugs: opts.allowExcluded ? [] : EXCLUDED_DEFAULT_MODELS,
      };
      matched = catalog.filter((m) => matchesPolicy(overridePolicy, m));
    } else {
      throw new UnresolvedModelSlugError(
        role,
        `Dynamic model override for "${role}" must specify a slug or { family, effort }.`,
        { reason: "INVALID_OVERRIDE" }
      );
    }
  } else {
    throw new UnresolvedModelSlugError(
      role,
      `Dynamic model override for "${role}" must be a slug string or descriptor object.`,
      { reason: "INVALID_OVERRIDE" }
    );
  }

  if (matched.length === 0) {
    throw new UnresolvedModelSlugError(
      role,
      `Dynamic model override for role "${role}" is not available on the installed catalog.`,
      { reason: "NOT_FOUND" }
    );
  }
  if (matched.length > 1) {
    const candidateSlugs = matched.map((m) => (typeof m === "string" ? m : m.slug));
    throw new UnresolvedModelSlugError(
      role,
      `Ambiguous dynamic model override for role "${role}": ${candidateSlugs.join(", ")}`,
      { reason: "AMBIGUOUS", matches: candidateSlugs }
    );
  }

  const chosen = matched[0];
  return typeof chosen === "string" ? chosen : chosen.slug;
}

function getInstalledCatalog(normalized, opts = {}) {
  let installed = opts.installedModels;
  if (!installed) {
    if (typeof opts.discoverModels === "function") {
      installed = opts.discoverModels(opts);
    } else {
      installed = listInstalledModels(opts);
    }
  }
  return Array.isArray(installed) ? installed : [installed];
}

const NAVI_LEGACY_DISABLE_VALUES = new Set(["0", "false", "off", "legacy", "argon"]);

/**
 * Returns true when Navi's experimental Gemini 4 Neon routing is explicitly
 * reverted to its legacy Gemini 4 Argon (Medium) baseline via option or env.
 */
export function isNaviLegacyFallbackRequested(opts = {}) {
  if (opts?.legacyFallback) return true;
  const envSource = opts?.env && typeof opts.env === "object" ? opts.env : process.env;
  const raw = envSource?.NTG_NAVI_EXPERIMENTAL_NEON;
  if (raw === undefined || raw === null) return false;
  return NAVI_LEGACY_DISABLE_VALUES.has(String(raw).trim().toLowerCase());
}

/**
 * Returns the ordered list of installed candidate slugs matching a role's
 * `priorityCandidates` chain (e.g. Steamroller `Neon -> Carbon -> Argon`,
 * Piledriver `Carbon -> Argon`). Used for safe runtime quota failover on
 * non-mutating roles without re-evaluating ambiguous or excluded slugs.
 */
export function resolvePriorityCandidateSlugs(role, opts = {}) {
  const normalized = normalizeRoleName(role);
  const basePolicy = ROLE_POLICY_TABLE[normalized];
  if (!basePolicy || !Array.isArray(basePolicy.priorityCandidates) || basePolicy.priorityCandidates.length === 0) {
    return [];
  }
  if (opts.modelOverride !== undefined && opts.modelOverride !== null) {
    return [];
  }
  const installed = getInstalledCatalog(normalized, opts);
  const slugs = [];
  for (const candidate of basePolicy.priorityCandidates) {
    const candidatePolicy = Object.freeze({
      ...basePolicy,
      family: candidate.family,
      effort: candidate.effort,
      provenance: candidate.provenance ?? basePolicy.provenance,
    });
    const matches = installed.filter((m) => matchesPolicy(candidatePolicy, m));
    if (matches.length === 1) {
      const resolved = matches[0];
      const slug = typeof resolved === "string" ? resolved : resolved.slug;
      if (!slugs.includes(slug)) {
        slugs.push(slug);
      }
    } else if (matches.length > 1) {
      const candidateSlugs = matches.map((m) => (typeof m === "string" ? m : m.slug));
      throw new UnresolvedModelSlugError(
        role,
        `Ambiguous model slug resolution for role "${role}": multiple matching models found: ${candidateSlugs.join(", ")}`,
        { reason: "AMBIGUOUS", matches: candidateSlugs }
      );
    }
  }
  return slugs;
}

/**
 * Resolves a role name to its exact AGY model slug against the installed AGY catalog.
 * Fails closed when absent, ambiguous, excluded, or attempting authority expansion.
 */
export function resolveSlug(role, opts = {}) {
  const normalized = normalizeRoleName(role);
  const basePolicy = ROLE_POLICY_TABLE[normalized];
  if (!basePolicy) {
    throw new UnresolvedModelSlugError(
      role,
      `Unknown role: "${role}". No role policy defined.`
    );
  }

  assertNoAuthorityExpansion(normalized, opts);

  let installed;
  try {
    installed = getInstalledCatalog(normalized, opts);
  } catch (err) {
    throw new UnresolvedModelSlugError(
      role,
      `Failed to discover installed models for role "${role}": ${err.message}`,
      { cause: err }
    );
  }

  if (opts.modelOverride !== undefined && opts.modelOverride !== null) {
    return validateDynamicOverride(normalized, opts.modelOverride, installed, opts);
  }

  const override =
    (opts?.escalate && basePolicy?.escalated) ||
    (opts?.quotaFallback && basePolicy?.quotaFallback) ||
    (normalized === "navi" && isNaviLegacyFallbackRequested(opts) && basePolicy?.legacyFallback);

  if (override) {
    const overridePolicy = Object.freeze({
      ...basePolicy,
      family: override.family,
      effort: override.effort,
      priorityCandidates: undefined,
    });
    return matchSinglePolicy(role, overridePolicy, installed);
  }

  if (Array.isArray(basePolicy.priorityCandidates) && basePolicy.priorityCandidates.length > 0) {
    for (const candidate of basePolicy.priorityCandidates) {
      const candidatePolicy = Object.freeze({
        ...basePolicy,
        family: candidate.family,
        effort: candidate.effort,
        provenance: candidate.provenance ?? basePolicy.provenance,
      });
      const matches = installed.filter((m) => matchesPolicy(candidatePolicy, m));
      if (matches.length === 1) {
        const resolved = matches[0];
        return typeof resolved === "string" ? resolved : resolved.slug;
      }
      if (matches.length > 1) {
        const candidateSlugs = matches.map((m) => (typeof m === "string" ? m : m.slug));
        throw new UnresolvedModelSlugError(
          role,
          `Ambiguous model slug resolution for role "${role}": multiple matching models found: ${candidateSlugs.join(", ")}`,
          { reason: "AMBIGUOUS", matches: candidateSlugs }
        );
      }
    }
    throw new UnresolvedModelSlugError(
      role,
      `No installed model found matching policy for role "${role}" (candidates: ${basePolicy.priorityCandidates.map((c) => `${c.family} (${c.effort})`).join(" -> ")}).`,
      { reason: "NOT_FOUND" }
    );
  }

  return matchSinglePolicy(role, basePolicy, installed);
}

function matchSinglePolicy(role, policy, installed) {
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
 * Class-based wrapper for NTG 2.0 ModelRouter resolution with session caching
 * and authority-decoupled route descriptors.
 */
export class ModelRouter {
  constructor(opts = {}) {
    this.defaultOpts = { ...opts };
  }

  listModels(opts = {}) {
    return listInstalledModels({ ...this.defaultOpts, ...opts });
  }

  clearCache() {
    clearModelCatalogCache();
  }

  resolve(role, opts = {}) {
    const merged = { ...this.defaultOpts, ...opts };
    const normalized = normalizeRoleName(role);
    const slug = resolveSlug(normalized, merged);
    const authority = getRoleAuthority(normalized);
    const policy = ROLE_POLICY_TABLE[normalized];
    const overridden = merged.modelOverride !== undefined && merged.modelOverride !== null;
    const legacyFallback = normalized === "navi" && isNaviLegacyFallbackRequested(merged);
    return Object.freeze({
      role: normalized,
      slug,
      overridden,
      experimental: Boolean(policy.experimental && !legacyFallback && !overridden),
      provenance: policy.provenance,
      authority,
    });
  }
}
