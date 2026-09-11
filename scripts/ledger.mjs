import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Structured error classes for authoritative ledger transitions and invariant enforcement.
 */
export class InvalidTransitionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "InvalidTransitionError";
    this.code = "INVALID_TRANSITION";
    Object.assign(this, details);
  }
}

export class StaleVerdictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "StaleVerdictError";
    this.code = "STALE_VERDICT";
    Object.assign(this, details);
  }
}

export class MismatchedResultRefError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MismatchedResultRefError";
    this.code = "MISMATCHED_RESULT_REF";
    Object.assign(this, details);
  }
}

export class InvariantViolationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "InvariantViolationError";
    this.code = "INVARIANT_VIOLATION";
    Object.assign(this, details);
  }
}

export class RefRebindingError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RefRebindingError";
    this.code = "REF_REBINDING";
    Object.assign(this, details);
  }
}

export class BlockerNotFoundError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "BlockerNotFoundError";
    this.code = "BLOCKER_NOT_FOUND";
    Object.assign(this, details);
  }
}

/**
 * Deterministic JSON stringifier that sorts object keys recursively.
 *
 * @param {*} obj
 * @returns {string}
 */
export function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

/**
 * Generates a unique, deterministic result_ref (SHA-256) from candidate payload and artifact ref.
 *
 * @param {object} candidatePacket
 * @returns {string}
 */
export function generateResultRef(candidatePacket) {
  if (!candidatePacket || typeof candidatePacket !== "object") {
    throw new InvariantViolationError("Candidate packet must be an object to generate result_ref");
  }
  const clone = { ...candidatePacket };
  delete clone.result_ref;
  delete clone.resultRef;
  const artifactRef = clone.candidate_artifact_ref || clone.artifact_ref || "";
  const canonical = canonicalJson(clone) + "::" + String(artifactRef);
  const hash = createHash("sha256").update(canonical, "utf-8").digest("hex");
  return `ref-sha256-${hash}`;
}

/**
 * Monotonically increments plan_version identifier (e.g. 'v1' -> 'v2', 1 -> 2).
 *
 * @param {string|number} current
 * @returns {string|number}
 */
export function incrementPlanVersion(current) {
  if (typeof current === "number") {
    return current + 1;
  }
  const str = String(current || "v0").trim();
  const match = str.match(/^([a-zA-Z]*)(\d+)$/);
  if (match) {
    const prefix = match[1];
    const num = parseInt(match[2], 10);
    return `${prefix}${num + 1}`;
  }
  return `${str}.1`;
}

/**
 * Validates a plan specification: structure, milestone list, uniqueness, dependencies, and acyclicity.
 *
 * @param {object} plan
 */
export function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new InvariantViolationError("Plan must be a non-null object");
  }
  if (!plan.goal || typeof plan.goal !== "string" || !plan.goal.trim()) {
    throw new InvariantViolationError("Plan must include a non-empty 'goal' string");
  }
  if (!Array.isArray(plan.milestones) || plan.milestones.length === 0) {
    throw new InvariantViolationError("Plan must include a non-empty 'milestones' array");
  }

  const seenIds = new Set();
  for (const m of plan.milestones) {
    if (!m || typeof m !== "object") {
      throw new InvariantViolationError("Milestone entry must be an object");
    }
    if (!m.id || typeof m.id !== "string" || !m.id.trim()) {
      throw new InvariantViolationError("Milestone must have a non-empty string 'id'");
    }
    if (seenIds.has(m.id)) {
      throw new InvariantViolationError(`Duplicate milestone ID '${m.id}' in plan`);
    }
    seenIds.add(m.id);
  }

  for (const m of plan.milestones) {
    if (m.dependencies) {
      if (!Array.isArray(m.dependencies)) {
        throw new InvariantViolationError(`Milestone '${m.id}' dependencies must be an array`);
      }
      for (const dep of m.dependencies) {
        if (!seenIds.has(dep)) {
          throw new InvariantViolationError(
            `Milestone '${m.id}' references non-existent dependency '${dep}'`
          );
        }
        if (dep === m.id) {
          throw new InvariantViolationError(
            `Milestone '${m.id}' cannot depend on itself`
          );
        }
      }
    }
  }

  // Check acyclicity
  const milestoneMap = new Map(plan.milestones.map((m) => [m.id, m.dependencies || []]));
  const visited = new Set();
  const inStack = new Set();

  function dfs(id) {
    visited.add(id);
    inStack.add(id);
    const deps = milestoneMap.get(id) || [];
    for (const dep of deps) {
      if (!visited.has(dep)) {
        if (dfs(dep)) return true;
      } else if (inStack.has(dep)) {
        return true;
      }
    }
    inStack.delete(id);
    return false;
  }

  for (const m of plan.milestones) {
    if (!visited.has(m.id)) {
      if (dfs(m.id)) {
        throw new InvariantViolationError("Milestone graph contains circular dependencies");
      }
    }
  }
}

/**
 * Authoritative Project Ledger and State Machine.
 * Steamroller is the sole authority mutating ledger state.
 */
export class AuthoritativeLedger {
  constructor(initialPlan = null) {
    this.goal = "";
    this.constraints = [];
    this.plan_version = "v1";
    this.milestones = [];
    this.current_milestone = null;
    this.completed_milestones = [];
    this.evidence = {};
    this.verification = {};
    this.blockers = [];
    this.next_action = "";
    this.decision_invariants = [];

    // Internal tracking structures
    this._active_candidates = {};
    this._known_candidates_by_ref = {};
    this._verification_history = [];

    if (initialPlan) {
      this.init(initialPlan);
    }
  }

  /**
   * Initializes or adopts an initial plan.
   * Validates plan, sets plan_version, initializes empty active/completed state, sets next_action.
   *
   * @param {object} initialPlan
   * @returns {AuthoritativeLedger}
   */
  init(initialPlan) {
    validatePlan(initialPlan);

    this.goal = String(initialPlan.goal || "").trim();
    this.constraints = Array.isArray(initialPlan.constraints)
      ? [...initialPlan.constraints]
      : [];
    this.plan_version =
      initialPlan.plan_version !== undefined ? initialPlan.plan_version : "v1";
    this.milestones = initialPlan.milestones.map((m) => ({
      id: m.id,
      title: m.title || m.id,
      objective: m.objective || "",
      acceptance_criteria: Array.isArray(m.acceptance_criteria)
        ? [...m.acceptance_criteria]
        : m.acceptance_criteria
        ? [m.acceptance_criteria]
        : [],
      non_goals: Array.isArray(m.non_goals)
        ? [...m.non_goals]
        : m.non_goals
        ? [m.non_goals]
        : [],
      dependencies: Array.isArray(m.dependencies) ? [...m.dependencies] : [],
      bounded_scope: Array.isArray(m.bounded_scope)
        ? [...m.bounded_scope]
        : m.bounded_scope
        ? [m.bounded_scope]
        : [],
    }));

    this.current_milestone = null;
    this.completed_milestones = [];
    this.evidence = initialPlan.evidence ? { ...initialPlan.evidence } : {};
    this.verification = {};
    this.blockers = [];
    this.decision_invariants = Array.isArray(initialPlan.decision_invariants)
      ? [...initialPlan.decision_invariants]
      : [];

    this._active_candidates = {};
    this._known_candidates_by_ref = {};
    this._verification_history = [];

    const firstMilestone = this.milestones.find(
      (m) => !m.dependencies || m.dependencies.length === 0
    );
    this.next_action = firstMilestone
      ? `Ready to delegate initial milestone: ${firstMilestone.id}`
      : "Ready to delegate milestone";

    return this;
  }

  /**
   * Delegates a bounded milestone to Bulldozer.
   * Validates no active milestone, milestone exists, and all dependencies are completed.
   * Sets current_milestone and next_action. Returns handoff packet.
   *
   * @param {string} milestoneId
   * @returns {object} Steamroller -> Bulldozer handoff packet
   */
  delegate(milestoneId) {
    if (!milestoneId || typeof milestoneId !== "string") {
      throw new InvalidTransitionError("milestoneId must be a non-empty string");
    }

    if (this.current_milestone !== null) {
      throw new InvalidTransitionError(
        `Cannot delegate: milestone '${this.current_milestone}' is already active`
      );
    }

    const milestone = this.milestones.find((m) => m.id === milestoneId);
    if (!milestone) {
      throw new InvalidTransitionError(`Milestone '${milestoneId}' not found in current plan`);
    }

    if (this.completed_milestones.includes(milestoneId)) {
      throw new InvalidTransitionError(`Milestone '${milestoneId}' is already completed`);
    }

    const dependencies = milestone.dependencies || [];
    const unmet = dependencies.filter((dep) => !this.completed_milestones.includes(dep));
    if (unmet.length > 0) {
      throw new InvalidTransitionError(
        `Cannot delegate milestone '${milestoneId}': unmet dependencies [${unmet.join(", ")}]`
      );
    }

    this.current_milestone = milestoneId;
    this.next_action = `Executing milestone '${milestoneId}' via Bulldozer`;

    const handoffPacket = {
      milestone_id: milestone.id,
      plan_version: this.plan_version,
      objective: milestone.objective,
      bounded_scope: [...milestone.bounded_scope],
      non_goals: [...milestone.non_goals],
      acceptance_criteria: [...milestone.acceptance_criteria],
      constraints: [...this.constraints],
      relevant_evidence: this.getRelevantEvidence(milestoneId),
      decision_invariants: this.getRelevantDecisionInvariants(milestoneId),
    };

    return handoffPacket;
  }

  /**
   * Retrieves relevant evidence for a given milestone.
   *
   * @param {string} milestoneId
   * @returns {Array}
   */
  getRelevantEvidence(milestoneId) {
    const relevant = [];
    if (this.evidence[milestoneId]) {
      relevant.push(this.evidence[milestoneId]);
    }
    const milestone = this.milestones.find((m) => m.id === milestoneId);
    if (milestone && milestone.dependencies) {
      for (const dep of milestone.dependencies) {
        if (this.evidence[dep]) {
          relevant.push(this.evidence[dep]);
        }
      }
    }
    return relevant;
  }

  /**
   * Retrieves relevant decision invariants for a given milestone.
   *
   * @param {string} milestoneId
   * @returns {Array}
   */
  getRelevantDecisionInvariants(milestoneId) {
    if (!Array.isArray(this.decision_invariants)) return [];
    return this.decision_invariants.filter((di) => {
      if (!di.affects_milestones || !Array.isArray(di.affects_milestones)) return true;
      return di.affects_milestones.includes(milestoneId);
    });
  }

  /**
   * Receives pre-review candidate packet from Bulldozer.
   * Validates matching active milestone and current plan_version.
   * Generates unique deterministic result_ref, records immutable candidate in evidence,
   * keeps milestone active for Zen review, and prevents ref rebinding to changed content.
   *
   * @param {object} candidatePacket
   * @returns {{ result_ref: string, candidate_record: object }}
   */
  receiveCandidate(candidatePacket) {
    if (!candidatePacket || typeof candidatePacket !== "object") {
      throw new InvalidTransitionError("Candidate packet must be an object");
    }

    const milestoneId = candidatePacket.milestone_id || candidatePacket.milestoneId;
    const planVersion = candidatePacket.plan_version || candidatePacket.planVersion;

    if (this.current_milestone === null) {
      throw new InvalidTransitionError("No active milestone to receive candidate for");
    }

    if (milestoneId !== this.current_milestone) {
      throw new InvalidTransitionError(
        `Candidate milestone_id '${milestoneId}' does not match active milestone '${this.current_milestone}'`
      );
    }

    if (planVersion !== this.plan_version) {
      throw new InvalidTransitionError(
        `Candidate plan_version '${planVersion}' does not match current plan_version '${this.plan_version}'`
      );
    }

    const computedRef = generateResultRef(candidatePacket);

    // If caller explicitly supplied a result_ref, it must match the computed deterministic hash
    const suppliedRef = candidatePacket.result_ref || candidatePacket.resultRef;
    if (suppliedRef && suppliedRef !== computedRef) {
      throw new RefRebindingError(
        `Supplied result_ref '${suppliedRef}' does not match computed deterministic hash '${computedRef}'`
      );
    }

    // Check against existing known candidates by ref
    const canonicalPayload = canonicalJson(candidatePacket);
    if (this._known_candidates_by_ref[computedRef]) {
      const existing = this._known_candidates_by_ref[computedRef];
      if (existing.canonicalPayload !== canonicalPayload) {
        throw new RefRebindingError(
          `Ref rebinding error: result_ref '${computedRef}' already registered to different candidate content`
        );
      }
    }

    const candidateRecord = Object.freeze({
      milestone_id: this.current_milestone,
      plan_version: this.plan_version,
      result_ref: computedRef,
      candidate_artifact_ref:
        candidatePacket.candidate_artifact_ref || candidatePacket.artifact_ref || null,
      status: candidatePacket.status || "DONE",
      changes_made: Array.isArray(candidatePacket.changes_made)
        ? [...candidatePacket.changes_made]
        : [],
      verification_evidence: Array.isArray(candidatePacket.verification_evidence)
        ? [...candidatePacket.verification_evidence]
        : [],
      unresolved_unknowns: Array.isArray(candidatePacket.unresolved_unknowns)
        ? [...candidatePacket.unresolved_unknowns]
        : [],
      scope_deviations: Array.isArray(candidatePacket.scope_deviations)
        ? [...candidatePacket.scope_deviations]
        : [],
      timestamp: new Date().toISOString(),
      payload: Object.freeze({ ...candidatePacket, result_ref: computedRef }),
    });

    // Record immutable candidate in evidence
    if (!this.evidence[this.current_milestone]) {
      this.evidence[this.current_milestone] = { candidates: [] };
    } else if (Array.isArray(this.evidence[this.current_milestone])) {
      this.evidence[this.current_milestone] = {
        records: this.evidence[this.current_milestone],
        candidates: [],
      };
    }

    this.evidence[this.current_milestone].active_candidate = candidateRecord;
    this.evidence[this.current_milestone].candidates =
      this.evidence[this.current_milestone].candidates || [];
    this.evidence[this.current_milestone].candidates.push(candidateRecord);

    // Index by result_ref
    this.evidence[computedRef] = candidateRecord;

    this._active_candidates[this.current_milestone] = candidateRecord;
    this._known_candidates_by_ref[computedRef] = {
      record: candidateRecord,
      canonicalPayload,
    };

    // Milestone stays active for Zen review
    this.next_action = `Awaiting Zen review for milestone '${this.current_milestone}' (result_ref: ${computedRef})`;

    return {
      result_ref: computedRef,
      candidate_record: candidateRecord,
    };
  }

  /**
   * Records execution failure, blocker, or escalation needs from Bulldozer.
   * Clears current_milestone, records blockers and evidence, updates next_action.
   * Does NOT promote milestone.
   *
   * @param {object} opts
   * @param {string} [opts.milestoneId]
   * @param {string} [opts.status]
   * @param {*} [opts.blockers]
   * @param {*} [opts.escalationNeeds]
   * @param {*} [opts.evidence]
   * @returns {object}
   */
  recordBlockedOrFailure(opts = {}) {
    const milestoneId = opts.milestoneId || opts.milestone_id;
    const status = opts.status || "BLOCKED";
    const blockers = opts.blockers;
    const escalationNeeds = opts.escalationNeeds || opts.escalation_needs || null;
    const evidence = opts.evidence;

    if (this.current_milestone === null) {
      throw new InvalidTransitionError("No active milestone to record blocked or failure for");
    }

    if (milestoneId && milestoneId !== this.current_milestone) {
      throw new InvalidTransitionError(
        `milestoneId '${milestoneId}' does not match active milestone '${this.current_milestone}'`
      );
    }

    const activeMilestone = this.current_milestone;

    // Record blockers
    if (blockers) {
      const list = Array.isArray(blockers) ? blockers : [blockers];
      for (const b of list) {
        let blockerObj;
        if (typeof b === "string") {
          blockerObj = {
            id: `blocker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            description: b,
            affects_milestone: activeMilestone,
            escalation_path: escalationNeeds,
            created_at: new Date().toISOString(),
          };
        } else if (typeof b === "object" && b !== null) {
          blockerObj = {
            id: b.id || `blocker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            description: b.description || b.message || "Unspecified blocker",
            affects_milestone: b.affects_milestone || activeMilestone,
            escalation_path: b.escalation_path || escalationNeeds,
            created_at: b.created_at || new Date().toISOString(),
            ...b,
          };
        }
        if (blockerObj) {
          this.blockers.push(blockerObj);
        }
      }
    }

    // Record evidence
    if (evidence) {
      if (!this.evidence[activeMilestone]) {
        this.evidence[activeMilestone] = {};
      }
      if (!this.evidence[activeMilestone].failure_evidence) {
        this.evidence[activeMilestone].failure_evidence = [];
      }
      this.evidence[activeMilestone].failure_evidence.push({
        status,
        evidence,
        escalation_needs: escalationNeeds,
        timestamp: new Date().toISOString(),
      });
    }

    delete this._active_candidates[activeMilestone];
    this.current_milestone = null;
    this.next_action = `Milestone '${activeMilestone}' ended with status '${status}'. Escalation or repair required.`;

    return {
      milestone_id: activeMilestone,
      status,
      blockers: [...this.blockers],
    };
  }

  /**
   * Records Zen NO-GO verdict for the active candidate.
   * Validates milestoneId matches current_milestone, plan_version matches current plan_version,
   * and result_ref matches active candidate's result_ref.
   * Records NO-GO in verification, clears current_milestone, milestone remains incomplete.
   *
   * @param {object} verdictPacket
   * @returns {object} Verification record
   */
  recordZenNoGo(verdictPacket) {
    if (!verdictPacket || typeof verdictPacket !== "object") {
      throw new InvalidTransitionError("Verdict packet must be an object");
    }

    const milestoneId = verdictPacket.milestone_id || verdictPacket.milestoneId;
    const planVersion = verdictPacket.plan_version || verdictPacket.planVersion;
    const resultRef = verdictPacket.result_ref || verdictPacket.resultRef;

    if (this.current_milestone === null) {
      throw new InvalidTransitionError("No active milestone for Zen verdict");
    }

    if (milestoneId !== this.current_milestone) {
      throw new InvalidTransitionError(
        `Zen verdict milestone_id '${milestoneId}' does not match active milestone '${this.current_milestone}'`
      );
    }

    if (planVersion !== this.plan_version) {
      throw new StaleVerdictError(
        `Zen verdict plan_version '${planVersion}' does not match current ledger plan_version '${this.plan_version}'`
      );
    }

    const activeCandidate = this._active_candidates[this.current_milestone];
    if (!activeCandidate) {
      throw new InvalidTransitionError(
        `No active candidate received for milestone '${this.current_milestone}'`
      );
    }

    if (resultRef !== activeCandidate.result_ref) {
      throw new MismatchedResultRefError(
        `Zen verdict result_ref '${resultRef}' does not match active candidate result_ref '${activeCandidate.result_ref}'`
      );
    }

    const verdict = verdictPacket.verdict || "NO-GO";
    if (verdict !== "NO-GO") {
      throw new InvalidTransitionError(`recordZenNoGo called with non-NO-GO verdict '${verdict}'`);
    }

    const verificationRecord = Object.freeze({
      milestone_id: milestoneId,
      plan_version: this.plan_version,
      result_ref: resultRef,
      verdict: "NO-GO",
      verification_evidence: Array.isArray(verdictPacket.verification_evidence)
        ? [...verdictPacket.verification_evidence]
        : verdictPacket.verification_evidence
        ? [verdictPacket.verification_evidence]
        : [],
      repair_needs: verdictPacket.repair_needs || verdictPacket.reason || null,
      is_stale: false,
      timestamp: new Date().toISOString(),
      details: Object.freeze({ ...verdictPacket }),
    });

    this.verification[milestoneId] = verificationRecord;
    this._verification_history.push(verificationRecord);

    // Milestone remains incomplete
    delete this._active_candidates[milestoneId];
    this.current_milestone = null;
    this.next_action = `Zen NO-GO recorded for milestone '${milestoneId}'. Requires repair or replan.`;

    return verificationRecord;
  }

  /**
   * Records Zen GO verdict for the active candidate and promotes milestone.
   * Validates milestoneId matches current_milestone, plan_version matches current plan_version,
   * and result_ref matches active candidate's result_ref.
   * Records GO in verification, moves milestoneId to completed_milestones, clears current_milestone,
   * and updates next_action.
   *
   * @param {object} verdictPacket
   * @returns {object} Verification record
   */
  recordZenGo(verdictPacket) {
    if (!verdictPacket || typeof verdictPacket !== "object") {
      throw new InvalidTransitionError("Verdict packet must be an object");
    }

    const milestoneId = verdictPacket.milestone_id || verdictPacket.milestoneId;
    const planVersion = verdictPacket.plan_version || verdictPacket.planVersion;
    const resultRef = verdictPacket.result_ref || verdictPacket.resultRef;

    if (this.current_milestone === null) {
      throw new InvalidTransitionError("No active milestone for Zen verdict");
    }

    if (milestoneId !== this.current_milestone) {
      throw new InvalidTransitionError(
        `Zen verdict milestone_id '${milestoneId}' does not match active milestone '${this.current_milestone}'`
      );
    }

    if (planVersion !== this.plan_version) {
      throw new StaleVerdictError(
        `Zen verdict plan_version '${planVersion}' does not match current ledger plan_version '${this.plan_version}'`
      );
    }

    const activeCandidate = this._active_candidates[this.current_milestone];
    if (!activeCandidate) {
      throw new InvalidTransitionError(
        `No active candidate received for milestone '${this.current_milestone}'`
      );
    }

    if (resultRef !== activeCandidate.result_ref) {
      throw new MismatchedResultRefError(
        `Zen verdict result_ref '${resultRef}' does not match active candidate result_ref '${activeCandidate.result_ref}'`
      );
    }

    const verdict = verdictPacket.verdict || "GO";
    if (verdict !== "GO") {
      throw new InvalidTransitionError(`recordZenGo called with non-GO verdict '${verdict}'`);
    }

    const verificationRecord = Object.freeze({
      milestone_id: milestoneId,
      plan_version: this.plan_version,
      result_ref: resultRef,
      verdict: "GO",
      verification_evidence: Array.isArray(verdictPacket.verification_evidence)
        ? [...verdictPacket.verification_evidence]
        : verdictPacket.verification_evidence
        ? [verdictPacket.verification_evidence]
        : [],
      is_stale: false,
      timestamp: new Date().toISOString(),
      details: Object.freeze({ ...verdictPacket }),
    });

    this.verification[milestoneId] = verificationRecord;
    this._verification_history.push(verificationRecord);

    if (!this.completed_milestones.includes(milestoneId)) {
      this.completed_milestones.push(milestoneId);
    }

    delete this._active_candidates[milestoneId];
    this.current_milestone = null;

    const remaining = this.milestones.filter((m) => !this.completed_milestones.includes(m.id));
    if (remaining.length === 0) {
      this.next_action = `All milestones completed. Ready to declare global completion.`;
    } else {
      this.next_action = `Milestone '${milestoneId}' verified (GO). Ready to delegate next milestone.`;
    }

    return verificationRecord;
  }

  /**
   * Adopts a material replan.
   * Monotonically increments plan_version.
   * Marks all existing verification records as stale (is_stale = true).
   * Clears completed_milestones and current_milestone.
   * Updates milestone graph and invariants.
   * Preserves evidence and verification history.
   * Retained milestones must pass fresh in dependency order.
   *
   * @param {object} newPlanData
   * @returns {AuthoritativeLedger}
   */
  materialReplan(newPlanData) {
    if (!newPlanData || typeof newPlanData !== "object") {
      throw new InvariantViolationError("newPlanData must be a non-null object");
    }

    if (!Array.isArray(newPlanData.milestones) || newPlanData.milestones.length === 0) {
      throw new InvariantViolationError("newPlanData must include a non-empty milestones array");
    }

    validatePlan({
      goal: newPlanData.goal || this.goal,
      milestones: newPlanData.milestones,
    });

    // Monotonically increment plan_version
    const oldVersion = this.plan_version;
    let nextVersion;
    if (newPlanData.plan_version !== undefined) {
      if (newPlanData.plan_version === oldVersion) {
        throw new InvalidTransitionError(
          `Material replan plan_version must strictly increment current plan_version '${oldVersion}'`
        );
      }
      nextVersion = newPlanData.plan_version;
    } else {
      nextVersion = incrementPlanVersion(oldVersion);
    }
    this.plan_version = nextVersion;

    // Mark all existing verification records as stale
    for (const milestoneId of Object.keys(this.verification)) {
      if (this.verification[milestoneId]) {
        this.verification[milestoneId] = Object.freeze({
          ...this.verification[milestoneId],
          is_stale: true,
        });
      }
    }
    this._verification_history = this._verification_history.map((rec) =>
      Object.freeze({
        ...rec,
        is_stale: true,
      })
    );

    // Clear completed_milestones and current_milestone
    this.completed_milestones = [];
    this.current_milestone = null;
    this._active_candidates = {};

    // Update milestone graph and invariants
    this.milestones = newPlanData.milestones.map((m) => ({
      id: m.id,
      title: m.title || m.id,
      objective: m.objective || "",
      acceptance_criteria: Array.isArray(m.acceptance_criteria)
        ? [...m.acceptance_criteria]
        : m.acceptance_criteria
        ? [m.acceptance_criteria]
        : [],
      non_goals: Array.isArray(m.non_goals)
        ? [...m.non_goals]
        : m.non_goals
        ? [m.non_goals]
        : [],
      dependencies: Array.isArray(m.dependencies) ? [...m.dependencies] : [],
      bounded_scope: Array.isArray(m.bounded_scope)
        ? [...m.bounded_scope]
        : m.bounded_scope
        ? [m.bounded_scope]
        : [],
    }));

    if (newPlanData.decision_invariants) {
      this.decision_invariants = Array.isArray(newPlanData.decision_invariants)
        ? [...newPlanData.decision_invariants]
        : [];
    }
    if (newPlanData.constraints) {
      this.constraints = Array.isArray(newPlanData.constraints)
        ? [...newPlanData.constraints]
        : [];
    }
    if (newPlanData.goal) {
      this.goal = String(newPlanData.goal).trim();
    }

    this.next_action = `Material replan adopted (version: ${this.plan_version}). Retained milestones must pass fresh in dependency order.`;

    return this;
  }

  /**
   * Resolves an active blocker on observed resolution evidence.
   * Removes blocker from blockers, records resolution evidence in evidence.
   * Never promotes a milestone.
   *
   * @param {string} blockerId
   * @param {*} resolutionEvidence
   * @returns {object} Resolution record
   */
  resolveBlocker(blockerId, resolutionEvidence) {
    if (!blockerId || typeof blockerId !== "string") {
      throw new BlockerNotFoundError("blockerId must be a non-empty string");
    }

    const index = this.blockers.findIndex((b) => b.id === blockerId);
    if (index === -1) {
      throw new BlockerNotFoundError(`Blocker '${blockerId}' not found in active blockers`);
    }

    if (
      resolutionEvidence === undefined ||
      resolutionEvidence === null ||
      (typeof resolutionEvidence === "string" && !resolutionEvidence.trim()) ||
      (Array.isArray(resolutionEvidence) && resolutionEvidence.length === 0)
    ) {
      throw new InvariantViolationError(
        "Observed resolution evidence is strictly required to resolve a blocker"
      );
    }

    const [resolvedBlocker] = this.blockers.splice(index, 1);

    const resolutionRecord = {
      type: "blocker_resolution",
      blocker_id: blockerId,
      blocker: resolvedBlocker,
      resolution_evidence: resolutionEvidence,
      timestamp: new Date().toISOString(),
    };

    if (!this.evidence.resolved_blockers) {
      this.evidence.resolved_blockers = [];
    }
    this.evidence.resolved_blockers.push(resolutionRecord);

    this.next_action = `Blocker '${blockerId}' resolved with observed evidence. Ready for next action.`;

    return resolutionRecord;
  }

  /**
   * Declares global project completion.
   * Enforces that:
   * 1. current_milestone is null
   * 2. All milestones in plan exist in completed_milestones
   * 3. Each milestone has a valid non-stale Zen GO matching current plan_version
   * 4. No active blockers exist
   * Throws InvariantViolationError if any condition is unmet.
   *
   * @returns {object} Completion report
   */
  declareGlobalCompletion() {
    if (this.current_milestone !== null) {
      throw new InvariantViolationError(
        `Cannot declare global completion: milestone '${this.current_milestone}' is still active`
      );
    }

    if (this.blockers.length > 0) {
      throw new InvariantViolationError(
        `Cannot declare global completion: ${this.blockers.length} active blocker(s) remain`
      );
    }

    if (this.milestones.length === 0) {
      throw new InvariantViolationError(
        "Cannot declare global completion: plan contains no milestones"
      );
    }

    for (const milestone of this.milestones) {
      if (!this.completed_milestones.includes(milestone.id)) {
        throw new InvariantViolationError(
          `Cannot declare global completion: milestone '${milestone.id}' is not in completed_milestones`
        );
      }

      const ver = this.verification[milestone.id];
      if (!ver) {
        throw new InvariantViolationError(
          `Cannot declare global completion: milestone '${milestone.id}' lacks a verification record`
        );
      }

      if (ver.verdict !== "GO") {
        throw new InvariantViolationError(
          `Cannot declare global completion: milestone '${milestone.id}' has non-GO verdict '${ver.verdict}'`
        );
      }

      if (ver.is_stale) {
        throw new InvariantViolationError(
          `Cannot declare global completion: milestone '${milestone.id}' has stale verification record`
        );
      }

      if (ver.plan_version !== this.plan_version) {
        throw new InvariantViolationError(
          `Cannot declare global completion: milestone '${milestone.id}' verification plan_version '${ver.plan_version}' does not match current plan_version '${this.plan_version}'`
        );
      }
    }

    this.next_action = `Project execution completed. All milestones verified under plan version ${this.plan_version}.`;

    return {
      completed: true,
      plan_version: this.plan_version,
      completed_milestones: [...this.completed_milestones],
      total_milestones: this.milestones.length,
    };
  }

  /**
   * Serializes ledger state to plain object representation.
   *
   * @returns {object}
   */
  toJSON() {
    return {
      goal: this.goal,
      constraints: this.constraints,
      plan_version: this.plan_version,
      milestones: this.milestones,
      current_milestone: this.current_milestone,
      completed_milestones: this.completed_milestones,
      evidence: this.evidence,
      verification: this.verification,
      blockers: this.blockers,
      next_action: this.next_action,
      decision_invariants: this.decision_invariants,
      _active_candidates: this._active_candidates,
      _known_candidates_by_ref: this._known_candidates_by_ref,
      _verification_history: this._verification_history,
    };
  }

  /**
   * Alias for toJSON().
   *
   * @returns {object}
   */
  getState() {
    return this.toJSON();
  }

  /**
   * Persists ledger atomically to disk (via temp file write + rename).
   *
   * @param {string} filePath
   */
  save(filePath) {
    if (!filePath || typeof filePath !== "string") {
      throw new Error("filePath must be a non-empty string");
    }
    const resolved = resolve(filePath);
    const dir = dirname(resolved);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tempFile = join(dir, `.ledger-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    const jsonStr = JSON.stringify(this.toJSON(), null, 2);
    writeFileSync(tempFile, jsonStr, "utf-8");
    renameSync(tempFile, resolved);
  }

  /**
   * Restores AuthoritativeLedger instance from plain data object, validating all invariants.
   *
   * @param {object} data
   * @returns {AuthoritativeLedger}
   */
  static fromJSON(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new InvariantViolationError("Ledger state data must be an object");
    }

    if (typeof data.goal !== "string") {
      throw new InvariantViolationError("Ledger state invalid: 'goal' must be a string");
    }
    if (!Array.isArray(data.constraints)) {
      throw new InvariantViolationError("Ledger state invalid: 'constraints' must be an array");
    }
    if (data.plan_version === undefined || data.plan_version === null) {
      throw new InvariantViolationError("Ledger state invalid: 'plan_version' is required");
    }
    if (!Array.isArray(data.milestones)) {
      throw new InvariantViolationError("Ledger state invalid: 'milestones' must be an array");
    }
    if (!Array.isArray(data.completed_milestones)) {
      throw new InvariantViolationError(
        "Ledger state invalid: 'completed_milestones' must be an array"
      );
    }
    if (typeof data.evidence !== "object" || data.evidence === null) {
      throw new InvariantViolationError("Ledger state invalid: 'evidence' must be an object");
    }
    if (typeof data.verification !== "object" || data.verification === null) {
      throw new InvariantViolationError("Ledger state invalid: 'verification' must be an object");
    }
    if (!Array.isArray(data.blockers)) {
      throw new InvariantViolationError("Ledger state invalid: 'blockers' must be an array");
    }
    if (!Array.isArray(data.decision_invariants)) {
      throw new InvariantViolationError(
        "Ledger state invalid: 'decision_invariants' must be an array"
      );
    }

    validatePlan({ goal: data.goal, milestones: data.milestones });

    const milestoneIds = new Set(data.milestones.map((m) => m.id));
    if (data.current_milestone !== null && !milestoneIds.has(data.current_milestone)) {
      throw new InvariantViolationError(
        `Ledger state invalid: active current_milestone '${data.current_milestone}' not in milestones`
      );
    }

    for (const completedId of data.completed_milestones) {
      if (!milestoneIds.has(completedId)) {
        throw new InvariantViolationError(
          `Ledger state invalid: completed milestone '${completedId}' not in milestones`
        );
      }
      const ver = data.verification[completedId];
      if (!ver) {
        throw new InvariantViolationError(
          `Ledger state invalid: completed milestone '${completedId}' lacks verification entry`
        );
      }
      if (ver.verdict !== "GO") {
        throw new InvariantViolationError(
          `Ledger state invalid: completed milestone '${completedId}' verification verdict is '${ver.verdict}'`
        );
      }
      if (ver.is_stale) {
        throw new InvariantViolationError(
          `Ledger state invalid: completed milestone '${completedId}' has stale verification`
        );
      }
    }

    const ledger = new AuthoritativeLedger();
    ledger.goal = data.goal;
    ledger.constraints = [...data.constraints];
    ledger.plan_version = data.plan_version;
    ledger.milestones = data.milestones.map((m) => ({ ...m }));
    ledger.current_milestone = data.current_milestone;
    ledger.completed_milestones = [...data.completed_milestones];
    ledger.evidence = { ...data.evidence };
    ledger.verification = { ...data.verification };
    ledger.blockers = data.blockers.map((b) => ({ ...b }));
    ledger.next_action = data.next_action || "";
    ledger.decision_invariants = data.decision_invariants.map((di) => ({ ...di }));

    ledger._active_candidates = data._active_candidates ? { ...data._active_candidates } : {};
    ledger._known_candidates_by_ref = data._known_candidates_by_ref
      ? { ...data._known_candidates_by_ref }
      : {};
    ledger._verification_history = Array.isArray(data._verification_history)
      ? [...data._verification_history]
      : [];

    return ledger;
  }

  /**
   * Reads and restores AuthoritativeLedger state from disk file, validating all invariants.
   *
   * @param {string} filePath
   * @returns {AuthoritativeLedger}
   */
  static load(filePath) {
    if (!filePath || typeof filePath !== "string") {
      throw new Error("filePath must be a non-empty string");
    }
    const resolved = resolve(filePath);
    const content = readFileSync(resolved, "utf-8");
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new InvariantViolationError(`Failed to parse ledger JSON: ${err.message}`);
    }
    return AuthoritativeLedger.fromJSON(parsed);
  }
}
