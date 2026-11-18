import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";

import {
  AuthoritativeLedger,
  InvalidTransitionError,
  StaleVerdictError,
  computeDeliveredTreeDigest,
  deepClone,
  deepFreeze,
  isEvidenceEmpty,
  normalizeCandidateArtifactRef,
  validateZenVerdictPacket,
} from "../core/ledger-kernel.mjs";
import { LedgerIntegrityError, acquireLedgerLock } from "../core/lock-manager.mjs";
import { LightweightLog } from "../core/lightweight-log.mjs";
import {
  AuthorityExpansionError,
  ModelRouter,
  UnresolvedModelSlugError,
  getRoleAuthority,
  normalizeRoleName,
  realAgyRefusalUnderNodeTest,
  resolveSlug,
} from "../core/model-router.mjs";
import {
  analyzeWorkSemantics,
  buildContextDigest,
  buildHaloReviewRequest,
  composeModelAwareHarness,
  evaluateLightweightSuitability,
  validateLightweightResult,
} from "../harness/index.mjs";
import {
  buildScopeMap,
  checkCoverageTable,
  checkTestIntegrity,
  isPathInScope,
  runCoverageProbes,
  scopeChanges,
  snapshotScope,
  snapshotTestIntegrity,
} from "../../scripts/coverage.mjs";
import {
  InvalidHandoffPacketError,
  InvalidResponseFormatError,
  invoke,
  loadNativeRoleBody,
  parseResponseEnvelope,
  parseResponsePacket,
} from "../../scripts/runner.mjs";
import {
  projectFailureRecord,
  projectFailureTelemetry,
  redactTelemetryValue,
} from "../../scripts/telemetry.mjs";
import { TrackRunner } from "./track-runner.mjs";

const NEEDS_ALT_MIN_ATTEMPTS = 3;
const MAX_HANDOFF_CORRECTIONS = 2;

export const SALVAGEABLE_ERRORS = Object.freeze([
  "TURN_ENDED_EARLY",
  "MODEL_ERROR",
  "EXECUTION_FAILED",
  "TIMEOUT",
  "BACKGROUND_TASK_PENDING",
  "TOOL_PERMISSION_DENIED",
]);

export const SALVAGE_TIMEOUT_MS = 600_000;
export const SALVAGE_MAX_CALLS = 25;

const SALVAGE_INSTRUCTION =
  "The previous Bulldozer session for this milestone ended early (transport failure) " +
  "after producing changes. You are in packet-only salvage mode: do not dispatch any worker and do not " +
  "edit any file — both are denied by the supervisor. Using only the milestone contract, the salvage " +
  "change summary and the verify results below, return the complete result JSON packet for the " +
  "already-completed work, binding the actual delivered artifacts in candidate_artifact_ref. Anything " +
  "you cannot attest from this material goes to unresolved_unknowns as UNKNOWN. Do not invoke Zen, " +
  "write the ledger or claim global completion.";

export const STRIX_FLAG_ENV = "NTG_STRIX";

/** True when the Strix Halo advisor gate is enabled for this run. */
export function advisorGateEnabled(env = process.env, { track = null } = {}) {
  const normalizedTrack = String(track ?? "").trim().toUpperCase();
  if (normalizedTrack === "M" || normalizedTrack === "L") return true;
  const raw = String(env?.[STRIX_FLAG_ENV] ?? "").trim().toLowerCase();
  if (["0", "off", "false"].includes(raw)) return false;
  return true;
}

export const MAX_REPAIR_ATTEMPTS = 2;

function failureClassOf(milestoneId, entry) {
  return `${milestoneId}:${entry?.status ?? "unknown"}:${entry?.evidence?.failed_step?.tool ?? "unknown"}`;
}

function failureSignatureOf(entry) {
  return `sha256:${createHash("sha256").update(JSON.stringify(entry?.evidence ?? null)).digest("hex")}`;
}

export function zenNoGoSignature(record) {
  return failureSignatureOf({
    evidence: {
      verification_evidence: record?.verification_evidence ?? null,
      repair_needs: record?.repair_needs ?? null,
    },
  });
}

export function decideRepairAction({
  noGoRecords = [],
  repairsUsed = 0,
  maxRepairs = MAX_REPAIR_ATTEMPTS,
} = {}) {
  if (!Number.isInteger(repairsUsed) || repairsUsed < 0) {
    throw new TypeError("repairsUsed must be a non-negative integer");
  }
  if (repairsUsed >= maxRepairs) {
    return {
      action: "ASK_USER",
      reason: `repair budget of ${maxRepairs} exhausted`,
      repeatedSignature: false,
    };
  }
  if (repairsUsed === 0) {
    return {
      action: "REPAIR",
      reason: "first automatic repair after NO-GO",
      repeatedSignature: false,
    };
  }
  const latest = noGoRecords.at(-1);
  const previous = noGoRecords.at(-2);
  const repeatedSignature =
    Boolean(latest && previous) && zenNoGoSignature(latest) === zenNoGoSignature(previous);
  return repeatedSignature
    ? {
        action: "ASK_USER",
        reason: "the NO-GO signature repeated: the repair produced no new evidence",
        repeatedSignature: true,
      }
    : {
        action: "REPAIR",
        reason: "the new NO-GO signature differs: one more repair is allowed",
        repeatedSignature: false,
      };
}

export function repairStopQuestion(
  milestoneId,
  { repairsUsed = 0, repeatedSignature = false } = {}
) {
  const why = repeatedSignature
    ? "수리 뒤에도 젠이 같은 이유로 계속 불합격을 주었습니다"
    : `자동 수리 ${repairsUsed}번으로는 해결되지 않았습니다`;
  return (
    `마일스톤 '${milestoneId}'이(가) ${why}. 어떻게 할까요? ` +
    "1) 계획을 고쳐 다시 시도(replan)  2) 젠의 지적(repair_needs)을 직접 확인한 뒤 처리  3) 이 작업을 중단"
  );
}

const REPAIR_INSTRUCTION_BASE =
  "The Zen reviewer returned NO-GO for this milestone's delivered candidate. " +
  "Perform a targeted repair using the packet's repair findings: fix the named defects " +
  "without re-executing completed work, and keep every change inside bounded_scope. " +
  "Return your own JSON result packet binding the actual delivered artifacts in " +
  "candidate_artifact_ref; anything you cannot attest goes to unresolved_unknowns as UNKNOWN. ";

function declaredChangePaths(changesMade) {
  const entries = Array.isArray(changesMade) ? changesMade : [changesMade];
  const paths = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      if (!/\s/.test(entry) && (entry.includes("/") || /\.[A-Za-z0-9]+$/.test(entry))) {
        paths.push(entry);
      }
    } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const path = entry.file ?? entry.path ?? entry.filename;
      if (typeof path === "string" && path.trim()) paths.push(path);
    }
  }
  return paths;
}

/**
 * Single source of truth for NEEDS_ALT stagnation detection across status
 * reporting and autonomous Instinct recovery (#234).
 */
export function recommendNeedsAlt(evidence, verificationHistory = []) {
  const byClass = new Map();
  const add = (failure_class, milestoneId, entry) => {
    if (!byClass.has(failure_class)) byClass.set(failure_class, []);
    byClass.get(failure_class).push({ milestoneId, entry });
  };
  for (const [milestoneId, value] of Object.entries(evidence ?? {})) {
    if (!value || typeof value !== "object" || !Array.isArray(value.failure_evidence)) continue;
    for (const entry of value.failure_evidence) {
      add(failureClassOf(milestoneId, entry), milestoneId, entry);
    }
  }
  for (const record of Array.isArray(verificationHistory) ? verificationHistory : []) {
    if (record?.verdict !== "NO-GO" || record.is_stale || typeof record.milestone_id !== "string") {
      continue;
    }
    add(`${record.milestone_id}:NO-GO:zen`, record.milestone_id, {
      status: "NO-GO",
      timestamp: record.timestamp ?? null,
      evidence: {
        verification_evidence: record.verification_evidence ?? null,
        repair_needs: record.repair_needs ?? null,
      },
    });
  }
  const summaries = [];
  for (const [failure_class, attempts] of byClass) {
    const signatures = attempts.map(({ entry }) => failureSignatureOf(entry));
    const latest = signatures[signatures.length - 1];
    const latest_attempt_new_evidence = !signatures.slice(0, -1).includes(latest);
    const last = attempts[attempts.length - 1];
    summaries.push({
      failure_class,
      failure_signature: latest,
      milestone_id: last.milestoneId,
      status: last.entry?.status ?? null,
      tool: last.entry?.evidence?.failed_step?.tool ?? null,
      attempt_count: attempts.length,
      latest_attempt_new_evidence,
      needs_alt_recommended: attempts.length >= NEEDS_ALT_MIN_ATTEMPTS && !latest_attempt_new_evidence,
      attempts: attempts.map(({ milestoneId, entry }) => projectFailureRecord(entry, milestoneId)),
    });
  }
  return summaries;
}

function selectAltTarget(summaries, milestoneId) {
  const scoped = (milestoneId ? summaries.filter((s) => s.milestone_id === milestoneId) : summaries)
    .slice()
    .sort((a, b) =>
      String(a.attempts.at(-1)?.timestamp ?? "").localeCompare(
        String(b.attempts.at(-1)?.timestamp ?? "")
      )
    );
  const recommended = scoped.filter((s) => s.needs_alt_recommended);
  return recommended[recommended.length - 1] ?? scoped[scoped.length - 1] ?? null;
}

/**
 * Interactive AGY Steamroller Runtime Control Plane (NTG 2.0):
 * - Top-level orchestration owner for Track L, S, and M execution (#234)
 * - Semantic capability/effect routing for Jaguar / Puma / Bobcat / Bulldozer (#235)
 * - Capability-only dynamic model routing strictly decoupled from role permissions
 * - Cross-caller Strix Halo quality gate & unified fail-closed Zen verification (#232, #233)
 * - Bounded recovery via Bulldozer (Hydrogen XHigh) + on-demand Instinct (NEEDS_ALT)
 */
export class SteamrollerController {
  #ledger = null;
  #track = null;
  #invokeRole;
  #invokeSpecialist;
  #invokeHalo;
  #invokeZen;
  #runnerOptions;
  #explicitCwd = false;
  #busy = false;
  #releaseLock = undefined;
  #closed = false;
  #pendingHaloReviews = new Map();

  constructor({
    ledger = null,
    ledgerPath = null,
    lightweightLog = null,
    lightweightLogPath = null,
    modelRouter = null,
    trackRunner = null,
    plan = undefined,
    track = null,
    invokeRole = null,
    invokeSpecialist = null,
    invokeHalo = null,
    invokeZen = null,
    runnerOptions = {},
    handleSignals = true,
    acquireLock = false,
    spine = null,
    cwd = null,
  } = {}) {
    if (track !== null && track !== undefined) {
      const normalizedTrack = String(track).trim().toUpperCase();
      if (!["S", "M"].includes(normalizedTrack)) {
        throw new Error(`MinimalSpine supports durable tracks S or M only, got '${track}'`);
      }
      this.#track = normalizedTrack;
    }

    this.ledgerPath = ledgerPath ?? null;
    const resolvedLogPath =
      lightweightLogPath ??
      (ledgerPath
        ? join(dirname(resolve(ledgerPath)), "lightweight-runs.jsonl")
        : ".ntg/lightweight-runs.jsonl");
    this.lightweightLog = lightweightLog ?? new LightweightLog(resolvedLogPath);
    this.modelRouter = modelRouter ?? new ModelRouter(runnerOptions ?? {});
    this.#invokeRole = invokeRole;
    this.#invokeSpecialist = invokeSpecialist;
    this.#invokeHalo = invokeHalo;
    this.#invokeZen = invokeZen;
    this.#runnerOptions = runnerOptions ?? {};
    this.#explicitCwd = Boolean(cwd ?? this.#runnerOptions.coverageCwd);
    this.cwd = cwd ?? this.#runnerOptions.coverageCwd ?? process.cwd();
    this.spine = spine ?? this;

    this.trackRunner =
      trackRunner ??
      new TrackRunner({
        ledger: null,
        ledgerPath: this.ledgerPath,
        lightweightLog: this.lightweightLog,
        invokeWorker: invokeSpecialist ?? invokeRole ?? invoke,
        invokeHalo: (req) => this.#invokeHaloGate(req),
        invokeZen: this.#invokeZen,
        cwd: this.cwd,
      });

    if (ledger) {
      this.ledger = ledger;
    }

    if (acquireLock || plan !== undefined) {
      this.openLedger({ ledgerPath: this.ledgerPath, plan, track: this.#track, handleSignals });
    }
  }

  get ledger() {
    return this.#ledger;
  }

  set ledger(value) {
    this.#ledger = value ?? null;
    if (this.trackRunner) {
      this.trackRunner.ledger = this.#ledger;
    }
  }

  get state() {
    if (!this.#ledger) {
      throw new Error("Controller ledger is not open");
    }
    return deepFreeze(deepClone(this.#ledger.getState()));
  }

  /**
   * Acquires the ledger lock and initializes or loads the authoritative ledger
   * for durable Track S/M execution or supervisor state commands (#234).
   */
  openLedger({ ledgerPath = this.ledgerPath, plan = undefined, track = this.#track, handleSignals = true } = {}) {
    if (typeof ledgerPath !== "string" || !ledgerPath.trim()) {
      throw new TypeError("A supervisor-owned ledgerPath is required");
    }
    if (this.#releaseLock) {
      return this;
    }
    if (track !== null && track !== undefined) {
      const normalized = String(track).trim().toUpperCase();
      if (!["S", "M"].includes(normalized)) {
        throw new Error(`MinimalSpine supports durable tracks S or M only, got '${track}'`);
      }
      this.#track = normalized;
    }
    this.ledgerPath = ledgerPath;
    this.trackRunner.ledgerPath = ledgerPath;
    this.#closed = false;
    this.#releaseLock = acquireLedgerLock(ledgerPath, { handleSignals });
    try {
      if (plan !== undefined) {
        if (existsSync(ledgerPath)) throw new Error("Refusing to replace an existing ledger");
        const effectivePlan = this.#track ? { ...plan, track: this.#track } : plan;
        this.ledger = new AuthoritativeLedger(effectivePlan);
        this.ledger.save(this.ledgerPath);
      } else {
        this.ledger = AuthoritativeLedger.load(ledgerPath);
        if (this.#track && this.ledger.track !== this.#track) {
          this.ledger.track = this.#track;
          this.ledger.assurance_badge = "ZEN_DURABLE";
          this.ledger.save(this.ledgerPath);
        } else if (!this.#track && this.ledger.track) {
          this.#track = this.ledger.track;
        }
      }
    } catch (error) {
      this.close();
      throw error;
    }
    this.spine = this;
    return this;
  }

  /** Explicitly end ownership before another supervisor resumes this ledger. */
  close() {
    if (this.#busy) throw new Error("Cannot close during an active invocation");
    this.#releaseLock?.();
    this.#releaseLock = undefined;
    this.#closed = true;
  }

  #open() {
    if (this.#closed || (!this.#releaseLock && !this.#ledger)) {
      throw new Error("Spine is closed");
    }
    if (this.ledgerPath && !this.#releaseLock) {
      throw new Error("Spine is closed");
    }
  }

  #idle() {
    this.#open();
    if (this.#busy || this.state.current_milestone !== null) {
      throw new Error("Execution or review is already active");
    }
  }

  /**
   * Binds an external ledger or controller target while keeping TrackRunner synced.
   */
  bindSpine(spine) {
    this.spine = spine;
    if (spine?.ledger) {
      this.ledger = spine.ledger;
    }
    if (this.ledgerPath) {
      this.trackRunner.ledgerPath = this.ledgerPath;
    }
    return this;
  }

  setTrack(track) {
    this.#idle();
    if (track === null || track === undefined) return this.#track;
    const normalized = String(track).trim().toUpperCase();
    if (!["S", "M"].includes(normalized)) {
      throw new Error(`MinimalSpine supports durable tracks S or M only, got '${track}'`);
    }
    this.#track = normalized;
    this.#ledger.track = normalized;
    this.#ledger.assurance_badge = "ZEN_DURABLE";
    this.#saveLedger();
    return normalized;
  }

  #saveLedger() {
    if (this.ledgerPath && this.#ledger) {
      this.#ledger.save(this.ledgerPath);
    }
  }

  #resolveScopeCwd(boundedScope) {
    if (this.#explicitCwd) {
      return this.cwd;
    }
    const scope = Array.isArray(boundedScope) ? boundedScope : [];
    const hasScopedFiles = (candidateCwd) =>
      Object.keys(snapshotScope(scope, { cwd: candidateCwd }).files).length > 0;
    if (scope.length > 0 && hasScopedFiles(this.cwd)) {
      return this.cwd;
    }
    if (this.ledgerPath) {
      const ledgerDir = dirname(resolve(this.ledgerPath));
      if (scope.length > 0 && hasScopedFiles(ledgerDir)) {
        return ledgerDir;
      }
      if (basename(ledgerDir) === ".ntg") {
        const parentDir = dirname(ledgerDir);
        if (scope.length > 0 && hasScopedFiles(parentDir)) {
          return parentDir;
        }
      }
    }
    return this.cwd;
  }

  /**
   * Autonomously classifies incoming work into Track L, S, or M by semantic
   * capability, effect scope, and risk rather than isolated lexical triggers (#235).
   */
  classifyTrack({
    task = "",
    targetFiles = [],
    milestoneCount = 1,
    highRisk = false,
    requiresMutation = undefined,
    requiresShell = false,
    requiresSubstantiveCode = false,
    isMechanicalEdit = undefined,
    crossFileDependency = false,
    requiresCoordinator = false,
    riskClass = null,
    trackOverride = null,
  } = {}) {
    if (trackOverride !== null && trackOverride !== undefined) {
      const normalized = String(trackOverride).trim().toUpperCase();
      if (!["L", "S", "M"].includes(normalized)) {
        throw new Error(`Invalid track '${trackOverride}': expected L, S, or M`);
      }
      return {
        track: normalized,
        assurance_badge: normalized === "L" ? "HALO_LIGHTWEIGHT" : "ZEN_DURABLE",
        auto_classified: false,
        reason: "explicit_override",
      };
    }

    const semantics = analyzeWorkSemantics({
      task,
      targetFiles,
      milestoneCount,
      requiresMutation,
      requiresShell,
      requiresSubstantiveCode,
      isMechanicalEdit,
      crossFileDependency,
      requiresCoordinator,
      highRisk,
      riskClass,
    });

    const reason =
      milestoneCount > 1
        ? "multi-milestone scope"
        : semantics.needsCoordinator
          ? "cross-cutting or coordinator-grade task"
          : semantics.recommendedTrack === "S"
            ? semantics.highRisk
              ? "high-risk verification requirement"
              : "substantive stateful or multi-file implementation scope"
            : semantics.isReadOnlyDiscovery
              ? "read-only factual discovery"
              : "bounded low-risk mechanical or single-step change";

    return {
      track: semantics.recommendedTrack,
      assurance_badge: semantics.recommendedTrack === "L" ? "HALO_LIGHTWEIGHT" : "ZEN_DURABLE",
      auto_classified: true,
      reason,
      semantics,
    };
  }

  /**
   * Resolves a role's model slug without ever permitting role authority expansion.
   */
  resolveRoleModel(role, options = {}) {
    const normalized = normalizeRoleName(role);
    const forbiddenFields = [
      "canMutateProjectFiles",
      "canRunCommand",
      "allowedDelegations",
      "canInvokeZen",
      "canWriteLedger",
      "readOnly",
      "bypassSafetyGuard",
      "skipZen",
    ];
    for (const field of forbiddenFields) {
      if (field in options && options[field] !== undefined) {
        throw new AuthorityExpansionError(
          normalized,
          `Dynamic model routing cannot alter immutable authority field '${field}'`,
          { field }
        );
      }
    }
    return this.modelRouter.resolve(normalized, options);
  }

  /**
   * Selects direct/lightweight worker (Jaguar/Puma/Bobcat) or Bulldozer (Hydrogen XHigh)
   * by semantic work kind and required capability rather than lexical/file-count heuristics (#235).
   */
  selectWorkerRoute({
    track = "S",
    task = "",
    targetFiles = [],
    preferredRole = null,
    requiresMutation = undefined,
    requiresShell = false,
    requiresSubstantiveCode = false,
    isMechanicalEdit = undefined,
    crossFileDependency = false,
    requiresCoordinator = false,
    highRisk = false,
    riskClass = null,
    recoveryMode = false,
    modelOverrides = {},
    resolveModel = true,
  } = {}) {
    const pick = (role, extra = {}) => {
      let slug = null;
      if (resolveModel) {
        try {
          slug = this.resolveRoleModel(role, {
            modelOverride: modelOverrides?.[role],
          }).slug;
        } catch (error) {
          if (
            resolveModel === "best_effort" &&
            !(error instanceof AuthorityExpansionError) &&
            (error instanceof UnresolvedModelSlugError ||
              /Unresolved model slug|Failed to list installed models|refusing to spawn/i.test(
                String(error?.message ?? error)
              ))
          ) {
            slug = null;
          } else {
            throw error;
          }
        }
      }
      return {
        role,
        slug,
        authority: getRoleAuthority(role),
        reroutedFrom: null,
        signal: null,
        reason: null,
        ...extra,
      };
    };

    const semantics = analyzeWorkSemantics({
      task,
      targetFiles,
      milestoneCount: 1,
      requiresMutation,
      requiresShell,
      requiresSubstantiveCode,
      isMechanicalEdit,
      crossFileDependency,
      requiresCoordinator,
      recoveryMode,
      highRisk,
      riskClass,
    });

    if (
      recoveryMode ||
      (String(track).toUpperCase() === "M" &&
        (!preferredRole ||
          targetFiles.length > 2 ||
          semantics.needsCoordinator ||
          requiresCoordinator ||
          crossFileDependency))
    ) {
      return pick("bulldozer", {
        semantics,
        reason: recoveryMode
          ? "Bulldozer (Hydrogen XHigh) leads primary failure recovery"
          : "Track M milestone complexity routes to Bulldozer (Hydrogen XHigh)",
      });
    }

    if (preferredRole) {
      const normalizedPref = normalizeRoleName(preferredRole);
      if (["jaguar", "puma"].includes(normalizedPref)) {
        const suitability = evaluateLightweightSuitability({
          role: normalizedPref,
          task,
          targetFiles,
          requiresMutation,
          requiresShell,
          requiresSubstantiveCode,
          isMechanicalEdit,
          crossFileDependency,
          requiresCoordinator,
          highRisk,
          riskClass,
        });
        if (!suitability.suitable && suitability.rerouteTo) {
          return pick(suitability.rerouteTo, {
            reroutedFrom: normalizedPref,
            signal: "REROUTE_REQUIRED",
            reason: suitability.reason,
            semantics,
          });
        }
      }
      return pick(normalizedPref, { semantics });
    }

    return pick(semantics.recommendedRole, {
      semantics,
      reason:
        semantics.recommendedRole === "jaguar"
          ? "Read-only factual discovery routes to Jaguar"
          : semantics.recommendedRole === "puma"
            ? "Small reversible doc/config/mechanical edit routes to Puma"
            : semantics.recommendedRole === "bulldozer"
              ? "Cross-cutting or coordinator-grade work routes to Bulldozer"
              : "Substantive code/state/test implementation routes to Bobcat",
    });
  }

  /**
   * Requests a cross-caller Strix Halo quality review on behalf of Steamroller,
   * Bulldozer, or Bobcat and optionally records it in LedgerKernel.
   */
  async requestHaloReview({
    caller = "steamroller",
    track = "M",
    milestoneId = null,
    candidate_id_or_run_id,
    reviewed_diff_digest,
    acceptance_criteria_digest,
    plan_version,
    evidence_basis = [],
    acceptance_criteria = [],
    context_digest = null,
    invokeHalo = null,
  } = {}) {
    const request = buildHaloReviewRequest({
      caller,
      candidate_id_or_run_id,
      reviewed_diff_digest,
      acceptance_criteria_digest,
      plan_version,
      evidence_basis,
      track,
      acceptance_criteria,
      context_digest,
    });
    const handler =
      invokeHalo ??
      this.#invokeHalo ??
      (this.#invokeSpecialist
        ? (req) => this.#invokeSpecialist("strix-halo", req, { caller: req.caller })
        : this.#invokeRole
          ? (req) =>
              this.#invokeRole(
                "strix-halo",
                {
                  task:
                    "Review the candidate diff and acceptance criteria and return a bare JSON Halo review packet with verdict ACCEPT, REVISE, or ESCALATE.\n" +
                    JSON.stringify(req),
                  ...req,
                },
                { caller: req.caller }
              )
          : null);
    if (typeof handler !== "function") {
      throw new Error("No Strix Halo handler available");
    }
    const review = await handler(request);
    if (this.ledger && String(track).toUpperCase() !== "L" && milestoneId) {
      return this.ledger.recordHaloReview({
        ...review,
        milestone_id: milestoneId,
        caller: request.caller,
        ...(review?.plan_version !== undefined ? { plan_version: review.plan_version } : {}),
      });
    }
    return review;
  }

  /**
   * Runs bounded milestone recovery via Bulldozer (Hydrogen XHigh) + on-demand
   * Instinct (Claude Sonnet 5.5 High / Opus 5.5 High escalated), unified with
   * recommendNeedsAlt and bounded by LedgerKernel's hard safety cap (#234).
   */
  async recoverMilestone({
    milestoneId,
    failureReason = "",
    invokeBulldozer = null,
    invokeInstinct = null,
    triggerInstinct = false,
    escalateInstinct = false,
    previousSignatures = [],
    evidence = [],
  } = {}) {
    if (!this.ledger) {
      throw new Error("SteamrollerController.recoverMilestone requires a LedgerKernel instance");
    }
    const attemptInfo = this.ledger.recordRecoveryAttempt(milestoneId);
    const bulldozerRoute = this.resolveRoleModel("bulldozer");

    const altSummaries = recommendNeedsAlt(this.ledger.evidence, this.ledger._verification_history);
    const matchingAlt = altSummaries.find((s) => s.milestone_id === milestoneId);
    const repeatedStagnation =
      attemptInfo.attempt >= 2 ||
      Boolean(matchingAlt?.needs_alt_recommended) ||
      (Array.isArray(previousSignatures) && previousSignatures.length >= 2) ||
      /stagnat|repeated|same[- ]class/i.test(String(failureReason));
    const shouldInvokeInstinct = Boolean(triggerInstinct || repeatedStagnation);

    let instinctAdvice = null;
    let instinctRoute = null;
    const instinctFn =
      invokeInstinct ??
      (this.#invokeRole ? (packet, opts) => this.#invokeRole("instinct", packet, opts) : null);

    if (shouldInvokeInstinct && typeof instinctFn === "function") {
      instinctRoute = this.resolveRoleModel("instinct", { escalate: escalateInstinct });
      instinctAdvice = await instinctFn(
        {
          milestone_id: milestoneId,
          failure_reason: failureReason,
          attempt: attemptInfo.attempt,
          evidence,
        },
        { slug: instinctRoute.slug }
      );
      this.ledger.recordAltAdvice({
        milestone_id: milestoneId,
        task: failureReason,
        needs_alt: {
          attempt: attemptInfo.attempt,
          failure_reason: failureReason,
          failure_class: matchingAlt?.failure_class ?? null,
          failure_signature: matchingAlt?.failure_signature ?? null,
        },
        advice: instinctAdvice,
      });
    }

    const bulldozerFn =
      invokeBulldozer ??
      (this.#invokeRole ? (packet, opts) => this.#invokeRole("bulldozer", packet, opts) : null);
    if (typeof bulldozerFn !== "function") {
      throw new Error("SteamrollerController.recoverMilestone requires invokeBulldozer or invokeRole");
    }

    const bulldozerResult = await bulldozerFn(
      {
        milestone_id: milestoneId,
        mode: "RECOVERY",
        attempt: attemptInfo.attempt,
        max_recovery_retries: attemptInfo.max_recovery_retries,
        failure_reason: failureReason,
        instinct_advice: instinctAdvice,
        evidence,
      },
      { slug: bulldozerRoute.slug }
    );

    return {
      milestone_id: milestoneId,
      recovery_lead: "bulldozer",
      bulldozer_slug: bulldozerRoute.slug,
      attempt: attemptInfo.attempt,
      max_recovery_retries: attemptInfo.max_recovery_retries,
      instinct_invoked: Boolean(instinctAdvice !== null),
      instinct_slug: instinctRoute?.slug ?? null,
      instinct_advice: instinctAdvice,
      bulldozer_result: bulldozerResult,
    };
  }

  /**
   * Executes a tactical replan via LedgerKernel (preserving goal/invariants while
   * bumping plan_version and marking prior Zen GO / Halo verdicts STALE).
   */
  tacticalReplan(newPlanData) {
    if (!this.ledger) {
      throw new Error("SteamrollerController.tacticalReplan requires a LedgerKernel instance");
    }
    if (this.#releaseLock) {
      this.#idle();
    }
    const transition = this.ledger.tacticalReplan(newPlanData);
    this.#saveLedger();
    return transition;
  }

  /**
   * Executes a Track L lightweight task through Steamroller semantic routing and TrackRunner.
   */
  async runTrackL(options = {}) {
    const hasExplicitModels = Boolean(this.modelRouter?.defaultOpts?.installedModels);
    const blockedByTestRefusal =
      !hasExplicitModels &&
      Boolean(realAgyRefusalUnderNodeTest(this.modelRouter?.defaultOpts?.agyPath));
    const route = this.selectWorkerRoute({
      track: "L",
      task: options.task || options.goal || "",
      targetFiles: options.boundedScope || [],
      preferredRole: options.workerRole || null,
      requiresMutation: options.requiresMutation,
      requiresShell: Boolean(options.requiresShell),
      requiresSubstantiveCode: Boolean(options.requiresSubstantiveCode),
      isMechanicalEdit: options.isMechanicalEdit,
      crossFileDependency: Boolean(options.crossFileDependency),
      requiresCoordinator: Boolean(options.requiresCoordinator),
      highRisk: Boolean(options.highRiskEscalation ?? options.highRisk),
      riskClass: options.riskClass ?? null,
      resolveModel: !blockedByTestRefusal,
    });
    return this.trackRunner.runTrackL({
      ...options,
      workerRole: route.role,
      modelSlug: route.slug,
    });
  }

  async #step(failedStep, thunk) {
    try {
      return await thunk();
    } catch (error) {
      if (error && typeof error === "object" && error.failedStep === undefined) {
        error.failedStep = failedStep;
      }
      throw error;
    }
  }

  #transportCommand(role, slug) {
    const parts = ["agy", "--model", slug ?? "<unresolved>", "--output-format", "json"];
    if (role === "navi") parts.push("--dangerously-skip-permissions");
    if (role === "bulldozer") parts.push("--dangerously-skip-permissions");
    parts.push("--print", "(prompt withheld)");
    return parts.join(" ");
  }

  async #exact(role, instruction, contract, invokeOptions = {}) {
    const roleInvoker = this.#invokeRole ?? invoke;
    const output = await this.#step(
      { tool: "runner.invoke", args: { role } },
      () =>
        roleInvoker(
          role,
          {
            task: instruction + "\n" + JSON.stringify(contract),
          },
          {
            ...this.#runnerOptions,
            ...invokeOptions,
            invokeSpecialist: (r, s, o) => this.invokeSpecialist(r, s, o),
          }
        )
    );
    if (!output?.ok) {
      const error = new Error(`${role} invocation failed: ${JSON.stringify(output)}`);
      error.failedStep = {
        tool: "runner.invoke",
        args: { role, slug: output?.slug ?? null, error: output?.error ?? null },
        command: this.#transportCommand(role, output?.slug),
      };
      error.invocationOutput = output;
      throw error;
    }
    const parsed = parseResponsePacket(output);
    if (!parsed.ok) {
      const error = new Error(`${role} invocation failed: ${JSON.stringify(parsed)}`);
      error.failedStep = {
        tool: "runner.invoke",
        args: { role, slug: parsed?.slug ?? null, error: parsed?.error ?? null },
      };
      error.invocationOutput = parsed;
      throw error;
    }
    return parsed.packet;
  }

  /**
   * Bounded specialist routing under an active milestone:
   * - Jaguar (retrieval), Puma (mechanical), Bobcat (implementation), Strix Halo (formative review).
   */
  async invokeSpecialist(roleOrOpts, maybeSlice, maybeOptions = {}) {
    this.#open();
    let role;
    let slice;
    let options;
    if (
      typeof roleOrOpts === "object" &&
      roleOrOpts !== null &&
      !Array.isArray(roleOrOpts) &&
      maybeSlice === undefined
    ) {
      role = roleOrOpts.role;
      slice = roleOrOpts.slice ?? roleOrOpts.packet ?? roleOrOpts.task ?? {};
      options = roleOrOpts;
    } else {
      role = roleOrOpts;
      slice = maybeSlice ?? {};
      options = maybeOptions ?? {};
    }
    const caller = typeof options === "string" ? options : (options?.caller ?? "bulldozer");

    const activeMilestoneId = this.state.current_milestone;
    if (activeMilestoneId === null) {
      throw new Error("Specialist invocation requires an active milestone");
    }

    const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : "";
    const normalizedCaller = typeof caller === "string" ? caller.trim().toLowerCase() : "";
    const targetRole = normalizedRole === "strix_halo" ? "strix-halo" : normalizedRole;
    const callerRole = normalizedCaller === "strix_halo" ? "strix-halo" : normalizedCaller;

    const SPECIALIST_ROLES = ["jaguar", "puma", "bobcat", "strix-halo"];
    if (!SPECIALIST_ROLES.includes(targetRole)) {
      throw new TypeError(`Unknown or disallowed specialist role: "${role}"`);
    }

    if (callerRole === "steamroller" || callerRole === "bulldozer") {
      if (!SPECIALIST_ROLES.includes(targetRole)) {
        throw new Error(
          `${callerRole === "steamroller" ? "Steamroller" : "Bulldozer"} cannot invoke "${targetRole}"`
        );
      }
    } else if (callerRole === "bobcat") {
      if (targetRole !== "strix-halo") {
        throw new Error(`Bobcat may invoke only Strix Halo; cannot invoke "${targetRole}"`);
      }
    } else if (["jaguar", "puma", "strix-halo", "excavator"].includes(callerRole)) {
      throw new Error(
        `Specialist "${callerRole}" has no delegation authority and cannot invoke subagents`
      );
    } else {
      throw new Error(`Caller "${caller}" is not authorized to invoke specialists under a milestone`);
    }

    if (typeof slice === "string") {
      slice = { task: slice };
    } else if (typeof slice !== "object" || slice === null || Array.isArray(slice)) {
      throw new TypeError("Specialist slice must be an object or task string");
    }

    const FORBIDDEN_KEYS = [
      "ledger",
      "ledgerPath",
      "save",
      "declareGlobalCompletion",
      "completed_milestones",
      "verdict",
      "zen_verdict",
      "result_ref",
    ];
    for (const key of FORBIDDEN_KEYS) {
      if (key in slice && slice[key] !== undefined) {
        throw new Error(
          `Specialists cannot receive ledger or global authority: "${key}" is prohibited`
        );
      }
    }

    const activeMilestone = this.state.milestones.find((m) => m.id === activeMilestoneId);
    const milestoneSlice = activeMilestone
      ? {
          milestone_id: activeMilestone.id,
          plan_version: this.state.plan_version,
          objective: activeMilestone.objective,
          bounded_scope: activeMilestone.bounded_scope,
          non_goals: activeMilestone.non_goals,
          acceptance_criteria: activeMilestone.acceptance_criteria,
          constraints: this.state.constraints,
        }
      : {
          milestone_id: activeMilestoneId,
          plan_version: this.state.plan_version,
        };

    const packet = deepFreeze(
      deepClone({
        ...milestoneSlice,
        ...slice,
        milestone_id: activeMilestoneId,
        plan_version: this.state.plan_version,
        harness:
          slice.harness ??
          composeModelAwareHarness({
            role: targetRole,
            track: this.#track ?? this.#ledger.track ?? "S",
          }),
      })
    );

    const directMilestone = Boolean(options?.directMilestoneExecution);
    const failedStep = directMilestone
      ? { tool: "runner.invoke", args: { role: targetRole } }
      : {
          tool: "invoke_subagent",
          args: { role: targetRole, caller: callerRole, slice_keys: Object.keys(packet).sort() },
        };

    return this.#step(failedStep, async () => {
      let result;
      if (this.#invokeSpecialist) {
        result = await this.#invokeSpecialist(targetRole, packet, options);
      } else if (this.#invokeRole && this.#invokeRole !== invoke) {
        result = await this.#invokeRole(targetRole, packet, {
          ...this.#runnerOptions,
          ...options,
        });
      } else {
        result = this.#nativeSpecialistGate(targetRole, packet, options);
      }

      if (typeof result === "string") {
        result = { ok: true, response: result };
      }
      if (result && typeof result === "object") {
        if (result.ok === false) {
          const error = new Error(`${targetRole} invocation failed: ${JSON.stringify(result)}`);
          if (directMilestone) {
            error.failedStep = {
              tool: "runner.invoke",
              args: { role: targetRole, slug: result?.slug ?? null, error: result?.error ?? null },
              command: this.#transportCommand(targetRole, result?.slug),
            };
            error.invocationOutput = result;
          }
          throw error;
        }
        let parsedPacket;
        if (typeof result.response === "string") {
          const parsed = parseResponsePacket(result);
          if (!parsed.ok) {
            throw new InvalidResponseFormatError(targetRole, parsed.error);
          }
          parsedPacket = deepFreeze(deepClone(parsed.packet));
        } else {
          parsedPacket = deepFreeze(deepClone(result));
        }
        if (
          ["jaguar", "puma"].includes(targetRole) &&
          parsedPacket &&
          typeof parsedPacket === "object" &&
          ("facts" in parsedPacket ||
            "changes_made" in parsedPacket ||
            parsedPacket.status === "REROUTE_REQUIRED")
        ) {
          const lwCheck = validateLightweightResult(targetRole, parsedPacket);
          if (!lwCheck.valid) {
            throw new InvalidResponseFormatError(targetRole, lwCheck.reason);
          }
        }
        if (
          targetRole === "strix-halo" &&
          activeMilestoneId &&
          ["ACCEPT", "REVISE", "ESCALATE"].includes(parsedPacket?.verdict)
        ) {
          // Record pending Halo receipt unhydrated so fail-closed validation rejects incomplete receipts (#232).
          this.#pendingHaloReviews.set(activeMilestoneId, { ...parsedPacket, caller: callerRole });
        }
        return parsedPacket;
      }
      return result;
    });
  }

  async #invokeHaloGate(req) {
    if (typeof this.#invokeHalo === "function") {
      return await this.#invokeHalo(req);
    }
    if (typeof this.#invokeSpecialist === "function") {
      if (this.#ledger && this.state.current_milestone !== null) {
        return await this.invokeStrixHalo(req, { caller: req.caller ?? "steamroller" });
      }
      return await this.#invokeSpecialist("strix-halo", req, {
        caller: req.caller ?? "steamroller",
      });
    }
    const roleInvoker = this.#invokeRole ?? invoke;
    if (roleInvoker !== invoke) {
      return await this.#exact(
        "strix-halo",
        "Review the candidate diff and acceptance criteria and return a JSON Halo review packet with verdict ACCEPT, REVISE, or ESCALATE.",
        req
      );
    }
    return this.#nativeHaloGate(req);
  }

  #nativeHaloGate(req) {
    const agyPath = this.#runnerOptions.agyPath || process.env.AGY_PATH || "agy";
    const refusal = realAgyRefusalUnderNodeTest(this.#runnerOptions.agyPath);
    if (refusal) {
      throw new Error(refusal.message);
    }
    const slug = resolveSlug("strix-halo", {
      agyPath,
      installedModels: this.#runnerOptions.installedModels,
    });
    const instruction =
      "Review the candidate deliverable against the acceptance criteria and return only a bare JSON " +
      "Halo review packet with caller, candidate_id_or_run_id, reviewed_diff_digest, " +
      "acceptance_criteria_digest, plan_version, evidence_basis, verdict (ACCEPT, REVISE, or ESCALATE), and findings. Request:\n" +
      JSON.stringify(req);
    const prompt = `${loadNativeRoleBody("strix-halo")}\n\n${instruction}`;
    const args = [
      "--model",
      slug,
      "--output-format",
      "json",
      "--dangerously-skip-permissions",
      "-p",
      prompt,
    ];
    const env = { ...process.env, NTG_ACTIVE_ROLE: "strix-halo" };
    if (process.env.NTG_LIVE_TESTS !== "1") env.SKIP_LIVE_TESTS = "1";
    const r = spawnSync(agyPath, args, {
      cwd: this.cwd,
      env,
      encoding: "utf8",
      timeout: this.#runnerOptions.timeout ?? 600000,
      killSignal: "SIGKILL",
      maxBuffer: 20 * 1024 * 1024,
    });
    if (r.error) throw r.error;
    if (r.status !== 0) {
      throw new Error(`strix-halo invocation exited ${r.status}: ${(r.stderr || "").slice(-500)}`);
    }
    const envelope = parseResponseEnvelope(r.stdout, { role: "strix-halo", slug });
    if (!envelope.ok) {
      throw new Error(
        `strix-halo envelope rejected: ${envelope.error}${envelope.finished_reason ? ` (${envelope.finished_reason})` : ""}`
      );
    }
    const parsed = parseResponsePacket(envelope);
    if (!parsed.ok) {
      throw new Error(`strix-halo response is not a JSON packet: ${parsed.error}`);
    }
    return parsed.packet;
  }

  #nativeSpecialistGate(targetRole, slice, options = {}) {
    const startTime = Date.now();
    const agyPath = this.#runnerOptions.agyPath || options.agyPath || process.env.AGY_PATH || "agy";
    const refusal = realAgyRefusalUnderNodeTest(this.#runnerOptions.agyPath || options.agyPath);
    if (refusal) {
      throw new Error(refusal.message);
    }
    const slug =
      options.slug ??
      resolveSlug(targetRole, {
        agyPath,
        installedModels: this.#runnerOptions.installedModels ?? options.installedModels,
      });
    const instruction =
      targetRole === "strix-halo"
        ? "Review the candidate deliverable against the acceptance criteria and return only a bare JSON " +
          "Halo review packet with caller, candidate_id_or_run_id, reviewed_diff_digest, " +
          "acceptance_criteria_digest, plan_version, evidence_basis, verdict (ACCEPT, REVISE, or ESCALATE), and findings. Request:\n" +
          JSON.stringify(slice)
        : ["jaguar", "puma"].includes(targetRole)
          ? `Execute only the bounded ${targetRole} assignment and return only a bare JSON ` +
            `result packet (status: READY|BLOCKED|REROUTE_REQUIRED, ${targetRole === "jaguar" ? "facts" : "changes_made"}). Assignment:\n` +
            JSON.stringify(slice)
          : `Execute only the bounded ${targetRole} assignment and return only a bare JSON ` +
            "result packet (including status, changes_made or facts, and verification_evidence). Assignment:\n" +
            JSON.stringify(slice);
    const prompt = `${loadNativeRoleBody(targetRole)}\n\n${instruction}`;
    const args = [
      "--model",
      slug,
      "--output-format",
      "json",
      "--dangerously-skip-permissions",
      "-p",
      prompt,
    ];
    const env = { ...process.env, NTG_ACTIVE_ROLE: targetRole };
    if (process.env.NTG_LIVE_TESTS !== "1") env.SKIP_LIVE_TESTS = "1";
    const r = spawnSync(agyPath, args, {
      cwd: this.cwd,
      env,
      encoding: "utf8",
      timeout: options.timeout ?? this.#runnerOptions.timeout ?? 600000,
      killSignal: "SIGKILL",
      maxBuffer: 20 * 1024 * 1024,
    });
    const duration_ms = Math.max(0, Date.now() - startTime);
    if (r.error) throw r.error;
    if (r.status !== 0) {
      throw new Error(`${targetRole} invocation exited ${r.status}: ${(r.stderr || "").slice(-500)}`);
    }
    const envelope = parseResponseEnvelope(r.stdout, { role: targetRole, slug });
    if (!envelope.ok) {
      const error = new Error(
        `${targetRole} envelope rejected: ${envelope.error}${envelope.finished_reason ? ` (${envelope.finished_reason})` : ""}`
      );
      error.invocationOutput = {
        ok: false,
        error: envelope.error,
        slug,
        finished_reason: envelope.finished_reason,
      };
      throw error;
    }
    const parsed = parseResponsePacket(envelope);
    if (!parsed.ok) {
      throw new InvalidResponseFormatError(targetRole, parsed.error);
    }
    const packet = { ...parsed.packet };
    delete packet.usage;
    if (envelope.usage !== undefined) packet.usage = envelope.usage;
    packet.duration_ms = duration_ms;
    packet.slug = slug;
    return packet;
  }

  async invokeJaguar(slice, options = {}) {
    return this.invokeSpecialist("jaguar", slice, options);
  }

  async invokePuma(slice, options = {}) {
    return this.invokeSpecialist("puma", slice, options);
  }

  async invokeBobcat(slice, options = {}) {
    return this.invokeSpecialist("bobcat", slice, options);
  }

  async invokeStrixHalo(slice, options = {}) {
    const caller = typeof options === "string" ? options : (options?.caller ?? "bobcat");
    return this.invokeSpecialist(
      "strix-halo",
      slice,
      typeof options === "object" ? { ...options, caller } : { caller }
    );
  }

  /**
   * Builds the tier-B replanning context exposed to Piledriver / Instinct (#114).
   */
  buildReplanContext() {
    const state = this.state;
    const verification_summary = {};
    for (const [key, record] of Object.entries(state.verification ?? {})) {
      if (!record || typeof record !== "object") continue;
      verification_summary[key] = {
        verdict: record.verdict ?? null,
        plan_version: record.plan_version ?? null,
        result_ref: record.result_ref ?? null,
        is_stale: record.is_stale ?? null,
        repair_needs: record.repair_needs ?? null,
        timestamp: record.timestamp ?? null,
      };
    }
    return deepFreeze(
      deepClone(
        redactTelemetryValue({
          telemetry_tier: "B",
          goal: state.goal,
          constraints: state.constraints,
          plan_version: state.plan_version,
          milestones: state.milestones,
          current_milestone: state.current_milestone,
          completed_milestones: state.completed_milestones,
          decision_invariants: state.decision_invariants,
          blockers: state.blockers,
          next_action: state.next_action,
          failure_telemetry: projectFailureTelemetry(state.evidence),
          verification_summary,
        })
      )
    );
  }

  /** Steamroller-only desktop leaf; no ledger mutation or automatic replay. */
  async requestDesktop(task) {
    this.#idle();
    if (typeof task !== "string" || !task.trim()) throw new TypeError("Desktop task required");
    this.#busy = true;
    try {
      const result = await this.#exact(
        "navi",
        "Perform only the bounded desktop task and return your JSON result. " +
          "Return NEEDS_CONFIRMATION with the exact intended_action before any " +
          "irreversible or external effect; do not perform that action.",
        { task: task.trim(), constraints: this.state.constraints }
      );
      if (
        !["OBSERVED", "DONE", "BLOCKED", "NEEDS_CONFIRMATION"].includes(result.status) ||
        (result.status === "NEEDS_CONFIRMATION" &&
          (typeof result.intended_action !== "string" || !result.intended_action.trim()))
      ) {
        throw new InvalidResponseFormatError("navi");
      }
      return result;
    } finally {
      this.#busy = false;
    }
  }

  /** A planning response is advice; only explicit supervisor adoption changes state. */
  async requestPlan(task) {
    this.#idle();
    if (typeof task !== "string" || !task.trim()) throw new TypeError("Planning task required");
    this.#busy = true;
    try {
      return await this.#exact(
        "piledriver",
        "Return a bounded advisory plan as JSON. Do not implement, delegate workers, " +
          "write ledger state, or claim completion. You have no shell: never run commands " +
          "(including git or grep); inspect only with read-only file tools (view_file, " +
          "list_dir, find_by_name, grep_search) and put command-based checks in the plan.",
        { task, replan_context: this.buildReplanContext() }
      );
    } finally {
      this.#busy = false;
    }
  }

  /**
   * NEEDS_ALT: invokes Instinct with a bounded packet derived from durable
   * failure history and records the returned framing as advisory evidence.
   */
  async requestAltFraming(task, options = {}) {
    this.#idle();
    if (typeof task !== "string" || !task.trim()) {
      throw new TypeError("Alternate-framing task required");
    }
    const milestoneId = options.milestone ?? null;
    if (milestoneId !== null && !this.state.milestones.some((m) => m.id === milestoneId)) {
      throw new TypeError(`Unknown milestone for NEEDS_ALT context: "${milestoneId}"`);
    }
    const target = selectAltTarget(
      recommendNeedsAlt(this.state.evidence, this.state._verification_history),
      milestoneId
    );
    const contract = {
      task: task.trim(),
      needs_alt: {
        milestone_id: milestoneId,
        failure_class: target?.failure_class ?? "unknown",
        failure_signature: target?.failure_signature ?? "unknown",
        current_hypothesis:
          typeof options.current_hypothesis === "string" && options.current_hypothesis.trim()
            ? options.current_hypothesis.trim()
            : "UNKNOWN",
        attempt_count: target?.attempt_count ?? 0,
        evidence: target?.attempts ?? [],
      },
      replan_context: this.buildReplanContext(),
    };
    this.#busy = true;
    try {
      const advice = await this.#exact(
        "instinct",
        "Return a bounded alternate-framing advisory as JSON: current framing, why it " +
          "may be wrong, materially different hypotheses (each with evidence basis " +
          "OBSERVED/INFERRED/UNKNOWN and a discriminating test), recommendation and " +
          "unknowns. Advisory only: do not implement, delegate workers, write ledger " +
          "state, adopt a plan or claim completion or a verdict. You have no shell: " +
          "never run commands; inspect only with read-only file tools (view_file, " +
          "list_dir, find_by_name, grep_search) and put command-based checks in the " +
          "advice.",
        contract,
        { escalate: options.escalate === true }
      );
      this.#ledger.recordAltAdvice({
        milestone_id: milestoneId,
        task: task.trim(),
        needs_alt: contract.needs_alt,
        advice,
      });
      this.#saveLedger();
      return deepFreeze(deepClone(advice));
    } finally {
      this.#busy = false;
    }
  }

  /**
   * Executes a durable Track S or Track M milestone directly under SteamrollerController (#234).
   * DONE is an explicit pre-review candidate status; only independent Zen GO promotes completion.
   */
  async runMilestone(milestoneId, options = {}) {
    this.#idle();
    let contract = this.#ledger.delegate(milestoneId);
    const milestoneDef = this.#ledger.milestones.find((m) => m.id === milestoneId) ?? null;
    let coverageCwd = this.#resolveScopeCwd(contract.bounded_scope);
    const classification = this.classifyTrack({
      task: contract.objective || this.#ledger.goal,
      targetFiles: contract.bounded_scope,
      milestoneCount: this.#ledger.milestones.length,
      trackOverride: options.track ?? this.#track ?? this.#ledger.track ?? null,
    });
    const effectiveTrack = classification.track === "L" ? "S" : classification.track;
    const requireHalo =
      options.requireHalo !== undefined ? Boolean(options.requireHalo) : effectiveTrack === "M";
    const coverageProbes = Array.isArray(contract.coverage) ? contract.coverage : [];
    const resolveExecutionRoute = (activeContract, attemptNum) => {
      const hasRelevantFailure = Array.isArray(activeContract.relevant_evidence)
        ? activeContract.relevant_evidence.some(
            (ev) =>
              (Array.isArray(ev?.failure_evidence) && ev.failure_evidence.length > 0) ||
              Boolean(ev?.repair_needs)
          )
        : false;
      const ledgerNoGo =
        this.#ledger.verification?.[milestoneId]?.verdict === "NO-GO" &&
        !this.#ledger.verification?.[milestoneId]?.is_stale;
      const hasPriorFailure =
        attemptNum > 0 ||
        Boolean(options.recoveryMode) ||
        Boolean(activeContract.repair) ||
        ledgerNoGo ||
        hasRelevantFailure;
      const hasExplicitModels = Boolean(this.modelRouter?.defaultOpts?.installedModels);
      const blockedByTestRefusal =
        !hasExplicitModels &&
        Boolean(realAgyRefusalUnderNodeTest(this.modelRouter?.defaultOpts?.agyPath));
      return this.selectWorkerRoute({
        track: effectiveTrack,
        task: activeContract.objective || milestoneDef?.title || this.#ledger.goal || "",
        targetFiles: activeContract.bounded_scope ?? [],
        preferredRole: options.workerRole ?? milestoneDef?.worker_role ?? null,
        requiresMutation: options.requiresMutation,
        requiresShell: Boolean(options.requiresShell ?? milestoneDef?.requires_shell),
        requiresSubstantiveCode: Boolean(
          options.requiresSubstantiveCode ?? milestoneDef?.requires_substantive_code
        ),
        isMechanicalEdit: options.isMechanicalEdit ?? milestoneDef?.is_mechanical_edit,
        crossFileDependency: Boolean(
          options.crossFileDependency ?? milestoneDef?.cross_file_dependency
        ),
        requiresCoordinator: Boolean(
          options.requiresCoordinator ||
            milestoneDef?.requires_coordinator ||
            coverageProbes.length > 0
        ),
        highRisk: Boolean(options.highRisk),
        riskClass: options.riskClass ?? null,
        recoveryMode: hasPriorFailure,
        resolveModel: blockedByTestRefusal ? false : "best_effort",
      });
    };
    const enrichPacket = (packet, role = "bulldozer") => {
      packet.scope_map = buildScopeMap(packet.bounded_scope, { cwd: coverageCwd });
      packet.coverage_sites = runCoverageProbes(coverageProbes, { cwd: coverageCwd });
      packet.context_digest = buildContextDigest({
        boundedScope: packet.bounded_scope,
        cwd: coverageCwd,
        acceptanceCriteria: packet.acceptance_criteria,
      });
      packet.harness = composeModelAwareHarness({
        role,
        track: effectiveTrack,
        contextDigest: packet.context_digest,
      });
      return packet;
    };
    const initialRoute = resolveExecutionRoute(contract, 0);
    enrichPacket(contract, initialRoute.role);
    let scopeBefore = snapshotScope(contract.bounded_scope, { cwd: coverageCwd });
    let testBaseline = snapshotTestIntegrity(contract.bounded_scope, { cwd: coverageCwd });
    this.#saveLedger();
    this.#busy = true;
    try {
      const instruction =
        "Execute only this milestone. Delegate bounded work to specialists by kind: " +
        "Jaguar for read-only factual retrieval, Puma for low-risk writing and " +
        "mechanical text/config edits, Bobcat for bounded implementation and repair, " +
        "and Strix Halo when formative implementation review is needed. " +
        "Return architectural questions as NEEDS_DEEP through Steamroller. " +
        (advisorGateEnabled(process.env, { track: effectiveTrack })
          ? "For Bobcat, set ADVISOR_GATE REQUIRED for substantive work or NONE only " +
            "for low-risk mechanical work; Bobcat, Bulldozer, or Steamroller may invoke Strix Halo when required. "
          : "The Strix Halo advisor gate is disabled for this run: do not require or wait for " +
            "an advisor verdict; check implementation work through your own verification and " +
            "the coverage table instead. ") +
        (effectiveTrack === "M"
          ? "Track M policy is active: a fresh bound Strix Halo ACCEPT review is mandatory before Zen summative verification. "
          : "") +
        "Puma and Jaguar have no subagents and Puma has no advisor ceremony. " +
        "If a required specialist is unavailable, return BLOCKED, not a gate waiver. " +
        "Inspect specialist results and actual evidence yourself. Worker READY and " +
        "Strix ACCEPT are not DONE. Return your own JSON result packet with " +
        "milestone_id, plan_version, explicit status DONE|BLOCKED|NEEDS_DEEP, " +
        "changes_made, verification_evidence, unresolved_unknowns, scope_deviations, " +
        "blockers and escalation_needs as applicable. DONE must identify immutable " +
        "delivered artifact versions in candidate_artifact_ref." +
        (coverageProbes.length
          ? " The packet's coverage_sites were enumerated by code: your DONE packet must carry the " +
            "merged coverage_table with exactly one row per site (site as file:line, disposition " +
            "COVERED or NOT_APPLICABLE); a missing row fails the candidate before Zen review. "
          : "") +
        " Do not invoke Zen, supply Zen authority, write the ledger, or claim global completion.";
      const repairInstruction =
        REPAIR_INSTRUCTION_BASE +
        (coverageProbes.length
          ? "The repaired packet must carry the merged coverage_table with exactly one row per " +
            "site in coverage_sites, computed against the final tree. "
          : "") +
        "Do not invoke Zen, write the ledger or claim global completion.";
      const correctionInstruction =
        "Correct only the invalid result packet for this milestone using the existing " +
        "delivered artifacts and evidence. Do not re-execute completed work or invent " +
        "an artifact binding. Return the complete corrected JSON packet; if unable " +
        "to bind the delivered artifact, return BLOCKED. " +
        (coverageProbes.length
          ? "The corrected packet must carry a complete coverage_table: exactly one row per " +
            "site in coverage_sites (coverage_id and site as file:line must match, disposition " +
            "COVERED or NOT_APPLICABLE), computed against the final tree. "
          : "") +
        "Do not invoke Zen, write the ledger or claim global completion.";
      let salvageUsed = false;

      const invokeCoordinator = async (instructionText, contractArg) => {
        try {
          return await this.#exact("bulldozer", instructionText, contractArg);
        } catch (error) {
          const output = error?.invocationOutput;
          if (salvageUsed || !output || !SALVAGEABLE_ERRORS.includes(output.error)) throw error;
          const salvageCwd = this.#resolveScopeCwd(contract.bounded_scope);
          const changes = scopeChanges(
            scopeBefore,
            snapshotScope(contract.bounded_scope, { cwd: salvageCwd })
          );
          if (!changes.changed.length && !changes.added.length) throw error;
          salvageUsed = true;
          const salvage = {
            reason: output.error ?? "unknown",
            original_error: String(error?.message ?? error).slice(0, 2000),
            changed_files: changes.changed,
            added_files: changes.added,
            verify_results: this.#runVerifyCommands(contract.verify, salvageCwd),
          };
          try {
            return await this.#exact(
              "bulldozer",
              SALVAGE_INSTRUCTION,
              { ...contractArg, salvage },
              { timeout: SALVAGE_TIMEOUT_MS }
            );
          } catch (salvageError) {
            const blockers = [
              "Bulldozer transport failure and salvage both failed: " +
                String(salvageError?.message ?? salvageError),
            ];
            this.#ledger.recordBlockedOrFailure({
              milestoneId,
              status: "BLOCKED",
              blockers,
              evidence: {
                classification: "OBSERVED",
                salvage,
                salvage_failure: String(salvageError?.message ?? salvageError),
              },
            });
            this.#saveLedger();
            const blocked = new Error(blockers[0]);
            blocked.coordinatorBlocked = blockers;
            throw blocked;
          }
        }
      };

      const normalizeDirectWorkerCandidate = (workerResult, executedRole, activeContract) => {
        if (!workerResult || typeof workerResult !== "object" || Array.isArray(workerResult)) {
          return workerResult;
        }
        if ("verdict" in workerResult || "zen_verdict" in workerResult || "result_ref" in workerResult) {
          return workerResult;
        }
        if (workerResult.status === "BLOCKED" || workerResult.status === "NEEDS_DEEP") {
          return {
            milestone_id: activeContract.milestone_id,
            plan_version: activeContract.plan_version,
            ...workerResult,
            worker_role: executedRole,
          };
        }
        if (
          workerResult.status !== "READY" &&
          !(executedRole === "jaguar" && workerResult.status === "SUCCESS")
        ) {
          return workerResult;
        }
        const hasExplicitCandRef = workerResult.candidate_artifact_ref !== undefined;
        const hasExplicitArtRef = workerResult.artifact_ref !== undefined;
        let fallbackArtifactRef;
        if (!hasExplicitCandRef && !hasExplicitArtRef) {
          if (typeof workerResult.artifact === "string" && existsSync(workerResult.artifact)) {
            fallbackArtifactRef = `sha256:${createHash("sha256")
              .update(readFileSync(workerResult.artifact))
              .digest("hex")}`;
          } else {
            fallbackArtifactRef = computeDeliveredTreeDigest(activeContract.bounded_scope, {
              cwd: coverageCwd,
            });
          }
        }
        const changesMade =
          workerResult.changes_made !== undefined
            ? workerResult.changes_made
            : executedRole === "jaguar"
              ? []
              : Array.isArray(activeContract.bounded_scope) && activeContract.bounded_scope.length > 0
                ? [...activeContract.bounded_scope]
                : typeof workerResult.artifact === "string"
                  ? [basename(workerResult.artifact)]
                  : [];
        let verificationEvidence;
        if (!isEvidenceEmpty(workerResult.verification_evidence)) {
          verificationEvidence = workerResult.verification_evidence;
        } else {
          const detailItems = [];
          if (Array.isArray(workerResult.facts) && workerResult.facts.length > 0) {
            detailItems.push(
              ...workerResult.facts.map((fact) =>
                typeof fact === "string"
                  ? { classification: "OBSERVED", worker_role: executedRole, fact }
                  : fact
              )
            );
          }
          if (Array.isArray(workerResult.edits) && workerResult.edits.length > 0) {
            detailItems.push(
              ...workerResult.edits.map((edit) =>
                typeof edit === "string"
                  ? { classification: "OBSERVED", worker_role: executedRole, edit }
                  : edit
              )
            );
          }
          const criteriaItems =
            Array.isArray(activeContract.acceptance_criteria) &&
            activeContract.acceptance_criteria.length > 0
              ? activeContract.acceptance_criteria.map((criterion) => ({
                  classification: "OBSERVED",
                  criterion,
                  worker_role: executedRole,
                  result:
                    detailItems.length > 0
                      ? `${executedRole} completed bounded milestone '${activeContract.milestone_id}'`
                      : `${executedRole} delivered bounded scope for '${activeContract.milestone_id}'`,
                }))
              : [];
          verificationEvidence =
            criteriaItems.length > 0 || detailItems.length > 0
              ? [...criteriaItems, ...detailItems]
              : [
                  {
                    classification: "OBSERVED",
                    worker_role: executedRole,
                    result: `${executedRole} completed bounded milestone '${activeContract.milestone_id}'`,
                  },
                ];
        }
        return {
          milestone_id: activeContract.milestone_id,
          plan_version: activeContract.plan_version,
          status: "DONE",
          worker_role: executedRole,
          changes_made: changesMade,
          verification_evidence: verificationEvidence,
          unresolved_unknowns: workerResult.unresolved_unknowns ?? [],
          scope_deviations: workerResult.scope_deviations ?? [],
          ...(hasExplicitCandRef
            ? { candidate_artifact_ref: workerResult.candidate_artifact_ref }
            : {}),
          ...(hasExplicitArtRef ? { artifact_ref: workerResult.artifact_ref } : {}),
          ...(fallbackArtifactRef !== undefined
            ? { candidate_artifact_ref: fallbackArtifactRef }
            : {}),
          ...(workerResult.coverage_table !== undefined
            ? { coverage_table: workerResult.coverage_table }
            : {}),
          ...(workerResult.halo_review !== undefined
            ? { halo_review: workerResult.halo_review }
            : {}),
        };
      };

      const buildDirectWorkerPrefix = (role, activeInvalidHandoff) => {
        if (activeInvalidHandoff) {
          return correctionInstruction;
        }
        if (role === "jaguar") {
          return (
            "Execute only this bounded read-only factual discovery task inside bounded_scope. " +
            "Never mutate files or run write commands. Return a bare JSON result packet " +
            "(status: READY|BLOCKED|REROUTE_REQUIRED, facts, unresolved_unknowns)."
          );
        }
        if (role === "puma") {
          return (
            "Execute only this bounded low-risk mechanical, formatting, doc, or config edit task " +
            "inside bounded_scope. Return a bare JSON result packet " +
            "(status: READY|BLOCKED|REROUTE_REQUIRED, changes_made, verification_evidence)."
          );
        }
        return (
          "Execute only this bounded implementation task inside bounded_scope. Verify changes locally. " +
          (advisorGateEnabled(process.env, { track: effectiveTrack })
            ? "When required (ADVISOR_GATE: REQUIRED or Track M), obtain a fresh bound Strix Halo ACCEPT review before reporting READY. "
            : "The Strix Halo advisor gate is disabled for this run: do not require or wait for an advisor verdict; check implementation work through your own verification and the coverage table instead. ") +
          (effectiveTrack === "M"
            ? "Track M policy is active: a fresh bound Strix Halo ACCEPT review is mandatory before Zen summative verification. "
            : "") +
          "Return a bare JSON result packet (READY|BLOCKED|DONE) with changes_made, verification_evidence, and candidate_artifact_ref."
        );
      };

      const invokeDirectWorker = async (currentRoute, activeContract, activeInvalidHandoff) => {
        let targetRole = currentRoute.role;
        let targetSlug = currentRoute.slug ?? null;
        let workerContract = activeInvalidHandoff
          ? { ...activeContract, invalid_handoff: activeInvalidHandoff }
          : activeContract;

        const callWorker = async (role, slug, pktContract) => {
          const prefix = buildDirectWorkerPrefix(role, activeInvalidHandoff);
          const workerSlice = {
            ...pktContract,
            task: `${prefix}\n${JSON.stringify(pktContract)}`,
            worker_role: role,
            track: effectiveTrack,
            harness: composeModelAwareHarness({
              role,
              modelSlug: slug,
              track: effectiveTrack,
              contextDigest: activeContract.context_digest,
            }),
          };
          return await this.invokeSpecialist(role, workerSlice, {
            caller: "steamroller",
            directMilestoneExecution: true,
            ...(slug ? { slug } : {}),
          });
        };

        let workerResult = await callWorker(targetRole, targetSlug, workerContract);
        if (workerResult?.status === "REROUTE_REQUIRED") {
          const nextRole = String(workerResult.reroute_to || "bobcat").trim().toLowerCase();
          if (!["bobcat", "bulldozer"].includes(nextRole)) {
            throw new InvalidHandoffPacketError(
              `Invalid REROUTE_REQUIRED target '${nextRole}' from '${targetRole}'`
            );
          }
          if (nextRole === "bulldozer") {
            const coordContract = {
              ...workerContract,
              rerouted_from: targetRole,
              reroute_reason: workerResult.reason ?? "REROUTE_REQUIRED",
            };
            const packet = await invokeCoordinator(
              activeInvalidHandoff ? correctionInstruction : instruction,
              coordContract
            );
            return { executedRole: "bulldozer", packet };
          }
          const reroutedContract = {
            ...workerContract,
            rerouted_from: targetRole,
            reroute_reason: workerResult.reason ?? "REROUTE_REQUIRED",
          };
          targetRole = "bobcat";
          const rerouteInfo = this.selectWorkerRoute({
            track: effectiveTrack,
            task: activeContract.objective || milestoneDef?.title || "",
            targetFiles: activeContract.bounded_scope ?? [],
            preferredRole: "bobcat",
            resolveModel: currentRoute.slug ? "best_effort" : false,
          });
          targetSlug = rerouteInfo.slug ?? null;
          workerResult = await callWorker(targetRole, targetSlug, reroutedContract);
        }

        return {
          executedRole: targetRole,
          packet: normalizeDirectWorkerCandidate(workerResult, targetRole, activeContract),
        };
      };

      const inRunNoGos = [];
      for (let attempt = 0; ; attempt += 1) {
        this.#pendingHaloReviews.delete(milestoneId);
        const attemptRoute = attempt === 0 ? initialRoute : resolveExecutionRoute(contract, attempt);
        let executedRole = attemptRoute.role;
        const executeInstruction = attempt === 0 ? instruction : repairInstruction;
        let verifyResults = null;
        let treeDigest = null;
        let candidate;
        let invalidHandoff;
        for (let correction = 0; correction <= MAX_HANDOFF_CORRECTIONS; correction += 1) {
          try {
            if (attemptRoute.role === "bulldozer") {
              executedRole = "bulldozer";
              candidate = await invokeCoordinator(
                invalidHandoff ? correctionInstruction : executeInstruction,
                invalidHandoff ? { ...contract, invalid_handoff: invalidHandoff } : contract
              );
            } else {
              const directOut = await invokeDirectWorker(attemptRoute, contract, invalidHandoff);
              executedRole = directOut.executedRole;
              candidate = directOut.packet;
            }
          } catch (error) {
            if (Array.isArray(error?.coordinatorBlocked)) {
              return {
                status: "BLOCKED",
                worker_role: executedRole,
                candidate: null,
                blockers: error.coordinatorBlocked,
                verified: false,
              };
            }
            throw error;
          }
          if (candidate.status !== "DONE") break;
          try {
            candidate = normalizeCandidateArtifactRef(candidate, {
              errorClass: InvalidHandoffPacketError,
            });
            if (
              typeof candidate.candidate_artifact_ref !== "string" ||
              !candidate.candidate_artifact_ref.trim()
            ) {
              throw new InvalidHandoffPacketError(
                "DONE must bind immutable delivered artifact versions in candidate_artifact_ref"
              );
            }
            coverageCwd = this.#resolveScopeCwd(contract.bounded_scope);
            const check = this.#runCheck(candidate, {
              contract,
              coverageProbes,
              coverageCwd,
              testBaseline,
            });
            verifyResults = check.verifyResults;
            treeDigest = check.treeDigest;
            if (check.failures.length) {
              throw new InvalidHandoffPacketError(check.failures.join("; "));
            }
            break;
          } catch (error) {
            if (!(error instanceof InvalidHandoffPacketError)) throw error;
            invalidHandoff = {
              error: error.error,
              reason: error.message,
              candidate: deepClone(candidate),
            };
            if (correction === MAX_HANDOFF_CORRECTIONS) {
              const blockers = [
                `Invalid handoff after ${MAX_HANDOFF_CORRECTIONS} corrections: ${error.message}`,
              ];
              this.#ledger.recordBlockedOrFailure({
                milestoneId,
                status: "BLOCKED",
                blockers,
                evidence: {
                  classification: "OBSERVED",
                  ...invalidHandoff,
                  attempts: correction + 1,
                },
              });
              this.#saveLedger();
              return {
                status: "BLOCKED",
                worker_role: executedRole,
                candidate: deepClone(candidate),
                blockers,
                verified: false,
              };
            }
          }
        }

        if (
          candidate.milestone_id !== contract.milestone_id ||
          candidate.plan_version !== contract.plan_version
        ) {
          throw new Error("Candidate does not match the active milestone and plan");
        }
        if ("delegations" in candidate) {
          if (!Array.isArray(candidate.delegations)) {
            throw new InvalidHandoffPacketError("Bulldozer delegations must be an array");
          }
          for (const delegation of candidate.delegations) {
            if (
              !delegation ||
              typeof delegation !== "object" ||
              Array.isArray(delegation) ||
              typeof delegation.role !== "string" ||
              !delegation.role.trim()
            ) {
              throw new InvalidHandoffPacketError("Each Bulldozer delegation must have a non-empty role");
            }
            const role = delegation.role.trim().toLowerCase();
            if (!["jaguar", "puma", "bobcat", "strix-halo"].includes(role)) {
              throw new InvalidHandoffPacketError(
                `Bulldozer cannot delegate to "${role}" within a milestone`
              );
            }
          }
        }
        if (candidate.status === "BLOCKED" || candidate.status === "NEEDS_DEEP") {
          this.#ledger.recordBlockedOrFailure({
            milestoneId,
            status: candidate.status,
            blockers: candidate.blockers,
            escalationNeeds: candidate.escalation_needs,
            evidence: candidate,
          });
          this.#saveLedger();
          return {
            status: candidate.status,
            worker_role: executedRole,
            candidate: deepClone(candidate),
            verified: false,
          };
        }
        if (candidate.status !== "DONE") {
          throw new Error("Only explicit Bulldozer DONE may enter Zen review");
        }
        if ("verdict" in candidate || "zen_verdict" in candidate || "result_ref" in candidate) {
          throw new Error("Bulldozer cannot issue result references or Zen authority");
        }
        const { result_ref, candidate_record } = this.#ledger.receiveCandidate(candidate, {
          cwd: coverageCwd,
          deliveredTreeDigest: treeDigest,
        });
        this.#saveLedger();
        const request = deepFreeze(
          deepClone({
            milestone_id: contract.milestone_id,
            plan_version: contract.plan_version,
            result_ref,
            contract,
            candidate: candidate_record,
            ...(verifyResults ? { verify_results: verifyResults } : {}),
            ...(treeDigest ? { delivered_tree_digest: treeDigest } : {}),
          })
        );
        const pendingHalo = this.#pendingHaloReviews.get(milestoneId) ?? null;
        this.#pendingHaloReviews.delete(milestoneId);
        // Never hydrate missing binding fields on candidate.halo_review or pendingHalo (#232).
        const preExistingHalo = candidate.halo_review ?? pendingHalo;

        const trackVerification = await this.trackRunner.verifyTrackSMCandidate({
          track: effectiveTrack,
          milestoneId: contract.milestone_id,
          candidate: candidate_record,
          contract,
          haloReview: preExistingHalo,
          requireHalo,
          caller: preExistingHalo?.caller ?? "steamroller",
          currentDiffDigest: treeDigest,
          invokeHalo: (req) => this.#invokeHaloGate(req),
          invokeZen: async (smRequest) => {
            const zenFn = this.#invokeZen;
            if (typeof zenFn !== "function") {
              throw new TypeError("An independent native Zen invocation is required");
            }
            const reqWithHalo =
              smRequest?.halo_review && !request.halo_review
                ? deepFreeze(deepClone({ ...request, halo_review: smRequest.halo_review }))
                : request;
            return deepClone(
              await this.#step(
                {
                  tool: "zen_review",
                  args: {
                    milestone_id: contract.milestone_id,
                    plan_version: contract.plan_version,
                    result_ref,
                  },
                },
                () => zenFn(reqWithHalo)
              )
            );
          },
        });
        const verdict = deepClone(trackVerification.zen_verdict);
        const postZenTreeDigest = computeDeliveredTreeDigest(contract.bounded_scope ?? [], {
          cwd: coverageCwd,
        });
        this.#applyZenVerdict(contract, result_ref, verdict, {
          candidateTreeDigest: candidate_record.delivered_tree_digest ?? treeDigest ?? null,
          expectedTreeDigest: postZenTreeDigest,
        });
        this.#saveLedger();
        if (verdict.verdict === "GO") {
          return {
            status: "DONE",
            track: effectiveTrack,
            worker_role: executedRole,
            halo_status: trackVerification.halo_status,
            halo_review: trackVerification.halo_review,
            result_ref,
            verdict,
            verified: true,
          };
        }
        inRunNoGos.push(verdict);
        const decision = decideRepairAction({ noGoRecords: inRunNoGos, repairsUsed: attempt });
        if (decision.action !== "REPAIR") {
          return {
            status: "DONE",
            track: effectiveTrack,
            worker_role: executedRole,
            halo_status: trackVerification.halo_status,
            halo_review: trackVerification.halo_review,
            result_ref,
            verdict,
            verified: false,
            question: repairStopQuestion(milestoneId, {
              repairsUsed: attempt,
              repeatedSignature: decision.repeatedSignature,
            }),
          };
        }
        contract = enrichPacket(this.#ledger.delegate(milestoneId), "bulldozer");
        contract.repair = {
          attempt: attempt + 1,
          repair_needs: verdict.repair_needs,
          ...(Array.isArray(verdict.findings) ? { findings: deepClone(verdict.findings) } : {}),
          verification_evidence: deepClone(verdict.verification_evidence),
          prior_result_ref: result_ref,
        };
        scopeBefore = snapshotScope(contract.bounded_scope, { cwd: coverageCwd });
        testBaseline = snapshotTestIntegrity(contract.bounded_scope, { cwd: coverageCwd });
        this.#saveLedger();
      }
    } catch (error) {
      if (error instanceof LedgerIntegrityError) {
        throw error;
      }
      if (this.state.current_milestone === milestoneId) {
        const errorText = String(error);
        const evidence = { classification: "OBSERVED", error: errorText };
        const bytes = Buffer.from(errorText, "utf8");
        const MAX_ERROR_BYTES = 8 * 1024;
        if (bytes.length > MAX_ERROR_BYTES) {
          const digest = createHash("sha256").update(bytes).digest("hex");
          const transcriptDir = `${this.ledgerPath}.transcripts`;
          mkdirSync(transcriptDir, { recursive: true });
          evidence.transcript_ref = join(transcriptDir, `${digest}.txt`);
          writeFileSync(evidence.transcript_ref, bytes);
          const marker = `\n[truncated ${bytes.length} bytes; sha256:${digest}]\n`;
          const previewBytes = Math.floor((MAX_ERROR_BYTES - Buffer.byteLength(marker)) / 2) - 3;
          evidence.error =
            bytes.subarray(0, previewBytes).toString("utf8") +
            marker +
            bytes.subarray(-previewBytes).toString("utf8");
          evidence.error_digest = `sha256:${digest}`;
        }
        this.#ledger.recordBlockedOrFailure({
          milestoneId,
          status: "INVOCATION_FAILURE",
          evidence: error?.failedStep ? { ...evidence, failed_step: error.failedStep } : evidence,
        });
        this.#saveLedger();
      }
      throw error;
    } finally {
      this.#busy = false;
    }
  }

  #runCheck(candidate, { contract, coverageProbes, coverageCwd, testBaseline }) {
    const failures = [];
    const outOfScope = declaredChangePaths(candidate.changes_made).filter(
      (path) => !isPathInScope(path, contract.bounded_scope)
    );
    if (outOfScope.length) {
      failures.push(
        `changes_made declares paths outside bounded_scope: ${JSON.stringify([...new Set(outOfScope)])}`
      );
    }
    if (coverageProbes.length) {
      const hits = runCoverageProbes(coverageProbes, { cwd: coverageCwd });
      const check = checkCoverageTable(hits, candidate.coverage_table);
      if (!check.ok) {
        failures.push(
          `Coverage table incomplete: missing rows for sites ${JSON.stringify(check.missing.map((h) => h.site))}` +
            (check.invalid.length
              ? `; invalid rows ${JSON.stringify(check.invalid.map(() => "row"))}`
              : "")
        );
      }
    }
    const integrity = checkTestIntegrity(contract.bounded_scope, testBaseline, { cwd: coverageCwd });
    if (integrity.deleted_files.length) {
      failures.push(`test files deleted: ${JSON.stringify(integrity.deleted_files)}`);
    }
    if (integrity.new_markers.length) {
      failures.push(
        `test suppressions added: ${JSON.stringify(
          integrity.new_markers.map((marker) => `${marker.file}: ${marker.text}`)
        )}`
      );
    }
    let verifyResults = null;
    if (Array.isArray(contract.verify) && contract.verify.length) {
      verifyResults = this.#runVerifyCommands(contract.verify, coverageCwd);
      const failed = verifyResults.filter((result) => result.exit_code !== 0);
      if (failed.length) {
        failures.push(
          `verify commands failed: ${failed
            .map(
              (result) =>
                `${result.command} (exit ${result.exit_code}) ${(result.tail ?? "").slice(-120)}`
            )
            .join("; ")}`
        );
      }
    }
    const treeDigest = `sha256:${createHash("sha256")
      .update(JSON.stringify(snapshotScope(contract.bounded_scope, { cwd: coverageCwd }).files))
      .digest("hex")}`;
    return { failures, verifyResults, treeDigest };
  }

  #runVerifyCommands(commands, cwd) {
    if (!Array.isArray(commands) || !commands.length) return [];
    return commands.map((command) => {
      try {
        const result = spawnSync(command, {
          shell: true,
          timeout: 120_000,
          cwd,
          encoding: "utf-8",
          env: {
            ...process.env,
            ...(process.env.NTG_LIVE_TESTS === "1" ? {} : { SKIP_LIVE_TESTS: "1" }),
          },
        });
        const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
        return {
          command,
          exit_code: result.status ?? null,
          tail: combined.slice(-500),
        };
      } catch (error) {
        return { command, exit_code: null, tail: String(error?.message ?? error).slice(-500) };
      }
    });
  }

  #applyZenVerdict(contract, resultRef, verdict, opts = {}) {
    validateZenVerdictPacket(verdict, {
      expectedMilestone: contract.milestone_id,
      expectedPlanVersion: contract.plan_version,
      expectedResultRef: resultRef,
      expectedCriteria: contract.acceptance_criteria ?? [],
      candidateTreeDigest: opts.candidateTreeDigest ?? null,
      expectedTreeDigest: opts.expectedTreeDigest ?? null,
      errorClass: Error,
      noGoErrorClass: InvalidHandoffPacketError,
    });
    if (verdict.verdict === "GO") {
      this.#ledger.recordZenGo(verdict, {
        expectedTreeDigest: opts.expectedTreeDigest ?? opts.candidateTreeDigest,
      });
    } else {
      this.#ledger.recordZenNoGo(verdict);
    }
  }

  async reviewCandidate(milestoneId = null) {
    this.#idle();
    let targetId = milestoneId;
    if (targetId === null) {
      const state = this.state;
      let selected = null;
      for (const m of state.milestones) {
        if (state.completed_milestones.includes(m.id)) continue;
        const candidates = state.evidence?.[m.id]?.candidates;
        if (!Array.isArray(candidates) || candidates.length === 0) continue;
        const last = candidates[candidates.length - 1];
        if (!last || typeof last !== "object" || last.plan_version !== state.plan_version) continue;
        if (!selected || String(last.timestamp ?? "") > String(selected.timestamp ?? "")) {
          selected = { id: m.id, timestamp: last.timestamp };
        }
      }
      targetId = selected?.id ?? null;
    }
    const targetMilestone =
      targetId !== null ? this.#ledger.milestones.find((m) => m.id === targetId) ?? null : null;
    const coverageCwd = targetMilestone
      ? this.#resolveScopeCwd(targetMilestone.bounded_scope ?? [])
      : this.cwd;
    const liveTreeDigest = targetMilestone
      ? computeDeliveredTreeDigest(targetMilestone.bounded_scope ?? [], { cwd: coverageCwd })
      : null;

    let opened;
    try {
      opened = this.#ledger.reopenLastCandidateReview(milestoneId, {
        cwd: coverageCwd,
        expectedTreeDigest: liveTreeDigest,
      });
    } catch (error) {
      if (error instanceof StaleVerdictError) {
        this.#saveLedger();
      }
      throw error;
    }
    this.#saveLedger();
    this.#busy = true;
    try {
      const zenFn = this.#invokeZen;
      if (typeof zenFn !== "function") {
        throw new TypeError("An independent native Zen invocation is required");
      }
      const request = deepFreeze(
        deepClone({
          milestone_id: opened.milestone_id,
          plan_version: opened.plan_version,
          result_ref: opened.result_ref,
          contract: opened.contract,
          candidate: opened.candidate_record,
          ...(opened.candidate_record?.delivered_tree_digest
            ? { delivered_tree_digest: opened.candidate_record.delivered_tree_digest }
            : liveTreeDigest
              ? { delivered_tree_digest: liveTreeDigest }
              : {}),
        })
      );
      const verdict = deepClone(
        await this.#step(
          {
            tool: "zen_review",
            args: {
              milestone_id: opened.milestone_id,
              plan_version: opened.plan_version,
              result_ref: opened.result_ref,
              gate_only_retry: true,
            },
          },
          () => zenFn(request)
        )
      );
      const postZenTreeDigest = computeDeliveredTreeDigest(
        opened.contract.bounded_scope ?? [],
        { cwd: coverageCwd }
      );
      this.#applyZenVerdict(opened.contract, opened.result_ref, verdict, {
        candidateTreeDigest: opened.candidate_record?.delivered_tree_digest ?? null,
        expectedTreeDigest: postZenTreeDigest,
      });
      this.#saveLedger();
      return {
        status: "REVIEWED",
        result_ref: opened.result_ref,
        verdict,
        verified: verdict.verdict === "GO",
      };
    } catch (error) {
      if (error instanceof LedgerIntegrityError) {
        throw error;
      }
      if (this.state.current_milestone === opened.milestone_id) {
        this.#ledger.recordBlockedOrFailure({
          milestoneId: opened.milestone_id,
          status: "INVOCATION_FAILURE",
          evidence: error?.failedStep
            ? { classification: "OBSERVED", error: String(error), failed_step: error.failedStep }
            : { classification: "OBSERVED", error: String(error) },
        });
        this.#saveLedger();
      }
      throw error;
    } finally {
      this.#busy = false;
    }
  }

  /** Fresh-context recovery needs observed interruption, not a silent retry. */
  endInterruptedInvocation(evidence) {
    this.#open();
    if (this.#busy) throw new Error("Cannot interrupt a live invocation through resume recovery");
    if (evidence?.classification !== "OBSERVED") {
      throw new Error("Observed interruption evidence required");
    }
    const milestoneId = this.state.current_milestone;
    if (milestoneId === null) throw new Error("No interrupted invocation");
    this.#ledger.recordBlockedOrFailure({ milestoneId, status: "INVOCATION_FAILURE", evidence });
    this.#saveLedger();
  }

  adoptTacticalReplan(plan) {
    this.#idle();
    this.#ledger.tacticalReplan(plan);
    this.#saveLedger();
    return this.state;
  }

  adoptReplan(plan) {
    this.#idle();
    this.#ledger.materialReplan(plan);
    this.#saveLedger();
    return this.state;
  }

  resolveBlocker(id, evidence) {
    this.#idle();
    if (evidence?.classification !== "OBSERVED") {
      throw new Error("Observed resolution evidence required");
    }
    const resolution = this.#ledger.resolveBlocker(id, evidence);
    this.#saveLedger();
    return resolution;
  }

  declareGlobalCompletion() {
    this.#idle();
    return this.#ledger.declareGlobalCompletion();
  }
}

/**
 * Legacy 1.x compatibility wrapper preserving constructor validation and lock
 * semantics on top of Season 2 `SteamrollerController` (#234).
 */
export class MinimalSpine extends SteamrollerController {
  constructor(options = {}) {
    if (typeof options?.ledgerPath !== "string" || !options.ledgerPath.trim()) {
      throw new TypeError("A supervisor-owned ledgerPath is required");
    }
    if (typeof options?.invokeZen !== "function") {
      throw new TypeError("An independent native Zen invocation is required");
    }
    const controller = options.controller;
    super({
      ...options,
      invokeRole: options.invokeRole ?? invoke,
      trackRunner: options.trackRunner ?? controller?.trackRunner ?? null,
      modelRouter: options.modelRouter ?? controller?.modelRouter ?? null,
      lightweightLog: options.lightweightLog ?? controller?.lightweightLog ?? null,
      acquireLock: true,
    });
    if (controller && typeof controller.bindSpine === "function") {
      controller.bindSpine(this);
    }
  }
}

export const SteamrollerSpine = MinimalSpine;
