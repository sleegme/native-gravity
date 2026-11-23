import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  InvalidTransitionError,
  LedgerKernel,
  isEvidenceEmpty,
  validateZenVerdictPacket,
} from "../core/ledger-kernel.mjs";
import {
  LightweightLog,
  canonicalString,
  computeAcceptanceDigest,
  computeDiffDigest,
  validateHaloReviewBinding,
} from "../core/lightweight-log.mjs";
import {
  analyzeWorkSemantics,
  buildContextDigest,
  buildHaloReviewRequest,
  composeModelAwareHarness,
  evaluateLightweightSuitability,
  validateLightweightResult,
} from "../harness/index.mjs";
import { InvalidHandoffPacketError, parseResponsePacket } from "../../scripts/runner.mjs";

function unwrapPacket(res) {
  if (res && typeof res === "object" && typeof res.response === "string") {
    const parsed = parseResponsePacket({ ok: res.ok !== false, response: res.response });
    if (parsed.ok && parsed.packet && typeof parsed.packet === "object") {
      return parsed.packet;
    }
  }
  return res;
}

export class InitialPlanningRequiredError extends Error {
  constructor(message, details = {}) {
    super(message || "Initial Piledriver planning pass failed or is unavailable");
    this.name = "InitialPlanningRequiredError";
    this.code = "PILEDRIVER_PLANNING_UNAVAILABLE";
    this.ok = false;
    if (details && typeof details === "object") {
      Object.assign(this, details);
    }
  }
}

export const PILEDRIVER_MODES = Object.freeze(["auto", "always", "never"]);

const PLANNING_PATH_TOKEN_RE =
  /(?:^|(?<=[\s(\["'`]))(?:[A-Za-z0-9_.-]*\/+[A-Za-z0-9_./-]+|[A-Za-z0-9_.-]+\.(?:md|mdx|txt|rst|adoc|json|ya?ml|toml|ini|cfg|conf|mjs|cjs|js|jsx|ts|tsx|py|sh|bash|css|scss|html|xml|svg))(?=$|[\s)\]"'`,.:;!?])/gi;

const ARCHITECTURAL_PLANNING_RE =
  /\b(?:architectur(?:e|al)|cross[- ]cutting|system[- ]wide|kernel\s+rewrite|redesign|overhaul|security(?:\s+(?:boundary|model|audit|fix|hardening|policy|guard|bypass))?|auth(?:entication|orization)?\s+(?:model|flow|schema|boundary|redesign|migration)|migration|migrate|concurrency|race\s+condition|deadlock|mutex|schema[- ]change|schema\s+(?:migration|redesign|change|overhaul)|breaking[- ]change|breaking\s+api)\b/i;

const AMBIGUOUS_PLANNING_RE =
  /\b(?:ambiguous|unclear|tbd|to\s+be\s+determined|investigate\s+options|explore\s+approaches|trade[- ]?offs?|design\s+decisions?|undecided|open\s+questions?)\b/i;

/**
 * Normalizes initial Piledriver planning mode (`auto | always | never`).
 * Explicit `mode` takes precedence; otherwise boolean `requireInitialPlanning`
 * maps `true -> "always"` and `false -> "never"`; otherwise `defaultMode`.
 */
export function normalizePiledriverMode(
  mode,
  { requireInitialPlanning = undefined, defaultMode = "auto" } = {}
) {
  if (mode !== undefined && mode !== null) {
    const normalized = String(mode).trim().toLowerCase();
    if (!PILEDRIVER_MODES.includes(normalized)) {
      throw new Error(
        `Invalid piledriver mode '${mode}'; expected one of: ${PILEDRIVER_MODES.join(", ")}`
      );
    }
    return normalized;
  }
  if (requireInitialPlanning !== undefined) {
    return requireInitialPlanning ? "always" : "never";
  }
  const normalizedDefault = String(defaultMode ?? "auto").trim().toLowerCase();
  if (!PILEDRIVER_MODES.includes(normalizedDefault)) {
    throw new Error(
      `Invalid default piledriver mode '${defaultMode}'; expected one of: ${PILEDRIVER_MODES.join(", ")}`
    );
  }
  return normalizedDefault;
}

/**
 * Evaluates whether an initial Piledriver advisory planning pass is warranted
 * for the given task/plan context, returning `{ invoke, mode, decision_reason, decision_signals }`.
 */
export function evaluateInitialPlanningNeed({
  mode = undefined,
  piledriverMode = undefined,
  requireInitialPlanning = undefined,
  defaultMode = "auto",
  track = null,
  task = "",
  goal = "",
  milestones = [],
  milestoneCount = undefined,
  hasDependencies = undefined,
  targetFiles = [],
  boundedScope = [],
  highRisk = false,
  highRiskEscalation = false,
  riskClass = null,
  ambiguous = false,
  requiresMutation = undefined,
  requiresShell = false,
  requiresSubstantiveCode = false,
  isMechanicalEdit = undefined,
  crossFileDependency = false,
  requiresCoordinator = false,
  recoveryMode = false,
} = {}) {
  const effectiveMode = normalizePiledriverMode(mode ?? piledriverMode, {
    requireInitialPlanning,
    defaultMode,
  });
  const milestoneList = Array.isArray(milestones) ? milestones : [];
  const effectiveMilestoneCount =
    typeof milestoneCount === "number" && Number.isFinite(milestoneCount)
      ? Math.max(0, Math.floor(milestoneCount))
      : Math.max(milestoneList.length, 1);
  const effectiveHasDependencies =
    hasDependencies !== undefined
      ? Boolean(hasDependencies)
      : milestoneList.some((m) => Array.isArray(m?.dependencies) && m.dependencies.length > 0);
  const normalizedTrack =
    track !== null && track !== undefined && String(track).trim()
      ? String(track).trim().toUpperCase()
      : effectiveMilestoneCount > 1
        ? "M"
        : "S";

  const explicitFiles = [
    ...(Array.isArray(targetFiles) ? targetFiles : []),
    ...(Array.isArray(boundedScope) ? boundedScope : []),
  ].filter((f) => typeof f === "string" && f.trim());
  const milestoneFiles =
    explicitFiles.length > 0
      ? []
      : milestoneList
          .flatMap((m) => (Array.isArray(m?.bounded_scope) ? m.bounded_scope : []))
          .filter((f) => typeof f === "string" && f.trim());
  const combinedFiles = [...new Set([...explicitFiles, ...milestoneFiles])];

  const textParts = [];
  const pushText = (value) => {
    if (typeof value === "string" && value.trim()) {
      const trimmed = value.trim();
      if (!textParts.includes(trimmed)) textParts.push(trimmed);
    }
  };
  pushText(task);
  pushText(goal);
  for (const m of milestoneList) {
    pushText(m?.objective);
  }
  const rawText = textParts.join(" ");
  const cleanText = rawText.replace(PLANNING_PATH_TOKEN_RE, " ").replace(/\s+/g, " ").trim();

  const semantics = analyzeWorkSemantics({
    task: rawText,
    targetFiles: combinedFiles,
    milestoneCount: Math.max(effectiveMilestoneCount, 1),
    requiresMutation,
    requiresShell: Boolean(requiresShell),
    requiresSubstantiveCode: Boolean(requiresSubstantiveCode),
    isMechanicalEdit,
    crossFileDependency: Boolean(crossFileDependency),
    requiresCoordinator: Boolean(requiresCoordinator),
    recoveryMode: Boolean(recoveryMode),
    highRisk: Boolean(highRisk || highRiskEscalation),
    riskClass,
  });

  const isHighRisk = Boolean(highRisk || highRiskEscalation || semantics.highRisk);
  const isArchitectural = !semantics.isReadOnlyDiscovery && ARCHITECTURAL_PLANNING_RE.test(cleanText);
  const isAmbiguous = Boolean(ambiguous || AMBIGUOUS_PLANNING_RE.test(cleanText));

  const decision_signals = {
    mode: effectiveMode,
    track: normalizedTrack,
    milestone_count: effectiveMilestoneCount,
    has_dependencies: effectiveHasDependencies,
    file_count: semantics.effectiveFiles.length,
    high_risk: isHighRisk,
    needs_coordinator: Boolean(semantics.needsCoordinator),
    architectural: isArchitectural,
    ambiguous: isAmbiguous,
    is_read_only_discovery: Boolean(semantics.isReadOnlyDiscovery),
    is_mechanical: Boolean(semantics.isMechanical),
    recommended_track: semantics.recommendedTrack,
  };

  if (effectiveMode === "always") {
    return {
      invoke: true,
      mode: effectiveMode,
      decision_reason: "explicit_always_override",
      decision_signals,
    };
  }
  if (effectiveMode === "never") {
    return {
      invoke: false,
      mode: effectiveMode,
      decision_reason: "explicit_never_override",
      decision_signals,
    };
  }

  if (normalizedTrack === "M") {
    return {
      invoke: true,
      mode: effectiveMode,
      decision_reason: "track_m_requires_planning",
      decision_signals,
    };
  }
  if (effectiveMilestoneCount > 1) {
    return {
      invoke: true,
      mode: effectiveMode,
      decision_reason: "multi_milestone_plan",
      decision_signals,
    };
  }
  if (effectiveHasDependencies) {
    return {
      invoke: true,
      mode: effectiveMode,
      decision_reason: "milestone_dependencies_present",
      decision_signals,
    };
  }
  if (isHighRisk) {
    return {
      invoke: true,
      mode: effectiveMode,
      decision_reason: "high_risk_task",
      decision_signals,
    };
  }
  if (semantics.needsCoordinator || isArchitectural) {
    return {
      invoke: true,
      mode: effectiveMode,
      decision_reason: "architectural_or_cross_cutting_scope",
      decision_signals,
    };
  }
  if (isAmbiguous) {
    return {
      invoke: true,
      mode: effectiveMode,
      decision_reason: "ambiguous_task_or_plan",
      decision_signals,
    };
  }

  return {
    invoke: false,
    mode: effectiveMode,
    decision_reason:
      normalizedTrack === "L"
        ? "bounded_clear_track_l_task"
        : "bounded_clear_single_milestone_track_s",
    decision_signals,
  };
}

const BLOCKING_ADVISORY_STATUSES = Object.freeze([
  "BLOCKED",
  "NEEDS_REPLAN",
  "REPLAN",
  "REJECT",
  "REJECTED",
]);

const BLOCKING_ADVISORY_ACTIONS = Object.freeze([
  "BLOCK",
  "REPLAN",
  "REJECT",
  "HALT",
  "ABORT",
]);

const MEANINGFUL_ADVISORY_STATUSES = Object.freeze([
  ...BLOCKING_ADVISORY_STATUSES,
  "PROCEED",
  "OK",
  "APPROVED",
  "APPROVE",
  "ADVISE",
  "READY",
]);

const MEANINGFUL_ADVISORY_ACTIONS = Object.freeze([
  ...BLOCKING_ADVISORY_ACTIONS,
  "PROCEED",
  "CONTINUE",
  "APPROVE",
  "ADVISE",
]);

const MEANINGFUL_ADVISORY_KEYS = Object.freeze([
  "recommendation",
  "plan",
  "milestones",
  "risks",
  "blocking_risks",
  "dependencies",
  "defects",
  "plan_defects",
  "summary",
  "advice",
  "notes",
  "recommend_replan",
  "status",
  "action",
]);

const VALID_SUPERVISOR_DECISIONS = Object.freeze([
  "PROCEED",
  "REPLAN_REQUIRED",
  "REPLAN",
  "REJECT",
]);

function isNonEmptyAdvisoryElement(item) {
  if (item === null || item === undefined) return false;
  if (typeof item === "string") return item.trim().length > 0;
  if (Array.isArray(item)) return item.some(isNonEmptyAdvisoryElement);
  if (typeof item === "object") return Object.keys(item).length > 0;
  return typeof item === "number" || typeof item === "boolean";
}

function isMeaningfulAdvisoryValue(key, val) {
  if (val === null || val === undefined) return false;
  if (key === "recommend_replan") return val === true;
  if (key === "status") {
    return typeof val === "string" && MEANINGFUL_ADVISORY_STATUSES.includes(val.trim().toUpperCase());
  }
  if (key === "action") {
    return typeof val === "string" && MEANINGFUL_ADVISORY_ACTIONS.includes(val.trim().toUpperCase());
  }
  if (typeof val === "string") return val.trim().length > 0;
  if (Array.isArray(val)) return val.some(isNonEmptyAdvisoryElement);
  if (typeof val === "object") return Object.keys(val).length > 0;
  if (typeof val === "boolean") return val === true;
  return false;
}

/**
 * Computes a deterministic digest for a Piledriver advisory bound to a plan
 * version so interactive Steamroller decisions cannot be replayed across
 * different advisories or plan versions.
 */
export function computeAdvisoryDigest(advice, { planVersion = 1 } = {}) {
  const payload = {
    plan_version: String(planVersion ?? 1),
    advice: advice ?? null,
  };
  return `sha256:${createHash("sha256").update(canonicalString(payload), "utf8").digest("hex")}`;
}

/**
 * Computes a deterministic digest of all planning-relevant immutable inputs for
 * a Track L run (including acceptance_criteria) so changed criteria invalidate
 * cached planning receipts even when runId/planVersion stay the same.
 */
export function computePlanningInputDigest({
  task = "",
  goal = "",
  boundedScope = [],
  acceptanceCriteria = [],
  planVersion = 1,
} = {}) {
  const payload = {
    task: String(task || goal || "").trim(),
    goal: String(goal || task || "").trim(),
    bounded_scope: Array.isArray(boundedScope) ? boundedScope : [],
    acceptance_criteria_digest: computeAcceptanceDigest(
      Array.isArray(acceptanceCriteria) ? acceptanceCriteria : []
    ),
    plan_version: String(planVersion ?? 1),
  };
  return `sha256:${createHash("sha256").update(canonicalString(payload), "utf8").digest("hex")}`;
}

/**
 * Validates that a Piledriver response is a meaningful non-empty advisory object
 * before persisting a `COMPLETED` planning marker.
 */
export function validatePiledriverAdvisory(advice, context = {}) {
  if (!advice || typeof advice !== "object" || Array.isArray(advice)) {
    throw new InitialPlanningRequiredError(
      "Mandatory initial Piledriver advisory must be a non-null JSON object",
      { reason: "INVALID_ADVISORY_SHAPE", ...context }
    );
  }
  const hasMeaningfulField = MEANINGFUL_ADVISORY_KEYS.some((key) => {
    if (!(key in advice)) return false;
    return isMeaningfulAdvisoryValue(key, advice[key]);
  });
  if (!hasMeaningfulField) {
    throw new InitialPlanningRequiredError(
      "Mandatory initial Piledriver advisory lacks a meaningful advisory field (e.g. recommendation, plan, milestones, risks, plan_defects, status, action, summary)",
      { reason: "INVALID_ADVISORY_SHAPE", ...context }
    );
  }
  return advice;
}

const DIRECT_BLOCKING_PHRASE_RE =
  /\b(?:do\s+not\s+proceed|don['’]t\s+proceed|must\s+not\s+proceed|cannot\s+proceed|can['’]t\s+proceed|should\s+not\s+proceed|stop\s+before)\b/i;

const NEGATABLE_BLOCKING_TERM_RE =
  /\b(?:replan|halt|abort|reject|unsafe|blocking\s+(?:issue|defect|risk|gap)s?)\b/gi;

const CLAUSE_BOUNDARY_RE =
  /(?:[.!?;:\n]|,\s*(?:but|however|yet|except)\b|\b(?:but|however|yet|except)\b)/i;

const NEGATION_PREFIX_RE =
  /\b(?:no|not|never|without|zero|none|neither|nor|free\s+of|avoid(?:s|ed|ing)?|resolved?|eliminated?|cleared?|do\s+not|don['’]t|does\s+not|doesn['’]t|need\s+not|needn['’]t|no\s+need\s+to|no\s+reason\s+to)(?:\s+[a-z0-9'’-]+){0,3}\s*$/i;

/**
 * Conservative, negation-aware prose safety detector. Intended strictly as a
 * fail-closed safety guard beneath Steamroller's own supervisory decision.
 */
export function hasBlockingProse(text) {
  if (typeof text !== "string" || !text.trim()) return false;
  if (DIRECT_BLOCKING_PHRASE_RE.test(text)) return true;
  const clauses = text.split(CLAUSE_BOUNDARY_RE);
  for (const clause of clauses) {
    NEGATABLE_BLOCKING_TERM_RE.lastIndex = 0;
    let match;
    while ((match = NEGATABLE_BLOCKING_TERM_RE.exec(clause)) !== null) {
      const prefix = clause.slice(0, match.index);
      if (!NEGATION_PREFIX_RE.test(prefix)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Inspects a validated Piledriver advisory for blocking plan defects, blocking
 * status/action, or non-negated blocking prose recommendations as a fail-closed
 * safety gate beneath Steamroller's supervisory judgment.
 */
export function inspectPlanningAdvisory(advice) {
  const defects = [];
  if (Array.isArray(advice?.plan_defects)) defects.push(...advice.plan_defects);
  if (Array.isArray(advice?.defects)) defects.push(...advice.defects);
  if (Array.isArray(advice?.blocking_risks)) defects.push(...advice.blocking_risks);

  const recText = typeof advice?.recommendation === "string" ? advice.recommendation.trim() : "";
  const summaryText = typeof advice?.summary === "string" ? advice.summary.trim() : "";
  const statusUpper = typeof advice?.status === "string" ? advice.status.trim().toUpperCase() : "";
  const actionUpper = typeof advice?.action === "string" ? advice.action.trim().toUpperCase() : "";

  const blockingProse = hasBlockingProse(recText) || hasBlockingProse(summaryText);
  const blockingStatus =
    BLOCKING_ADVISORY_STATUSES.includes(statusUpper) ||
    BLOCKING_ADVISORY_ACTIONS.includes(actionUpper);
  const explicitReplan = advice?.recommend_replan === true || blockingProse || blockingStatus;

  if (blockingProse && defects.length === 0) {
    defects.push(recText || summaryText);
  }
  return {
    hasBlockingDefects: defects.length > 0 || explicitReplan,
    defects,
    explicitReplan,
  };
}

/**
 * Resolves Steamroller's bounded supervisory decision on a validated Piledriver
 * advisory across in-process callbacks, process-boundary CLI decision tokens
 * (`--planning-decision` + `--planning-decision-digest`), persisted prior
 * decisions, and the fail-closed safety gate.
 */
export async function resolveSupervisorPlanningDecision({
  record,
  advisoryDigest = null,
  reviewPlanningAdvice = null,
  planningDecision = null,
  requirePlanningDecision = false,
  context = {},
} = {}) {
  const inspection = inspectPlanningAdvisory(record?.advice);
  const digest =
    advisoryDigest ||
    record?.advisory_digest ||
    computeAdvisoryDigest(record?.advice, { planVersion: context.plan_version ?? record?.plan_version ?? 1 });

  if (typeof reviewPlanningAdvice === "function") {
    const custom = await reviewPlanningAdvice(record, {
      ...context,
      advisory_digest: digest,
      inspection,
    });
    const rawDecision =
      custom?.decision !== undefined && custom?.decision !== null
        ? String(custom.decision).trim().toUpperCase()
        : (inspection.hasBlockingDefects ? "REPLAN_REQUIRED" : "PROCEED");
    if (!VALID_SUPERVISOR_DECISIONS.includes(rawDecision)) {
      return {
        awaiting_decision: true,
        reason: "INVALID_PLANNING_DECISION",
        provided_decision: String(custom?.decision ?? ""),
        advisory_digest: digest,
        safety_gate: inspection,
        adopted: false,
        defects: inspection.defects,
      };
    }
    return {
      awaiting_decision: false,
      decision: rawDecision === "REPLAN" ? "REPLAN_REQUIRED" : rawDecision,
      adopted: false,
      source: "callback",
      advisory_digest: digest,
      defects: inspection.defects,
      safety_gate: inspection,
      ...(custom?.notes ? { notes: String(custom.notes) } : {}),
    };
  }

  if (planningDecision && typeof planningDecision === "object" && planningDecision.decision) {
    const rawDecision = String(planningDecision.decision).trim().toUpperCase();
    if (!VALID_SUPERVISOR_DECISIONS.includes(rawDecision)) {
      return {
        awaiting_decision: true,
        reason: "INVALID_PLANNING_DECISION",
        advisory_digest: digest,
        safety_gate: inspection,
        adopted: false,
        defects: inspection.defects,
      };
    }
    const providedDigest =
      typeof planningDecision.digest === "string" ? planningDecision.digest.trim() : "";
    if (!providedDigest) {
      return {
        awaiting_decision: true,
        reason: "PLANNING_DECISION_DIGEST_REQUIRED",
        advisory_digest: digest,
        safety_gate: inspection,
        adopted: false,
        defects: inspection.defects,
      };
    }
    if (providedDigest && providedDigest !== digest) {
      return {
        awaiting_decision: true,
        reason: "PLANNING_DECISION_DIGEST_MISMATCH",
        advisory_digest: digest,
        provided_advisory_digest: providedDigest,
        safety_gate: inspection,
        adopted: false,
        defects: inspection.defects,
      };
    }
    return {
      awaiting_decision: false,
      decision: rawDecision === "REPLAN" ? "REPLAN_REQUIRED" : rawDecision,
      adopted: false,
      source: "interactive_steamroller",
      advisory_digest: digest,
      defects: inspection.defects,
      safety_gate: inspection,
      ...(planningDecision.notes ? { notes: String(planningDecision.notes) } : {}),
    };
  }

  const persisted = record?.supervisor_decision;
  if (
    persisted &&
    typeof persisted === "object" &&
    persisted.advisory_digest === digest &&
    typeof persisted.decision === "string" &&
    persisted.decision.trim().length > 0
  ) {
    return {
      ...persisted,
      awaiting_decision: false,
      adopted: false,
      advisory_digest: digest,
      safety_gate: persisted.safety_gate ?? inspection,
    };
  }

  if (requirePlanningDecision) {
    return {
      awaiting_decision: true,
      reason: "SUPERVISOR_DECISION_REQUIRED",
      advisory_digest: digest,
      safety_gate: inspection,
      adopted: false,
      defects: inspection.defects,
    };
  }

  return {
    awaiting_decision: false,
    decision: inspection.hasBlockingDefects ? "REPLAN_REQUIRED" : "PROCEED",
    adopted: false,
    source: "safety_gate",
    advisory_digest: digest,
    defects: inspection.defects,
    safety_gate: inspection,
  };
}

/**
 * Coordinates NTG 2.0 Track L (`HALO_LIGHTWEIGHT`) and Track S/M (`ZEN_DURABLE`)
 * verification gates with strict Halo/Zen separation and staleness enforcement.
 */
export class TrackRunner {
  #invokePlanner;
  #invokeWorker;
  #invokeHalo;
  #invokeZen;
  #piledriverMode;

  constructor({
    ledger = null,
    ledgerPath = null,
    lightweightLog = null,
    lightweightLogPath = ".ntg/lightweight-runs.jsonl",
    invokePlanner = null,
    invokeWorker = null,
    invokeHalo = null,
    invokeZen = null,
    piledriverMode = undefined,
    requireInitialPlanning = undefined,
    cwd = process.cwd(),
  } = {}) {
    this.ledger = ledger;
    this.ledgerPath = ledgerPath;
    this.lightweightLog = lightweightLog ?? new LightweightLog(lightweightLogPath);
    this.#invokePlanner = invokePlanner;
    this.#invokeWorker = invokeWorker;
    this.#invokeHalo = invokeHalo;
    this.#invokeZen = invokeZen;
    this.#piledriverMode = normalizePiledriverMode(piledriverMode, {
      requireInitialPlanning,
      defaultMode: typeof invokePlanner === "function" ? "auto" : "never",
    });
    this.cwd = cwd;
  }

  /**
   * Executes or finalizes a Track L lightweight task:
   * - Reroutes unsuitable 3.8 Flash Low assignments cleanly to Bobcat/Bulldozer.
   * - Requires a fresh, binding-matched Strix Halo `ACCEPT`.
   * - Omits Zen by default; escalates high-risk tasks to Zen on Steamroller judgment.
   * - Writes exclusively to `.ntg/lightweight-runs.jsonl` (`HALO_LIGHTWEIGHT`).
   */
  async runTrackL({
    runId,
    task = "",
    goal = "",
    workerRole = null,
    modelSlug = null,
    workerResult = null,
    haloReview = null,
    boundedScope = [],
    acceptanceCriteria = [],
    planVersion = 1,
    highRisk = false,
    highRiskEscalation = false,
    riskClass = null,
    ambiguous = false,
    escalateHalo = false,
    reviewAttempt = null,
    previousVerdict = null,
    planningPass = null,
    reviewPlanningAdvice = null,
    planningDecision = null,
    requirePlanningDecision = false,
    piledriverMode = undefined,
    requireInitialPlanning = undefined,
    evidenceBasis = undefined,
    caller = "steamroller",
    requiresMutation = undefined,
    requiresShell = false,
    requiresSubstantiveCode = false,
    isMechanicalEdit = undefined,
    crossFileDependency = false,
    requiresCoordinator = false,
  } = {}) {
    if (!runId || typeof runId !== "string" || !runId.trim()) {
      throw new Error("Track L execution requires a non-empty runId");
    }

    const effectiveMode = normalizePiledriverMode(piledriverMode, {
      requireInitialPlanning,
      defaultMode: this.#piledriverMode,
    });
    const acceptanceCriteriaDigest = computeAcceptanceDigest(acceptanceCriteria);
    const planningInputDigest = computePlanningInputDigest({
      task,
      goal,
      boundedScope,
      acceptanceCriteria,
      planVersion,
    });
    let resolvedPlanningPass = planningPass;
    const persistedPlanningPass = this.lightweightLog.getPlanningPass(runId, planVersion, {
      planningInputDigest,
    });
    const hasCompletedPassed = resolvedPlanningPass?.status === "COMPLETED";
    const hasCompletedPersisted = persistedPlanningPass?.status === "COMPLETED";

    if (!hasCompletedPassed && hasCompletedPersisted) {
      resolvedPlanningPass = persistedPlanningPass;
    } else if (!hasCompletedPassed) {
      const evaluation = evaluateInitialPlanningNeed({
        mode: effectiveMode,
        track: "L",
        task,
        goal,
        milestoneCount: 1,
        hasDependencies: false,
        boundedScope,
        highRisk: Boolean(highRisk),
        highRiskEscalation: Boolean(highRiskEscalation),
        riskClass,
        ambiguous: Boolean(ambiguous),
        requiresMutation,
        requiresShell: Boolean(requiresShell),
        requiresSubstantiveCode: Boolean(requiresSubstantiveCode),
        isMechanicalEdit,
        crossFileDependency: Boolean(crossFileDependency),
        requiresCoordinator: Boolean(requiresCoordinator),
      });
      if (!evaluation.invoke) {
        if (resolvedPlanningPass?.status === "SKIPPED") {
          // Reuse caller-supplied SKIPPED pass when current signals still skip
        } else if (persistedPlanningPass?.status === "SKIPPED") {
          resolvedPlanningPass = persistedPlanningPass;
        } else {
          resolvedPlanningPass = {
            role: "piledriver",
            status: "SKIPPED",
            invoked: false,
            plan_version: String(planVersion),
            slug: null,
            adopted: false,
            advisory_digest: null,
            planning_input_digest: planningInputDigest,
            acceptance_criteria_digest: acceptanceCriteriaDigest,
            advice: null,
            mode: evaluation.mode,
            decision_reason: evaluation.decision_reason,
            decision_signals: evaluation.decision_signals,
            timestamp: new Date().toISOString(),
          };
          this.lightweightLog.recordPlanningPass({
            run_id: runId,
            plan_version: planVersion,
            goal: goal || task,
            caller,
            planning_input_digest: planningInputDigest,
            acceptance_criteria_digest: acceptanceCriteriaDigest,
            planning_pass: resolvedPlanningPass,
          });
        }
      } else {
        if (typeof this.#invokePlanner !== "function") {
          throw new InitialPlanningRequiredError(
            `Track L run '${runId}' (plan_version=${planVersion}) requires a bounded Piledriver advisory pass before execution, but no planner handler is available.`
          );
        }
        let rawPlan;
        try {
          rawPlan = unwrapPacket(
            await this.#invokePlanner({
              run_id: runId,
              track: "L",
              task: task || goal,
              goal: goal || task,
              bounded_scope: boundedScope,
              acceptance_criteria: acceptanceCriteria,
              plan_version: planVersion,
            })
          );
        } catch (err) {
          if (err instanceof InitialPlanningRequiredError) throw err;
          throw new InitialPlanningRequiredError(
            `Initial Piledriver planning pass failed for Track L run '${runId}': ${err?.message ?? err}`,
            { cause: err, run_id: runId, plan_version: planVersion }
          );
        }
        if (!rawPlan || rawPlan.ok === false) {
          throw new InitialPlanningRequiredError(
            `Initial Piledriver planning pass failed for Track L run '${runId}': ${rawPlan?.error || "UNAVAILABLE"}`,
            { run_id: runId, plan_version: planVersion, details: rawPlan ?? null }
          );
        }
        validatePiledriverAdvisory(rawPlan, { run_id: runId, plan_version: planVersion });
        const advisoryDigest = computeAdvisoryDigest(rawPlan, { planVersion });
        resolvedPlanningPass = {
          role: "piledriver",
          status: "COMPLETED",
          invoked: true,
          plan_version: String(planVersion),
          slug: rawPlan.slug ?? null,
          adopted: false,
          advisory_digest: advisoryDigest,
          planning_input_digest: planningInputDigest,
          acceptance_criteria_digest: acceptanceCriteriaDigest,
          advice: rawPlan,
          mode: evaluation.mode,
          decision_reason: evaluation.decision_reason,
          decision_signals: evaluation.decision_signals,
          timestamp: new Date().toISOString(),
        };
        // Persist standalone append-only planning receipt BEFORE worker execution so
        // worker failures or Halo REVISE retries never re-run Piledriver for the same
        // (runId, planVersion, planningInputDigest).
        this.lightweightLog.recordPlanningPass({
          run_id: runId,
          plan_version: planVersion,
          goal: goal || task,
          caller,
          planning_input_digest: planningInputDigest,
          acceptance_criteria_digest: acceptanceCriteriaDigest,
          planning_pass: resolvedPlanningPass,
        });
      }
    }

    // Supervisory review of non-authoritative Piledriver advice: never silently ignore blocking plan defects.
    let supervisorDecision = null;
    if (resolvedPlanningPass?.status === "COMPLETED" && resolvedPlanningPass?.advice) {
      const advisoryDigest =
        resolvedPlanningPass.advisory_digest ||
        computeAdvisoryDigest(resolvedPlanningPass.advice, { planVersion });
      if (!resolvedPlanningPass.advisory_digest) {
        resolvedPlanningPass = { ...resolvedPlanningPass, advisory_digest: advisoryDigest };
      }
      supervisorDecision = await resolveSupervisorPlanningDecision({
        record: resolvedPlanningPass,
        advisoryDigest,
        reviewPlanningAdvice,
        planningDecision,
        requirePlanningDecision,
        context: {
          track: "L",
          run_id: runId,
          plan_version: planVersion,
        },
      });
      if (supervisorDecision.awaiting_decision) {
        return {
          track: "L",
          status: "AWAITING_PLANNING_DECISION",
          verified: false,
          run_id: runId,
          advisory_digest: advisoryDigest,
          planning_pass: resolvedPlanningPass,
          safety_gate: supervisorDecision.safety_gate,
          supervisor_decision: supervisorDecision,
          required_action: `Review planning_pass.advice as Steamroller and re-run with --planning-decision <PROCEED|REPLAN_REQUIRED|REJECT> --planning-decision-digest ${advisoryDigest}`,
        };
      }
      const prevDecision = resolvedPlanningPass.supervisor_decision;
      const decisionChanged =
        !prevDecision ||
        prevDecision.advisory_digest !== advisoryDigest ||
        prevDecision.decision !== supervisorDecision.decision ||
        (prevDecision.notes ?? null) !== (supervisorDecision.notes ?? null);
      if (
        supervisorDecision.source === "interactive_steamroller" &&
        resolvedPlanningPass.status === "COMPLETED" &&
        decisionChanged
      ) {
        this.lightweightLog.recordPlanningDecision({
          run_id: runId,
          plan_version: planVersion,
          goal: goal || task,
          caller,
          planning_input_digest: planningInputDigest,
          acceptance_criteria_digest: acceptanceCriteriaDigest,
          planning_pass: resolvedPlanningPass,
          supervisor_decision: supervisorDecision,
        });
        resolvedPlanningPass = {
          ...resolvedPlanningPass,
          supervisor_decision: supervisorDecision,
        };
      }
      if (supervisorDecision.decision === "REPLAN_REQUIRED" || supervisorDecision.decision === "REPLAN" || supervisorDecision.decision === "REJECT") {
        return {
          track: "L",
          status: "NEEDS_REPLAN",
          verified: false,
          run_id: runId,
          advisory_digest: advisoryDigest,
          planning_pass: resolvedPlanningPass,
          supervisor_decision: supervisorDecision,
        };
      }
    }

    const semantics = analyzeWorkSemantics({
      task: task || goal,
      targetFiles: boundedScope,
      requiresMutation,
      requiresShell,
      requiresSubstantiveCode,
      isMechanicalEdit,
      crossFileDependency,
      requiresCoordinator,
      highRisk: highRiskEscalation,
    });
    let effectiveRole = workerRole
      ? String(workerRole).trim().toLowerCase()
      : semantics.recommendedRole;
    let reroutedFrom = null;
    let rerouteReason = null;

    const suitability = evaluateLightweightSuitability({
      role: effectiveRole,
      task,
      targetFiles: boundedScope,
      requiresMutation,
      requiresShell,
      requiresSubstantiveCode,
      isMechanicalEdit,
      crossFileDependency,
      requiresCoordinator,
      highRisk: highRiskEscalation,
    });
    if (!suitability.suitable && suitability.rerouteTo) {
      reroutedFrom = effectiveRole;
      effectiveRole = suitability.rerouteTo;
      rerouteReason = suitability.reason;
    }

    const contextDigest = buildContextDigest({
      boundedScope,
      cwd: this.cwd,
      acceptanceCriteria,
    });

    let resolvedWorkerResult = workerResult;
    if (resolvedWorkerResult === null && typeof this.#invokeWorker === "function") {
      const harness = composeModelAwareHarness({
        role: effectiveRole,
        modelSlug,
        track: "L",
        contextDigest,
      });
      resolvedWorkerResult = unwrapPacket(
        await this.#invokeWorker(effectiveRole, {
          run_id: runId,
          track: "L",
          task,
          bounded_scope: boundedScope,
          acceptance_criteria: acceptanceCriteria,
          plan_version: planVersion,
          ...(resolvedPlanningPass?.status === "COMPLETED" && resolvedPlanningPass?.advice
            ? { planning_advisory: resolvedPlanningPass.advice }
            : {}),
          harness,
        })
      );
      if (resolvedWorkerResult?.ok === false) {
        throw new Error(
          `Track L worker '${effectiveRole}' failed: ${resolvedWorkerResult.error || "FAILED"}`
        );
      }
      if (resolvedWorkerResult?.status === "REROUTE_REQUIRED") {
        const nextRole = String(resolvedWorkerResult.reroute_to || "bobcat").trim().toLowerCase();
        if (!["bobcat", "bulldozer"].includes(nextRole)) {
          throw new Error(`Invalid REROUTE_REQUIRED target '${nextRole}' from '${effectiveRole}'`);
        }
        reroutedFrom = effectiveRole;
        effectiveRole = nextRole;
        rerouteReason = resolvedWorkerResult.reason ?? "worker signaled REROUTE_REQUIRED";
        const nextHarness = composeModelAwareHarness({
          role: effectiveRole,
          modelSlug: null,
          track: "L",
          contextDigest,
        });
        resolvedWorkerResult = unwrapPacket(
          await this.#invokeWorker(effectiveRole, {
            run_id: runId,
            track: "L",
            task,
            rerouted_from: reroutedFrom,
            bounded_scope: boundedScope,
            acceptance_criteria: acceptanceCriteria,
            plan_version: planVersion,
            harness: nextHarness,
          })
        );
        if (resolvedWorkerResult?.ok === false) {
          throw new Error(
            `Track L worker '${effectiveRole}' failed: ${resolvedWorkerResult.error || "FAILED"}`
          );
        }
      }
    } else if (resolvedWorkerResult !== null) {
      resolvedWorkerResult = unwrapPacket(resolvedWorkerResult);
    }

    if (
      ["jaguar", "puma"].includes(effectiveRole) &&
      resolvedWorkerResult &&
      typeof resolvedWorkerResult === "object" &&
      ("facts" in resolvedWorkerResult ||
        "changes_made" in resolvedWorkerResult ||
        resolvedWorkerResult.status === "REROUTE_REQUIRED")
    ) {
      const lwCheck = validateLightweightResult(effectiveRole, resolvedWorkerResult);
      if (!lwCheck.valid) {
        throw new Error(`Invalid lightweight worker result from '${effectiveRole}': ${lwCheck.reason}`);
      }
    }

    const reviewedDiffDigest = computeDiffDigest(boundedScope, { cwd: this.cwd });

    const resolvedEvidence =
      evidenceBasis !== undefined && evidenceBasis !== null
        ? evidenceBasis
        : resolvedWorkerResult?.verification_evidence ??
          resolvedWorkerResult?.facts ??
          resolvedWorkerResult?.changes_made ??
          (task ? [task] : ["completed"]);

    const reviewRequest = buildHaloReviewRequest({
      caller,
      candidate_id_or_run_id: runId,
      reviewed_diff_digest: reviewedDiffDigest,
      acceptance_criteria_digest: acceptanceCriteriaDigest,
      plan_version: planVersion,
      evidence_basis: resolvedEvidence,
      track: "L",
      acceptance_criteria: acceptanceCriteria,
      context_digest: contextDigest,
      escalate: Boolean(escalateHalo || highRiskEscalation),
      high_risk: Boolean(highRiskEscalation),
      review_attempt: reviewAttempt,
      previous_verdict: previousVerdict,
    });

    let rawHalo = haloReview;
    if (!rawHalo) {
      if (typeof this.#invokeHalo !== "function") {
        throw new Error("Track L requires invokeHalo for mandatory Strix Halo review");
      }
      rawHalo = unwrapPacket(await this.#invokeHalo(reviewRequest));
      if (rawHalo?.ok === false) {
        throw new Error(`Strix Halo invocation failed: ${rawHalo.error || "FAILED"}`);
      }
    }

    const bindingCheck = validateHaloReviewBinding(rawHalo, {
      candidate_id_or_run_id: runId,
      reviewed_diff_digest: reviewedDiffDigest,
      acceptance_criteria_digest: acceptanceCriteriaDigest,
      plan_version: planVersion,
      evidence_basis: resolvedEvidence,
    });
    if (!bindingCheck.valid) {
      throw new Error(`Track L Halo review rejected: ${bindingCheck.reason}`);
    }
    if (rawHalo.verdict !== "ACCEPT") {
      throw new Error(`Track L requires Strix Halo verdict ACCEPT, received '${rawHalo.verdict}'`);
    }

    let zenVerdict = null;
    let escalatedLedgerMeta = null;
    if (highRiskEscalation) {
      if (typeof this.#invokeZen !== "function") {
        throw new Error("High-risk Track L escalation requires invokeZen handler");
      }
      const targetLedgerPath = this.ledgerPath
        ? resolve(this.ledgerPath)
        : join(this.cwd, ".ntg", "ledger.json");
      let releaseLock = null;
      if (!this.ledger) {
        releaseLock = LedgerKernel.acquireLock(targetLedgerPath, { handleSignals: false });
      }
      try {
        let durableLedger = this.ledger;
        if (!durableLedger) {
          if (existsSync(targetLedgerPath)) {
            durableLedger = LedgerKernel.load(targetLedgerPath);
          } else {
            durableLedger = new LedgerKernel({
              goal: goal || task || `Escalated Track L run ${runId}`,
              plan_version: planVersion,
              track: "S",
              milestones: [
                {
                  id: runId,
                  title: goal || task || runId,
                  objective: task || goal || `Execute ${runId}`,
                  bounded_scope: Array.isArray(boundedScope) ? [...boundedScope] : [],
                  acceptance_criteria: Array.isArray(acceptanceCriteria)
                    ? [...acceptanceCriteria]
                    : [],
                  non_goals: [],
                  dependencies: [],
                },
              ],
            });
          }
          this.ledger = durableLedger;
        }
        if (!durableLedger.milestones.some((m) => m.id === runId)) {
          durableLedger.milestones.push({
            id: runId,
            title: goal || task || runId,
            objective: task || goal || `Execute ${runId}`,
            acceptance_criteria: Array.isArray(acceptanceCriteria) ? [...acceptanceCriteria] : [],
            non_goals: [],
            dependencies: [],
            bounded_scope: Array.isArray(boundedScope) ? [...boundedScope] : [],
            coverage: [],
            verify: [],
          });
        }
        durableLedger.track = durableLedger.track || "S";
        durableLedger.assurance_badge = "ZEN_DURABLE";
        if (
          durableLedger.current_milestone === null &&
          !durableLedger.completed_milestones.includes(runId)
        ) {
          durableLedger.delegate(runId);
        }
        const candidateEvidence = !isEvidenceEmpty(resolvedEvidence)
          ? resolvedEvidence
          : Array.isArray(resolvedEvidence) || typeof resolvedEvidence === "string"
            ? resolvedEvidence
            : resolvedEvidence && typeof resolvedEvidence === "object"
              ? [resolvedEvidence]
              : [task || "completed"];
        const candidatePacket = {
          milestone_id: runId,
          plan_version: durableLedger.plan_version,
          status: "DONE",
          changes_made:
            Array.isArray(resolvedWorkerResult?.changes_made) ||
            typeof resolvedWorkerResult?.changes_made === "string"
              ? resolvedWorkerResult.changes_made
              : Array.isArray(boundedScope)
                ? [...boundedScope]
                : [],
          verification_evidence: candidateEvidence,
          unresolved_unknowns:
            Array.isArray(resolvedWorkerResult?.unresolved_unknowns) ||
            typeof resolvedWorkerResult?.unresolved_unknowns === "string"
              ? resolvedWorkerResult.unresolved_unknowns
              : [],
          scope_deviations:
            Array.isArray(resolvedWorkerResult?.scope_deviations) ||
            typeof resolvedWorkerResult?.scope_deviations === "string"
              ? resolvedWorkerResult.scope_deviations
              : [],
          candidate_artifact_ref:
            resolvedWorkerResult?.candidate_artifact_ref ??
            resolvedWorkerResult?.artifact_ref ??
            reviewedDiffDigest,
        };
        const { result_ref: escalatedResultRef, candidate_record: escalatedCandidate } =
          durableLedger.receiveCandidate(candidatePacket, { cwd: this.cwd });
        durableLedger.recordHaloReview({
          ...rawHalo,
          milestone_id: runId,
          caller: rawHalo.caller ?? caller,
        });
        durableLedger.save(targetLedgerPath);

        try {
          zenVerdict = unwrapPacket(
            await this.#invokeZen({
              milestone_id: runId,
              run_id: runId,
              result_ref: escalatedResultRef,
              track: "L",
              escalated_for_high_risk: true,
              plan_version: durableLedger.plan_version,
              task,
              bounded_scope: boundedScope,
              acceptance_criteria: acceptanceCriteria,
              candidate: escalatedCandidate,
              halo_review: rawHalo,
              ...(escalatedCandidate.delivered_tree_digest
                ? { delivered_tree_digest: escalatedCandidate.delivered_tree_digest }
                : {}),
            })
          );
        } catch (zenError) {
          if (zenError?.code !== "LEDGER_INTEGRITY" && durableLedger.current_milestone === runId) {
            durableLedger.recordBlockedOrFailure({
              milestoneId: runId,
              status: "INVOCATION_FAILURE",
              evidence: {
                classification: "OBSERVED",
                error: String(zenError?.message ?? zenError),
                result_ref: escalatedResultRef,
              },
            });
            durableLedger.save(targetLedgerPath);
          }
          throw zenError;
        }

        try {
          validateZenVerdictPacket(zenVerdict, {
            expectedMilestone: runId,
            expectedPlanVersion: durableLedger.plan_version,
            expectedResultRef: escalatedResultRef,
            expectedCriteria: acceptanceCriteria,
            candidateTreeDigest: escalatedCandidate.delivered_tree_digest ?? null,
            expectedTreeDigest: escalatedCandidate.delivered_tree_digest ?? null,
            errorClass: InvalidTransitionError,
          });
        } catch (validationError) {
          if (durableLedger.current_milestone === runId) {
            durableLedger.recordBlockedOrFailure({
              milestoneId: runId,
              status: "INVOCATION_FAILURE",
              evidence: {
                classification: "OBSERVED",
                error: String(validationError?.message ?? validationError),
                result_ref: escalatedResultRef,
              },
            });
            durableLedger.save(targetLedgerPath);
          }
          throw validationError;
        }

        if (zenVerdict.verdict === "NO-GO") {
          durableLedger.recordZenNoGo(zenVerdict);
          durableLedger.save(targetLedgerPath);
          throw new Error("High-risk Track L Zen escalation failed with verdict 'NO-GO'");
        }

        durableLedger.recordZenGo(zenVerdict, {
          expectedTreeDigest: escalatedCandidate.delivered_tree_digest,
        });
        durableLedger.save(targetLedgerPath);
        escalatedLedgerMeta = {
          escalated: true,
          ledger_path: targetLedgerPath,
          milestone_id: runId,
          result_ref: escalatedResultRef,
          zen_verdict: zenVerdict.verdict,
          assurance_badge: "ZEN_DURABLE",
          verified: true,
        };
      } finally {
        releaseLock?.();
      }
    }

    const assuranceBadge = zenVerdict ? "ZEN_DURABLE" : "HALO_LIGHTWEIGHT";
    const record = this.lightweightLog.recordRun({
      run_id: runId,
      track: "L",
      assurance_badge: assuranceBadge,
      status: "COMPLETED",
      plan_version: planVersion,
      goal: goal || task,
      caller,
      worker_role: effectiveRole,
      reviewed_diff_digest: reviewedDiffDigest,
      acceptance_criteria_digest: acceptanceCriteriaDigest,
      evidence_basis: resolvedEvidence,
      halo_review: rawHalo,
      ...(resolvedPlanningPass ? { planning_pass: resolvedPlanningPass } : {}),
      escalated_to_ledger: escalatedLedgerMeta,
    });

    return {
      track: "L",
      assurance_badge: assuranceBadge,
      run_id: runId,
      worker_role: effectiveRole,
      rerouted_from: reroutedFrom,
      reroute_reason: rerouteReason,
      ...(resolvedPlanningPass ? { planning_pass: resolvedPlanningPass } : {}),
      worker_result: resolvedWorkerResult,
      halo_review: rawHalo,
      zen_status: highRiskEscalation ? "ESCALATED" : "OMITTED",
      zen_verdict: zenVerdict,
      record,
    };
  }

  /**
   * Enforces Track S (Halo CONDITIONAL, Zen REQUIRED) and Track M (Halo REQUIRED,
   * Zen REQUIRED) gates against LedgerKernel binding and staleness rules.
   */
  async verifyTrackSMCandidate({
    track = "M",
    milestoneId,
    candidate,
    contract,
    haloReview = null,
    requireHalo = track === "M",
    invokeHalo = null,
    invokeZen = null,
    caller = "bulldozer",
    currentDiffDigest = null,
    highRisk = false,
    escalateHalo = false,
    reviewAttempt = null,
    previousVerdict = null,
  } = {}) {
    const normalizedTrack = String(track || "M").trim().toUpperCase();
    if (normalizedTrack !== "S" && normalizedTrack !== "M") {
      throw new Error(`verifyTrackSMCandidate accepts Track S or M only, got '${track}'`);
    }
    if (!milestoneId || !contract) {
      throw new Error("verifyTrackSMCandidate requires milestoneId and contract");
    }

    const planVersion = contract.plan_version ?? this.ledger?.plan_version ?? "v1";
    const expectedDiffDigest =
      currentDiffDigest ?? computeDiffDigest(contract.bounded_scope ?? [], { cwd: this.cwd });
    const expectedCriteriaDigest = computeAcceptanceDigest(contract.acceptance_criteria ?? []);
    const candidateRef =
      candidate?.candidate_artifact_ref ?? candidate?.artifact_ref ?? candidate?.result_ref ?? milestoneId;
    const expectedResultRef =
      candidate?.result_ref ?? candidate?.candidate_artifact_ref ?? candidate?.artifact_ref ?? milestoneId;
    const expectedEvidenceBasis = candidate?.verification_evidence ?? [];
    const expectedTreeDigest = currentDiffDigest ?? candidate?.delivered_tree_digest ?? null;

    let activeHalo = null;
    const haloFn = invokeHalo ?? this.#invokeHalo;
    if (requireHalo || haloReview) {
      let rawHalo = haloReview;
      if (!rawHalo && typeof haloFn === "function") {
        const req = buildHaloReviewRequest({
          caller,
          candidate_id_or_run_id: candidateRef,
          reviewed_diff_digest: expectedDiffDigest,
          acceptance_criteria_digest: expectedCriteriaDigest,
          plan_version: planVersion,
          evidence_basis: expectedEvidenceBasis,
          track: normalizedTrack,
          acceptance_criteria: contract.acceptance_criteria ?? [],
          escalate: Boolean(escalateHalo || highRisk),
          high_risk: Boolean(highRisk),
          review_attempt: reviewAttempt,
          previous_verdict: previousVerdict,
        });
        rawHalo = unwrapPacket(await haloFn(req));
        if (rawHalo?.ok === false) {
          throw new Error(`Strix Halo invocation failed: ${rawHalo.error || "FAILED"}`);
        }
      }
      if (!rawHalo && requireHalo) {
        throw new Error(`Track ${normalizedTrack} requires a fresh bound Strix Halo ACCEPT review`);
      }
      if (rawHalo) {
        if (typeof rawHalo !== "object" || Array.isArray(rawHalo)) {
          throw new Error(`Halo review for '${milestoneId}' rejected: response must be an object`);
        }
        const normalizedPacket = {
          milestone_id: rawHalo.milestone_id ?? milestoneId,
          caller: rawHalo.caller ?? caller,
          candidate_id_or_run_id: rawHalo.candidate_id_or_run_id,
          reviewed_diff_digest: rawHalo.reviewed_diff_digest,
          acceptance_criteria_digest: rawHalo.acceptance_criteria_digest,
          plan_version: rawHalo.plan_version,
          evidence_basis: rawHalo.evidence_basis,
          verdict: rawHalo.verdict,
          findings: rawHalo.findings ?? [],
          is_stale: rawHalo.is_stale === true,
        };
        const expectedBinding = {
          candidate_id_or_run_id: candidateRef,
          reviewed_diff_digest: expectedDiffDigest,
          acceptance_criteria_digest: expectedCriteriaDigest,
          plan_version: planVersion,
          evidence_basis: expectedEvidenceBasis,
        };
        if (this.ledger) {
          this.ledger.recordHaloReview(normalizedPacket);
          const fresh = this.ledger.isHaloReviewFresh(milestoneId, expectedBinding);
          if (!fresh.fresh) {
            throw new Error(`Halo review for '${milestoneId}' rejected: ${fresh.reason}`);
          }
          activeHalo = fresh.review;
        } else {
          const check = validateHaloReviewBinding(normalizedPacket, expectedBinding);
          if (!check.valid || normalizedPacket.verdict !== "ACCEPT") {
            throw new Error(
              `Halo review for '${milestoneId}' rejected: ${check.reason ?? normalizedPacket.verdict}`
            );
          }
          activeHalo = normalizedPacket;
        }
      }
    }

    const zenFn = invokeZen ?? this.#invokeZen;
    if (typeof zenFn !== "function") {
      throw new Error(
        `Track ${normalizedTrack} requires Zen summative verification; Halo ACCEPT cannot promote a durable milestone`
      );
    }

    const zenVerdict = unwrapPacket(
      await zenFn({
        milestone_id: milestoneId,
        plan_version: planVersion,
        result_ref: expectedResultRef,
        track: normalizedTrack,
        candidate,
        contract,
        halo_review: activeHalo,
        ...(expectedTreeDigest ? { delivered_tree_digest: expectedTreeDigest } : {}),
      })
    );

    validateZenVerdictPacket(zenVerdict, {
      expectedMilestone: milestoneId,
      expectedPlanVersion: planVersion,
      expectedResultRef,
      expectedCriteria: contract.acceptance_criteria ?? [],
      candidateTreeDigest: candidate?.delivered_tree_digest ?? null,
      expectedTreeDigest,
      noGoErrorClass: InvalidHandoffPacketError,
    });

    return {
      track: normalizedTrack,
      assurance_badge: "ZEN_DURABLE",
      milestone_id: milestoneId,
      halo_status: activeHalo ? "ACCEPTED" : "OMITTED",
      halo_review: activeHalo,
      zen_verdict: zenVerdict,
      verified: zenVerdict.verdict === "GO",
    };
  }
}
