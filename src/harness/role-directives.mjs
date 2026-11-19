import { normalizeRoleName, ROLE_AUTHORITY_TABLE, ROLE_POLICY_TABLE } from "../core/model-router.mjs";
import { buildLayer1Calibration } from "./model-calibration.mjs";

export const HALO_CALLERS = Object.freeze(["steamroller", "bulldozer", "bobcat"]);
export const HALO_VERDICTS = Object.freeze(["ACCEPT", "REVISE", "ESCALATE"]);

export const ROLE_DIRECTIVE_TABLE = Object.freeze({
  steamroller: Object.freeze({
    role: "steamroller",
    summary: "Interactive AGY orchestrator and LedgerKernel owner.",
    boundaries: Object.freeze([
      "Classify work into Track L (HALO_LIGHTWEIGHT), Track S, or Track M (ZEN_DURABLE).",
      "Manage dynamic model capability routing without expanding any role's authority.",
      "Only LedgerKernel, LightweightLog, and v1-compat mutate protected state/config paths.",
    ]),
  }),
  piledriver: Object.freeze({
    role: "piledriver",
    summary: "READ_ONLY bounded architect, milestone planner, and Tactical/Material replan advisor.",
    boundaries: Object.freeze([
      "Advisory only: never edit files, execute shell commands, spawn subagents, or adopt plans.",
    ]),
  }),
  bulldozer: Object.freeze({
    role: "bulldozer",
    summary: "Selective execution coordinator and primary recovery lead (Neon High, XHigh when needed).",
    boundaries: Object.freeze([
      "Coordinate Jaguar, Puma, Bobcat, and Strix Halo within the assigned milestone scope.",
      "General run_command access is governed across shell and file tools by hooks/shell-safety-guard.py.",
      "Never mutate .ntg/ledger.json, .ntg/ledger.json.lock, .ntg/lightweight-runs.jsonl, hooks.json, hooks/*.py, or plugin.json.",
      "Never invoke Zen or claim global project completion.",
    ]),
  }),
  bobcat: Object.freeze({
    role: "bobcat",
    summary: "Substantive implementation and local verification worker (Hydrogen Medium).",
    boundaries: Object.freeze([
      "Implement substantive feature code, API/stateful logic, bug fixes, and unit tests within scope.",
      "Only allowed subagent is strix-halo for formative quality review via ReviewRequest.",
      "Never mutate protected ledger, hook, or plugin paths.",
    ]),
  }),
  "strix-halo": Object.freeze({
    role: "strix-halo",
    summary: "READ_ONLY cross-caller implementation reviewer and quality advisor (Neon Medium, High when needed).",
    boundaries: Object.freeze([
      "Accept unified ReviewRequest from steamroller, bulldozer, or bobcat only.",
      "Return ACCEPT | REVISE | ESCALATE bound to candidate_id_or_run_id, reviewed_diff_digest, acceptance_criteria_digest, plan_version, and evidence_basis.",
      "READ_ONLY: zero edits, zero shell commands, zero delegation.",
    ]),
  }),
  jaguar: Object.freeze({
    role: "jaguar",
    summary: "READ_ONLY lightweight codebase scout (Gemini 3.8 Flash Low).",
    boundaries: Object.freeze([
      "Locate symbols, definitions, and factual file ranges under Lightweight Worker Harness.",
      "Emit REROUTE_REQUIRED if deep cross-cutting reasoning beyond Flash Low is needed.",
    ]),
  }),
  puma: Object.freeze({
    role: "puma",
    summary: "Separate lightweight mechanical, formatting, and config worker (Gemini 3.8 Flash Low).",
    boundaries: Object.freeze([
      "Perform bounded mechanical, formatting, or config text edits only (no shell, no delegation).",
      "Emit REROUTE_REQUIRED to Bobcat if substantive code, state, API, or test logic is needed.",
    ]),
  }),
  zen: Object.freeze({
    role: "zen",
    summary: "Independent non-mutating summative verifier (Sonnet 5.5 High / Argon High fallback).",
    boundaries: Object.freeze([
      "Enforced non-mutating across shell and file tools via NTG_ACTIVE_ROLE=zen.",
      "Return GO or NO-GO with criterion-linked OBSERVED evidence.",
    ]),
  }),
  instinct: Object.freeze({
    role: "instinct",
    summary: "READ_ONLY autonomous alternate-framing advisor (Opus 5.5 Low).",
    boundaries: Object.freeze([
      "Provide competing causal hypotheses and discriminating tests; never edit, run shell, or adopt plans.",
    ]),
  }),
  navi: Object.freeze({
    role: "navi",
    summary: "Isolated Linux desktop observation and bounded GUI leaf (Neon Medium experimental, Argon Medium fallback).",
    boundaries: Object.freeze([
      "Private per-process HOME with cu MCP only; return NEEDS_CONFIRMATION before external/irreversible actions.",
    ]),
  }),
});

/**
 * Builds and validates a unified caller-aware Strix Halo ReviewRequest.
 */
export function buildHaloReviewRequest({
  caller,
  candidate_id_or_run_id,
  reviewed_diff_digest,
  acceptance_criteria_digest,
  plan_version,
  evidence_basis,
  track = "M",
  acceptance_criteria = [],
  context_digest = null,
}) {
  const normalizedCaller = normalizeRoleName(caller);
  if (!HALO_CALLERS.includes(normalizedCaller)) {
    throw new Error(
      `Invalid Strix Halo caller '${caller}': must be one of ${HALO_CALLERS.join(", ")}`
    );
  }
  if (!candidate_id_or_run_id || !reviewed_diff_digest || !acceptance_criteria_digest || !plan_version) {
    throw new Error(
      "Halo ReviewRequest requires candidate_id_or_run_id, reviewed_diff_digest, acceptance_criteria_digest, and plan_version"
    );
  }
  return Object.freeze({
    caller: normalizedCaller,
    track,
    candidate_id_or_run_id,
    reviewed_diff_digest,
    acceptance_criteria_digest,
    plan_version,
    evidence_basis: evidence_basis ?? [],
    acceptance_criteria: [...acceptance_criteria],
    context_digest,
  });
}

/**
 * Composes Layer 1 + Layer 2 + optional Layer 3 digest into a structured harness envelope.
 */
export function composeModelAwareHarness({ role, modelSlug, contextDigest = null, track = null }) {
  const normalized = normalizeRoleName(role);
  const authority = ROLE_AUTHORITY_TABLE[normalized];
  const directive = ROLE_DIRECTIVE_TABLE[normalized];
  if (!authority || !directive) {
    throw new Error(`Unknown harness role '${role}'`);
  }
  const policy = ROLE_POLICY_TABLE[normalized];
  const layer1 = buildLayer1Calibration(modelSlug || policy?.family || authority.harnessTier);
  return Object.freeze({
    layer1,
    layer2: Object.freeze({
      role: normalized,
      summary: directive.summary,
      boundaries: directive.boundaries,
      authority,
      ...(track ? { track } : {}),
    }),
    layer3: contextDigest ?? null,
  });
}
