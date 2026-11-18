import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  InvariantViolationError,
  LedgerKernel,
  deepClone,
  validatePlan,
} from "./ledger-kernel.mjs";

export class V1CompatError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "V1CompatError";
    this.code = "V1_COMPAT_ERROR";
    Object.assign(this, details);
  }
}

function atomicWriteJson(filePath, data) {
  const resolved = resolve(filePath);
  const dir = dirname(resolved);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = join(dir, `.compat-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, resolved);
}

/**
 * Returns true if the parsed JSON object looks like a 1.x vNext ledger.
 */
export function isV1LedgerData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  return (
    typeof data.goal === "string" &&
    Array.isArray(data.milestones) &&
    "plan_version" in data &&
    "verification" in data &&
    "evidence" in data &&
    !("ntg_schema_v2_only" in data)
  );
}

/**
 * Restores a 1.x ledger JSON payload into an NTG 2.0 LedgerKernel instance
 * without losing 1.x verification, candidate, or history semantics.
 */
export function fromV1LedgerJSON(data) {
  if (!isV1LedgerData(data)) {
    throw new V1CompatError("Input JSON is not a valid 1.x ledger payload");
  }
  const normalized = deepClone(data);
  if (!Array.isArray(normalized.constraints)) normalized.constraints = [];
  if (!Array.isArray(normalized.decision_invariants)) normalized.decision_invariants = [];
  if (!Array.isArray(normalized.blockers)) normalized.blockers = [];
  if (!Array.isArray(normalized.completed_milestones)) normalized.completed_milestones = [];
  for (const m of normalized.milestones) {
    if (m && typeof m === "object") {
      if (!Array.isArray(m.coverage)) m.coverage = [];
      if (!Array.isArray(m.verify)) m.verify = [];
      if (!Array.isArray(m.non_goals)) m.non_goals = m.non_goals ? [m.non_goals] : [];
      if (!Array.isArray(m.dependencies)) m.dependencies = [];
      if (!Array.isArray(m.bounded_scope)) m.bounded_scope = m.bounded_scope ? [m.bounded_scope] : [];
      if (!Array.isArray(m.acceptance_criteria)) {
        m.acceptance_criteria = m.acceptance_criteria ? [m.acceptance_criteria] : [];
      }
    }
  }
  return LedgerKernel.fromJSON(normalized);
}

/**
 * Serializes a LedgerKernel instance in a 1.x-compatible JSON structure
 * (preserving 1.x fields while retaining any NTG 2.0 fields if populated).
 */
export function toV1CompatibleLedgerJSON(ledger) {
  if (!(ledger instanceof LedgerKernel)) {
    throw new V1CompatError("toV1CompatibleLedgerJSON requires a LedgerKernel instance");
  }
  return ledger.toJSON();
}

export function loadV1Ledger(filePath) {
  const resolved = resolve(filePath);
  const parsed = JSON.parse(readFileSync(resolved, "utf8"));
  return fromV1LedgerJSON(parsed);
}

export function saveV1CompatibleLedger(ledger, filePath) {
  ledger.save(filePath);
  return resolve(filePath);
}

/**
 * Normalizes and validates a 1.x plan.json payload for NTG 2.0 LedgerKernel.
 */
export function normalizeV1Plan(rawPlan) {
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) {
    throw new InvariantViolationError("Plan must be a non-null object");
  }
  validatePlan(rawPlan);
  const normalized = deepClone(rawPlan);
  normalized.goal = String(rawPlan.goal).trim();
  normalized.plan_version = rawPlan.plan_version !== undefined ? rawPlan.plan_version : "v1";
  normalized.constraints = Array.isArray(rawPlan.constraints) ? [...rawPlan.constraints] : [];
  normalized.decision_invariants = Array.isArray(rawPlan.decision_invariants)
    ? [...rawPlan.decision_invariants]
    : [];
  normalized.milestones = rawPlan.milestones.map((m) => ({
    ...deepClone(m),
    id: m.id,
    title: m.title || m.id,
    objective: m.objective || "",
    bounded_scope: Array.isArray(m.bounded_scope) ? [...m.bounded_scope] : m.bounded_scope ? [m.bounded_scope] : [],
    non_goals: Array.isArray(m.non_goals) ? [...m.non_goals] : m.non_goals ? [m.non_goals] : [],
    dependencies: Array.isArray(m.dependencies) ? [...m.dependencies] : [],
    acceptance_criteria: Array.isArray(m.acceptance_criteria)
      ? [...m.acceptance_criteria]
      : m.acceptance_criteria
      ? [m.acceptance_criteria]
      : [],
    coverage: Array.isArray(m.coverage) ? deepClone(m.coverage) : [],
    verify: Array.isArray(m.verify) ? [...m.verify] : [],
  }));
  return normalized;
}

export function loadV1Plan(filePath) {
  const parsed = JSON.parse(readFileSync(resolve(filePath), "utf8"));
  return normalizeV1Plan(parsed);
}

export function saveV1CompatiblePlan(plan, filePath) {
  const normalized = normalizeV1Plan(plan);
  atomicWriteJson(filePath, normalized);
  return normalized;
}

/**
 * Loads and validates a 1.x plugin.json manifest, preserving schema, name, and description.
 */
export function loadV1PluginConfig(filePath) {
  const parsed = JSON.parse(readFileSync(resolve(filePath), "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new V1CompatError("plugin.json must be a JSON object");
  }
  if (typeof parsed.name !== "string" || !parsed.name.trim()) {
    throw new V1CompatError("plugin.json missing required 'name' string");
  }
  return parsed;
}

export function normalizePluginConfig(config, { updateDescriptionForNtg2 = false } = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new V1CompatError("plugin config must be an object");
  }
  if (typeof config.name !== "string" || !config.name.trim()) {
    throw new V1CompatError("plugin config requires non-empty 'name'");
  }
  const out = deepClone(config);
  if (!out.$schema) {
    out.$schema = "https://antigravity.google/schemas/v1/plugin.json";
  }
  if (updateDescriptionForNtg2) {
    out.description =
      "Native Gravity 2.0 (Season 2): Steamroller interactive orchestration + LedgerKernel, Piledriver, Bulldozer (Hydrogen XHigh), Bobcat, Strix Halo, Jaguar, Puma, Instinct, Navi, and Zen verification.";
  }
  return out;
}

export function saveV1CompatiblePluginConfig(config, filePath, opts = {}) {
  const normalized = normalizePluginConfig(config, opts);
  atomicWriteJson(filePath, normalized);
  return normalized;
}

/**
 * Explicit internal migration entry point for protected 1.x state/config targets.
 * Runs exclusively via host-process Node FS APIs (never model-facing tools).
 */
export function migrateProtectedConfigViaAdapter({
  ledgerPath,
  planPath,
  pluginPath,
  updatePluginDescription = false,
} = {}) {
  const migrated = {};
  if (ledgerPath && existsSync(resolve(ledgerPath))) {
    const ledger = loadV1Ledger(ledgerPath);
    saveV1CompatibleLedger(ledger, ledgerPath);
    migrated.ledger = resolve(ledgerPath);
  }
  if (planPath && existsSync(resolve(planPath))) {
    const plan = loadV1Plan(planPath);
    saveV1CompatiblePlan(plan, planPath);
    migrated.plan = resolve(planPath);
  }
  if (pluginPath && existsSync(resolve(pluginPath))) {
    const cfg = loadV1PluginConfig(pluginPath);
    saveV1CompatiblePluginConfig(cfg, pluginPath, {
      updateDescriptionForNtg2: updatePluginDescription,
    });
    migrated.plugin = resolve(pluginPath);
  }
  return migrated;
}
