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
    super(message || "Mandatory initial Piledriver planning pass failed or is unavailable");
    this.name = "InitialPlanningRequiredError";
    this.code = "PILEDRIVER_PLANNING_UNAVAILABLE";
    this.ok = false;
    if (details && typeof details === "object") {
      Object.assign(this, details);
    }
  }
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
  #requireInitialPlanning;

  constructor({
    ledger = null,
    ledgerPath = null,
    lightweightLog = null,
    lightweightLogPath = ".ntg/lightweight-runs.jsonl",
    invokePlanner = null,
    invokeWorker = null,
    invokeHalo = null,
    invokeZen = null,
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
    this.#requireInitialPlanning =
      requireInitialPlanning !== undefined
        ? Boolean(requireInitialPlanning)
        : typeof invokePlanner === "function";
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
    highRiskEscalation = false,
    escalateHalo = false,
    reviewAttempt = null,
    previousVerdict = null,
    planningPass = null,
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

    const enforcePlanning =
      requireInitialPlanning !== undefined
        ? Boolean(requireInitialPlanning)
        : this.#requireInitialPlanning;
    let resolvedPlanningPass = planningPass;
    const alreadyPlanned =
      resolvedPlanningPass?.status === "COMPLETED" ||
      this.lightweightLog.hasPlanningPass(runId, planVersion);
    if (enforcePlanning && !alreadyPlanned) {
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
          `Mandatory initial Piledriver planning pass failed for Track L run '${runId}': ${err?.message ?? err}`,
          { cause: err, run_id: runId, plan_version: planVersion }
        );
      }
      if (!rawPlan || rawPlan.ok === false) {
        throw new InitialPlanningRequiredError(
          `Mandatory initial Piledriver planning pass failed for Track L run '${runId}': ${rawPlan?.error || "UNAVAILABLE"}`,
          { run_id: runId, plan_version: planVersion, details: rawPlan ?? null }
        );
      }
      resolvedPlanningPass = {
        role: "piledriver",
        status: "COMPLETED",
        plan_version: String(planVersion),
        slug: rawPlan.slug ?? null,
        adopted: false,
        advice: rawPlan,
        timestamp: new Date().toISOString(),
      };
    } else if (!resolvedPlanningPass && alreadyPlanned) {
      const prior = this.lightweightLog.getByRunId(runId);
      resolvedPlanningPass = prior?.planning_pass ?? {
        role: "piledriver",
        status: "COMPLETED",
        plan_version: String(planVersion),
        adopted: false,
      };
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
    const acceptanceCriteriaDigest = computeAcceptanceDigest(acceptanceCriteria);

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
