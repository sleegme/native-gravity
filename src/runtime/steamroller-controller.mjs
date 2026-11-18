import {
  AuthorityExpansionError,
  ModelRouter,
  getRoleAuthority,
  normalizeRoleName,
  realAgyRefusalUnderNodeTest,
} from "../core/model-router.mjs";
import { LightweightLog } from "../core/lightweight-log.mjs";
import {
  buildHaloReviewRequest,
  evaluateLightweightSuitability,
} from "../harness/index.mjs";
import { TrackRunner } from "./track-runner.mjs";

const TRACK_M_HINT_RE =
  /\b(architecture|architectural|migration|multi[- ]milestone|cross[- ]cutting|security|kernel rewrite)\b/i;
const TRACK_S_HINT_RE =
  /\b(schema|auth|authentication|state[- ]machine|api|database|refactor|hook|ledger|concurrency|persist)\b/i;

/**
 * Interactive AGY Steamroller Runtime Control Plane:
 * - Autonomous Track L/S/M classification
 * - Selective Direct/Lightweight vs. Bulldozer (Hydrogen XHigh) routing
 * - Capability-only dynamic model routing strictly decoupled from role permissions
 * - On-demand Piledriver/Instinct/Strix Halo advisory orchestration
 * - Bulldozer + Instinct recovery bounded by LedgerKernel's hard safety cap
 */
export class SteamrollerController {
  #invokeRole;
  #invokeSpecialist;
  #invokeHalo;
  #invokeZen;

  constructor({
    ledger = null,
    ledgerPath = null,
    lightweightLog = null,
    lightweightLogPath = ".ntg/lightweight-runs.jsonl",
    modelRouter = null,
    trackRunner = null,
    invokeRole = null,
    invokeSpecialist = null,
    invokeHalo = null,
    invokeZen = null,
    spine = null,
    cwd = process.cwd(),
  } = {}) {
    this.ledger = ledger;
    this.ledgerPath = ledgerPath;
    this.lightweightLog = lightweightLog ?? new LightweightLog(lightweightLogPath);
    this.modelRouter = modelRouter ?? new ModelRouter();
    this.#invokeRole = invokeRole;
    this.#invokeSpecialist = invokeSpecialist;
    this.#invokeHalo = invokeHalo;
    this.#invokeZen = invokeZen;
    this.spine = spine;
    this.cwd = cwd;
    const defaultHaloHandler =
      invokeHalo ??
      (invokeSpecialist
        ? (req) => invokeSpecialist("strix-halo", req, { caller: req.caller })
        : invokeRole
        ? (req) =>
            invokeRole(
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
    this.trackRunner =
      trackRunner ??
      new TrackRunner({
        ledger: this.ledger,
        ledgerPath: this.ledgerPath,
        lightweightLog: this.lightweightLog,
        invokeWorker: invokeSpecialist ?? invokeRole,
        invokeHalo: defaultHaloHandler,
        invokeZen,
        cwd,
      });
  }

  /**
   * Binds an active MinimalSpine / LedgerKernel instance to this controller and its TrackRunner.
   */
  bindSpine(spine) {
    this.spine = spine;
    if (spine?.ledger) {
      this.ledger = spine.ledger;
      this.trackRunner.ledger = spine.ledger;
    }
    if (this.ledgerPath) {
      this.trackRunner.ledgerPath = this.ledgerPath;
    }
    return this;
  }

  /**
   * Autonomously classifies incoming work into Track L, S, or M.
   */
  classifyTrack({
    task = "",
    targetFiles = [],
    milestoneCount = 1,
    highRisk = false,
    requiresCoordinator = false,
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

    const fileCount = Array.isArray(targetFiles) ? targetFiles.length : 0;
    const text = String(task || "");

    if (milestoneCount > 1 || requiresCoordinator || TRACK_M_HINT_RE.test(text) || fileCount > 6) {
      return {
        track: "M",
        assurance_badge: "ZEN_DURABLE",
        auto_classified: true,
        reason:
          milestoneCount > 1
            ? "multi-milestone scope"
            : "complex cross-cutting or coordinator-grade task",
      };
    }

    if (highRisk || TRACK_S_HINT_RE.test(text) || fileCount > 2) {
      return {
        track: "S",
        assurance_badge: "ZEN_DURABLE",
        auto_classified: true,
        reason: highRisk
          ? "high-risk verification requirement"
          : "substantive stateful or multi-file single-milestone scope",
      };
    }

    return {
      track: "L",
      assurance_badge: "HALO_LIGHTWEIGHT",
      auto_classified: true,
      reason: "bounded low-risk single-step change",
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
   * Selects direct/lightweight worker or Bulldozer (Hydrogen XHigh) execution route.
   * Tasks unsuitable for 3.8 Flash Low reroute cleanly to Bobcat or Bulldozer.
   */
  selectWorkerRoute({
    track = "S",
    task = "",
    targetFiles = [],
    preferredRole = null,
    requiresShell = false,
    requiresSubstantiveCode = false,
    recoveryMode = false,
    modelOverrides = {},
    resolveModel = true,
  } = {}) {
    const pick = (role, extra = {}) => {
      const slug = resolveModel
        ? this.resolveRoleModel(role, {
            modelOverride: modelOverrides?.[role],
          }).slug
        : null;
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

    if (recoveryMode || (String(track).toUpperCase() === "M" && (!preferredRole || targetFiles.length > 2))) {
      return pick("bulldozer", {
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
          requiresShell,
          requiresSubstantiveCode,
        });
        if (!suitability.suitable && suitability.rerouteTo) {
          return pick(suitability.rerouteTo, {
            reroutedFrom: normalizedPref,
            signal: "REROUTE_REQUIRED",
            reason: suitability.reason,
          });
        }
      }
      return pick(normalizedPref);
    }

    return pick(requiresSubstantiveCode || requiresShell || targetFiles.length > 0 ? "bobcat" : "jaguar");
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
        plan_version: review?.plan_version ?? request.plan_version,
      });
    }
    return review;
  }

  /**
   * Runs bounded milestone recovery via Bulldozer (Hydrogen XHigh) + on-demand
   * Instinct (Claude Sonnet 5.5 High / Opus 5.5 High escalated), capped by LedgerKernel.
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

    const repeatedStagnation =
      attemptInfo.attempt >= 2 ||
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
    const transition = this.ledger.tacticalReplan(newPlanData);
    if (this.ledgerPath) {
      this.ledger.save(this.ledgerPath);
    }
    return transition;
  }

  /**
   * Executes a Track L lightweight task through Steamroller routing and TrackRunner.
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
      requiresShell: Boolean(options.requiresShell),
      requiresSubstantiveCode: Boolean(options.requiresSubstantiveCode),
      resolveModel: !blockedByTestRefusal,
    });
    return this.trackRunner.runTrackL({
      ...options,
      workerRole: route.role,
      modelSlug: route.slug,
    });
  }

  /**
   * Executes a durable Track S or Track M milestone through the bound spine.
   */
  async runMilestone(milestoneId, options = {}) {
    if (!this.spine) {
      throw new Error("SteamrollerController.runMilestone requires a bound spine");
    }
    return this.spine.runMilestone(milestoneId, options);
  }
}
