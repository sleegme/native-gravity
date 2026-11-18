import {
  LightweightLog,
  computeAcceptanceDigest,
  computeDiffDigest,
  validateHaloReviewBinding,
} from "../core/lightweight-log.mjs";
import {
  buildContextDigest,
  buildHaloReviewRequest,
  composeModelAwareHarness,
  evaluateLightweightSuitability,
} from "../harness/index.mjs";

/**
 * Coordinates NTG 2.0 Track L (`HALO_LIGHTWEIGHT`) and Track S/M (`ZEN_DURABLE`)
 * verification gates with strict Halo/Zen separation and staleness enforcement.
 */
export class TrackRunner {
  #invokeWorker;
  #invokeHalo;
  #invokeZen;

  constructor({
    ledger = null,
    ledgerPath = null,
    lightweightLog = null,
    lightweightLogPath = ".ntg/lightweight-runs.jsonl",
    invokeWorker = null,
    invokeHalo = null,
    invokeZen = null,
    cwd = process.cwd(),
  } = {}) {
    this.ledger = ledger;
    this.ledgerPath = ledgerPath;
    this.lightweightLog = lightweightLog ?? new LightweightLog(lightweightLogPath);
    this.#invokeWorker = invokeWorker;
    this.#invokeHalo = invokeHalo;
    this.#invokeZen = invokeZen;
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
    workerRole = "bobcat",
    workerResult = null,
    haloReview = null,
    boundedScope = [],
    acceptanceCriteria = [],
    planVersion = 1,
    highRiskEscalation = false,
    evidenceBasis = undefined,
    caller = "steamroller",
    requiresShell = false,
    requiresSubstantiveCode = false,
  } = {}) {
    if (!runId || typeof runId !== "string" || !runId.trim()) {
      throw new Error("Track L execution requires a non-empty runId");
    }

    let effectiveRole = String(workerRole || "bobcat").trim().toLowerCase();
    let reroutedFrom = null;
    let rerouteReason = null;

    const suitability = evaluateLightweightSuitability({
      role: effectiveRole,
      task,
      targetFiles: boundedScope,
      requiresShell,
      requiresSubstantiveCode,
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
        track: "L",
        contextDigest,
      });
      resolvedWorkerResult = await this.#invokeWorker(effectiveRole, {
        run_id: runId,
        track: "L",
        task,
        bounded_scope: boundedScope,
        acceptance_criteria: acceptanceCriteria,
        plan_version: planVersion,
        harness,
      });
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
          track: "L",
          contextDigest,
        });
        resolvedWorkerResult = await this.#invokeWorker(effectiveRole, {
          run_id: runId,
          track: "L",
          task,
          rerouted_from: reroutedFrom,
          bounded_scope: boundedScope,
          acceptance_criteria: acceptanceCriteria,
          plan_version: planVersion,
          harness: nextHarness,
        });
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
    });

    let rawHalo = haloReview;
    if (!rawHalo) {
      if (typeof this.#invokeHalo !== "function") {
        throw new Error("Track L requires invokeHalo for mandatory Strix Halo review");
      }
      rawHalo = await this.#invokeHalo(reviewRequest);
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
    if (highRiskEscalation) {
      if (typeof this.#invokeZen !== "function") {
        throw new Error("High-risk Track L escalation requires invokeZen handler");
      }
      zenVerdict = await this.#invokeZen({
        run_id: runId,
        track: "L",
        escalated_for_high_risk: true,
        plan_version: planVersion,
        task,
        bounded_scope: boundedScope,
        acceptance_criteria: acceptanceCriteria,
        halo_review: rawHalo,
      });
      if (zenVerdict?.verdict !== "GO") {
        throw new Error(
          `High-risk Track L Zen escalation failed with verdict '${zenVerdict?.verdict ?? "UNKNOWN"}'`
        );
      }
    }

    const record = this.lightweightLog.recordRun({
      run_id: runId,
      track: "L",
      assurance_badge: "HALO_LIGHTWEIGHT",
      status: "COMPLETED",
      plan_version: planVersion,
      goal: goal || task,
      caller,
      worker_role: effectiveRole,
      reviewed_diff_digest: reviewedDiffDigest,
      acceptance_criteria_digest: acceptanceCriteriaDigest,
      evidence_basis: resolvedEvidence,
      halo_review: rawHalo,
      escalated_to_ledger: zenVerdict
        ? {
            escalated: true,
            zen_verdict: zenVerdict.verdict,
            verified: true,
          }
        : null,
    });

    return {
      track: "L",
      assurance_badge: "HALO_LIGHTWEIGHT",
      run_id: runId,
      worker_role: effectiveRole,
      rerouted_from: reroutedFrom,
      reroute_reason: rerouteReason,
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
    const candidateRef = candidate?.candidate_artifact_ref ?? candidate?.artifact_ref ?? milestoneId;

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
          evidence_basis: candidate?.verification_evidence ?? [],
          track: normalizedTrack,
          acceptance_criteria: contract.acceptance_criteria ?? [],
        });
        rawHalo = await haloFn(req);
      }
      if (!rawHalo && requireHalo) {
        throw new Error(`Track ${normalizedTrack} requires a fresh bound Strix Halo ACCEPT review`);
      }
      if (rawHalo) {
        const normalizedPacket = {
          milestone_id: milestoneId,
          caller: rawHalo.caller ?? caller,
          candidate_id_or_run_id: rawHalo.candidate_id_or_run_id ?? candidateRef,
          reviewed_diff_digest: rawHalo.reviewed_diff_digest,
          acceptance_criteria_digest: rawHalo.acceptance_criteria_digest,
          plan_version: rawHalo.plan_version ?? planVersion,
          evidence_basis: rawHalo.evidence_basis,
          verdict: rawHalo.verdict,
          findings: rawHalo.findings ?? [],
          is_stale: rawHalo.is_stale === true,
        };
        if (this.ledger) {
          this.ledger.recordHaloReview(normalizedPacket);
          const fresh = this.ledger.isHaloReviewFresh(milestoneId, {
            candidate_id_or_run_id: normalizedPacket.candidate_id_or_run_id,
            reviewed_diff_digest: expectedDiffDigest,
            acceptance_criteria_digest: expectedCriteriaDigest,
            plan_version: planVersion,
            evidence_basis: rawHalo.evidence_basis,
          });
          if (!fresh.fresh) {
            throw new Error(`Halo review for '${milestoneId}' rejected: ${fresh.reason}`);
          }
          activeHalo = fresh.review;
        } else {
          const check = validateHaloReviewBinding(normalizedPacket, {
            candidate_id_or_run_id: normalizedPacket.candidate_id_or_run_id,
            reviewed_diff_digest: expectedDiffDigest,
            acceptance_criteria_digest: expectedCriteriaDigest,
            plan_version: planVersion,
          });
          if (!check.valid || normalizedPacket.verdict !== "ACCEPT") {
            throw new Error(`Halo review for '${milestoneId}' rejected: ${check.reason ?? normalizedPacket.verdict}`);
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

    const zenVerdict = await zenFn({
      milestone_id: milestoneId,
      plan_version: planVersion,
      track: normalizedTrack,
      candidate,
      contract,
      halo_review: activeHalo,
    });

    return {
      track: normalizedTrack,
      assurance_badge: "ZEN_DURABLE",
      milestone_id: milestoneId,
      halo_status: activeHalo ? "ACCEPTED" : "OMITTED",
      halo_review: activeHalo,
      zen_verdict: zenVerdict,
      verified: zenVerdict?.verdict === "GO",
    };
  }
}
