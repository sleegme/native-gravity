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

export class StaleVerdictError extends InvalidTransitionError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "StaleVerdictError";
    this.code = "STALE_VERDICT";
  }
}

export class MismatchedResultRefError extends InvalidTransitionError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "MismatchedResultRefError";
    this.code = "MISMATCHED_RESULT_REF";
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
 * Recursively freezes an object and its nested properties.
 *
 * @param {*} obj
 * @returns {*}
 */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = obj[key];
    if (val !== null && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

/**
 * Creates a deep clone of a plain object or array.
 * Uses structuredClone if available, falling back to JSON roundtrip.
 *
 * @param {*} obj
 * @returns {*}
 */
export function deepClone(obj) {
  if (typeof structuredClone === "function") {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
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
 * Normalizes candidate_artifact_ref and artifact_ref aliases to candidate_artifact_ref prior to hashing.
 * Fails closed if both aliases are present with different values.
 *
 * @param {object} candidatePacket
 * @returns {string}
 */
export function generateResultRef(candidatePacket) {
  if (!candidatePacket || typeof candidatePacket !== "object" || Array.isArray(candidatePacket)) {
    throw new InvariantViolationError("Candidate packet must be an object to generate result_ref");
  }

  const hasCand = candidatePacket.candidate_artifact_ref !== undefined;
  const hasArt = candidatePacket.artifact_ref !== undefined;

  if (hasCand && hasArt && candidatePacket.candidate_artifact_ref !== candidatePacket.artifact_ref) {
    throw new InvariantViolationError(
      `Conflicting candidate artifact references: candidate_artifact_ref '${candidatePacket.candidate_artifact_ref}' vs artifact_ref '${candidatePacket.artifact_ref}'`
    );
  }

  const clone = { ...candidatePacket };
  delete clone.result_ref;
  delete clone.resultRef;
  delete clone.artifact_ref;

  const effectiveRef = hasCand ? candidatePacket.candidate_artifact_ref : candidatePacket.artifact_ref;
  if (effectiveRef !== undefined) {
    clone.candidate_artifact_ref = effectiveRef;
  } else {
    delete clone.candidate_artifact_ref;
  }

  const artifactRef = effectiveRef ?? "";
  const canonical = canonicalJson(clone) + "::" + String(artifactRef);
  const hash = createHash("sha256").update(canonical, "utf-8").digest("hex");
  return `ref-sha256-${hash}`;
}

/**
 * Checks if a verification_evidence value is missing or empty.
 * Empty includes: undefined, null, empty string, whitespace-only string,
 * empty array, or array where all elements are empty/whitespace.
 *
 * @param {*} evidence
 * @returns {boolean}
 */
export function isEvidenceEmpty(evidence) {
  if (evidence === undefined || evidence === null) {
    return true;
  }
  if (typeof evidence === "string") {
    return !evidence.trim();
  }
  if (Array.isArray(evidence)) {
    if (evidence.length === 0) {
      return true;
    }
    return evidence.every((item) => {
      if (item === undefined || item === null) return true;
      if (typeof item === "string") return !item.trim();
      return false;
    });
  }
  return true;
}

/**
 * Validates candidate semantic invariants shared between live ingress (receiveCandidate)
 * and persistence / resume verification (verifyCandidateIntegrity / fromJSON).
 *
 * @param {object} packet
 * @param {object} [opts]
 * @param {string} [opts.expectedMilestone]
 * @param {string|number} [opts.expectedPlanVersion]
 * @param {string} [opts.milestoneLabel="expected"]
 * @param {string} [opts.planVersionLabel="expected"]
 * @param {Function} [opts.errorClass=InvariantViolationError]
 * @returns {boolean}
 */
export function validateCandidateSemantics(packet, opts = {}) {
  const ErrorClass = opts.errorClass || InvariantViolationError;

  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    throw new ErrorClass("Candidate packet must be an object");
  }

  const milestoneId = packet.milestone_id ?? packet.milestoneId;
  if (typeof milestoneId !== "string" || !milestoneId.trim()) {
    throw new ErrorClass("Candidate milestone_id must be a non-empty string");
  }
  if (
    opts.expectedMilestone !== undefined &&
    opts.expectedMilestone !== null &&
    milestoneId !== opts.expectedMilestone
  ) {
    const label = opts.milestoneLabel || "expected";
    throw new ErrorClass(
      `Candidate milestone_id '${milestoneId}' does not match ${label} milestone '${opts.expectedMilestone}'`
    );
  }

  const planVersion = packet.plan_version ?? packet.planVersion;
  if (planVersion === undefined || planVersion === null || planVersion === "") {
    throw new ErrorClass("Candidate plan_version must be present");
  }
  if (
    opts.expectedPlanVersion !== undefined &&
    opts.expectedPlanVersion !== null &&
    planVersion !== opts.expectedPlanVersion
  ) {
    const label = opts.planVersionLabel || "expected";
    throw new ErrorClass(
      `Candidate plan_version '${planVersion}' does not match ${label} plan_version '${opts.expectedPlanVersion}'`
    );
  }

  if (packet.status !== "DONE") {
    throw new ErrorClass(
      `Candidate packet status must be 'DONE' to enter candidate review path, got '${packet.status}'`
    );
  }

  // changes_made: must be provided (defined, non-null, Array or string)
  const changesMade = packet.changes_made;
  if (
    changesMade === undefined ||
    changesMade === null ||
    (!Array.isArray(changesMade) && typeof changesMade !== "string")
  ) {
    throw new ErrorClass(
      "Candidate changes_made must be provided as an Array or string"
    );
  }

  // verification_evidence: must be provided and CANNOT be empty
  if (isEvidenceEmpty(packet.verification_evidence)) {
    throw new ErrorClass(
      "Candidate verification_evidence must be provided and cannot be empty"
    );
  }

  // unresolved_unknowns: must be provided (defined, non-null, Array or string; [] is allowed)
  const unknowns = packet.unresolved_unknowns;
  if (
    unknowns === undefined ||
    unknowns === null ||
    (!Array.isArray(unknowns) && typeof unknowns !== "string")
  ) {
    throw new ErrorClass(
      "Candidate unresolved_unknowns must be provided as an Array or string"
    );
  }

  // scope_deviations: must be provided (defined, non-null, Array or string; [] is allowed)
  const deviations = packet.scope_deviations;
  if (
    deviations === undefined ||
    deviations === null ||
    (!Array.isArray(deviations) && typeof deviations !== "string")
  ) {
    throw new ErrorClass(
      "Candidate scope_deviations must be provided as an Array or string"
    );
  }

  // Check alias conflict fail-closed
  const hasCandArtifact = packet.candidate_artifact_ref !== undefined;
  const hasAliasArtifact = packet.artifact_ref !== undefined;
  if (
    hasCandArtifact &&
    hasAliasArtifact &&
    packet.candidate_artifact_ref !== packet.artifact_ref
  ) {
    throw new ErrorClass(
      `Conflicting candidate artifact references: candidate_artifact_ref '${packet.candidate_artifact_ref}' vs artifact_ref '${packet.artifact_ref}'`
    );
  }

  return true;
}

/**
 * Validates completed milestone Zen GO verification record semantic invariants.
 * Shared between live verification (recordZenGo) and persistence / resume (fromJSON).
 *
 * @param {object} verRecord
 * @param {object} [opts]
 * @param {string} [opts.expectedMilestone]
 * @param {string|number} [opts.expectedPlanVersion]
 * @param {string} [opts.expectedResultRef]
 * @param {Function} [opts.errorClass=InvariantViolationError]
 * @returns {boolean}
 */
export function validateZenGoSemantics(verRecord, opts = {}) {
  const ErrorClass = opts.errorClass || InvariantViolationError;

  if (!verRecord || typeof verRecord !== "object" || Array.isArray(verRecord)) {
    throw new ErrorClass("Zen GO verification record must be an object");
  }

  if (verRecord.verdict !== "GO") {
    throw new ErrorClass(
      `Zen GO verification record verdict must be 'GO', got '${verRecord.verdict}'`
    );
  }

  if (verRecord.is_stale) {
    throw new ErrorClass("Zen GO verification record cannot be stale");
  }

  const milestoneId = verRecord.milestone_id ?? verRecord.milestoneId;
  if (typeof milestoneId !== "string" || !milestoneId.trim()) {
    throw new ErrorClass("Zen GO verification milestone_id must be a non-empty string");
  }
  if (
    opts.expectedMilestone !== undefined &&
    opts.expectedMilestone !== null &&
    milestoneId !== opts.expectedMilestone
  ) {
    throw new ErrorClass(
      `Zen GO verification milestone_id '${milestoneId}' does not match expected milestone '${opts.expectedMilestone}'`
    );
  }

  const planVersion = verRecord.plan_version ?? verRecord.planVersion;
  if (planVersion === undefined || planVersion === null || planVersion === "") {
    throw new ErrorClass("Zen GO verification plan_version must be present");
  }
  if (
    opts.expectedPlanVersion !== undefined &&
    opts.expectedPlanVersion !== null &&
    planVersion !== opts.expectedPlanVersion
  ) {
    throw new ErrorClass(
      `Zen GO verification plan_version '${planVersion}' does not match expected plan_version '${opts.expectedPlanVersion}'`
    );
  }

  const resultRef = verRecord.result_ref ?? verRecord.resultRef;
  if (!resultRef || typeof resultRef !== "string" || !resultRef.trim()) {
    throw new ErrorClass("Zen GO verification result_ref must be a non-empty string");
  }
  if (
    opts.expectedResultRef !== undefined &&
    opts.expectedResultRef !== null &&
    resultRef !== opts.expectedResultRef
  ) {
    throw new ErrorClass(
      `Zen GO verification result_ref '${resultRef}' does not match expected candidate result_ref '${opts.expectedResultRef}'`
    );
  }

  if (isEvidenceEmpty(verRecord.verification_evidence)) {
    throw new ErrorClass(
      "Zen GO verification verification_evidence must be provided and cannot be empty"
    );
  }

  return true;
}

/**
 * Recomputes result_ref from candidate payload and artifact binding, verifying integrity.
 * Strictly verifies that candidate record and payload match across status, changes_made,
 * verification_evidence, unresolved_unknowns, scope_deviations, milestone_id, plan_version,
 * and artifact binding.
 * Throws InvariantViolationError if tampered or mismatched.
 *
 * @param {object} candidate
 * @param {string} [expectedRef]
 * @param {object} [opts]
 * @returns {string} Recomputed result_ref
 */
export function verifyCandidateIntegrity(candidate, expectedRef = null, opts = {}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new InvariantViolationError("Candidate record must be an object");
  }
  const storedRef = candidate.result_ref || candidate.resultRef;
  if (!storedRef || typeof storedRef !== "string" || !storedRef.trim()) {
    throw new InvariantViolationError("Candidate record missing valid result_ref");
  }
  if (expectedRef && storedRef !== expectedRef) {
    throw new InvariantViolationError(
      `Candidate result_ref '${storedRef}' does not match expected result_ref '${expectedRef}'`
    );
  }

  // Validate payload existence
  if (!candidate.payload || typeof candidate.payload !== "object" || Array.isArray(candidate.payload)) {
    throw new InvariantViolationError("Candidate record missing valid payload object");
  }

  const payload = candidate.payload;

  // Validate candidate record semantics fail-closed
  validateCandidateSemantics(candidate, {
    expectedMilestone: opts.expectedMilestone,
    expectedPlanVersion: opts.expectedPlanVersion,
    errorClass: InvariantViolationError,
  });

  // Validate candidate payload semantics fail-closed
  validateCandidateSemantics(payload, {
    expectedMilestone: opts.expectedMilestone,
    expectedPlanVersion: opts.expectedPlanVersion,
    errorClass: InvariantViolationError,
  });

  // 1. Status strictly match
  if (!candidate.status || typeof candidate.status !== "string") {
    throw new InvariantViolationError("Candidate record status must be a non-empty string");
  }
  if (candidate.status !== payload.status) {
    throw new InvariantViolationError(
      `Candidate record status '${candidate.status}' does not match payload status '${payload.status}' (tampering detected)`
    );
  }

  // 2. Milestone ID strictly match
  const candMilestone = candidate.milestone_id ?? candidate.milestoneId;
  const payloadMilestone = payload.milestone_id ?? payload.milestoneId;
  if (!candMilestone || typeof candMilestone !== "string") {
    throw new InvariantViolationError("Candidate record missing milestone_id");
  }
  if (candMilestone !== payloadMilestone) {
    throw new InvariantViolationError(
      `Candidate record milestone_id '${candMilestone}' does not match payload milestone_id '${payloadMilestone}' (tampering detected)`
    );
  }

  // 3. Plan version strictly match
  const candVersion = candidate.plan_version ?? candidate.planVersion;
  const payloadVersion = payload.plan_version ?? payload.planVersion;
  if (candVersion === undefined || candVersion === null) {
    throw new InvariantViolationError("Candidate record missing plan_version");
  }
  if (candVersion !== payloadVersion) {
    throw new InvariantViolationError(
      `Candidate record plan_version '${candVersion}' does not match payload plan_version '${payloadVersion}' (tampering detected)`
    );
  }

  // 4. changes_made strictly match
  if (candidate.changes_made === undefined || candidate.changes_made === null) {
    throw new InvariantViolationError("Candidate record missing changes_made");
  }
  if (payload.changes_made === undefined || payload.changes_made === null) {
    throw new InvariantViolationError("Candidate payload missing changes_made");
  }
  const normCandChanges = Array.isArray(candidate.changes_made)
    ? candidate.changes_made
    : [candidate.changes_made];
  const normPayloadChanges = Array.isArray(payload.changes_made)
    ? payload.changes_made
    : [payload.changes_made];
  if (canonicalJson(normCandChanges) !== canonicalJson(normPayloadChanges)) {
    throw new InvariantViolationError(
      "Candidate record changes_made does not match payload changes_made (tampering detected)"
    );
  }

  // 5. verification_evidence strictly match
  if (candidate.verification_evidence === undefined || candidate.verification_evidence === null) {
    throw new InvariantViolationError("Candidate record missing verification_evidence");
  }
  if (payload.verification_evidence === undefined || payload.verification_evidence === null) {
    throw new InvariantViolationError("Candidate payload missing verification_evidence");
  }
  const normCandEv = Array.isArray(candidate.verification_evidence)
    ? candidate.verification_evidence
    : [candidate.verification_evidence];
  const normPayloadEv = Array.isArray(payload.verification_evidence)
    ? payload.verification_evidence
    : [payload.verification_evidence];
  if (canonicalJson(normCandEv) !== canonicalJson(normPayloadEv)) {
    throw new InvariantViolationError(
      "Candidate record verification_evidence does not match payload verification_evidence (tampering detected)"
    );
  }

  // 6. unresolved_unknowns strictly match
  if (candidate.unresolved_unknowns === undefined || candidate.unresolved_unknowns === null) {
    throw new InvariantViolationError("Candidate record missing unresolved_unknowns");
  }
  if (payload.unresolved_unknowns === undefined || payload.unresolved_unknowns === null) {
    throw new InvariantViolationError("Candidate payload missing unresolved_unknowns");
  }
  const normCandUnknowns = Array.isArray(candidate.unresolved_unknowns)
    ? candidate.unresolved_unknowns
    : [candidate.unresolved_unknowns];
  const normPayloadUnknowns = Array.isArray(payload.unresolved_unknowns)
    ? payload.unresolved_unknowns
    : [payload.unresolved_unknowns];
  if (canonicalJson(normCandUnknowns) !== canonicalJson(normPayloadUnknowns)) {
    throw new InvariantViolationError(
      "Candidate record unresolved_unknowns does not match payload unresolved_unknowns (tampering detected)"
    );
  }

  // 7. scope_deviations strictly match
  if (candidate.scope_deviations === undefined || candidate.scope_deviations === null) {
    throw new InvariantViolationError("Candidate record missing scope_deviations");
  }
  if (payload.scope_deviations === undefined || payload.scope_deviations === null) {
    throw new InvariantViolationError("Candidate payload missing scope_deviations");
  }
  const normCandDeviations = Array.isArray(candidate.scope_deviations)
    ? candidate.scope_deviations
    : [candidate.scope_deviations];
  const normPayloadDeviations = Array.isArray(payload.scope_deviations)
    ? payload.scope_deviations
    : [payload.scope_deviations];
  if (canonicalJson(normCandDeviations) !== canonicalJson(normPayloadDeviations)) {
    throw new InvariantViolationError(
      "Candidate record scope_deviations does not match payload scope_deviations (tampering detected)"
    );
  }

  // 8. Artifact binding strictly match and alias conflict check
  if (
    candidate.candidate_artifact_ref !== undefined &&
    candidate.artifact_ref !== undefined &&
    candidate.candidate_artifact_ref !== candidate.artifact_ref
  ) {
    throw new InvariantViolationError(
      `Candidate record conflicting artifact references: '${candidate.candidate_artifact_ref}' vs '${candidate.artifact_ref}'`
    );
  }

  if (
    payload.candidate_artifact_ref !== undefined &&
    payload.artifact_ref !== undefined &&
    payload.candidate_artifact_ref !== payload.artifact_ref
  ) {
    throw new InvariantViolationError(
      `Candidate payload conflicting artifact references: '${payload.candidate_artifact_ref}' vs '${payload.artifact_ref}'`
    );
  }

  const recordArtifactRef = candidate.candidate_artifact_ref ?? candidate.artifact_ref;
  const payloadArtifactRef = payload.candidate_artifact_ref ?? payload.artifact_ref;

  const normRecordRef = recordArtifactRef !== undefined ? recordArtifactRef : null;
  const normPayloadRef = payloadArtifactRef !== undefined ? payloadArtifactRef : null;

  if (normRecordRef !== normPayloadRef) {
    throw new InvariantViolationError(
      `Candidate artifact binding mismatch: record '${recordArtifactRef}' vs payload '${payloadArtifactRef}' (tampering detected)`
    );
  }

  // Recompute result_ref using generateResultRef on payload
  const recomputedRef = generateResultRef(payload);
  if (recomputedRef !== storedRef) {
    throw new InvariantViolationError(
      `Candidate result_ref integrity check failed: stored '${storedRef}', recomputed '${recomputedRef}' (tampered candidate payload or artifact binding)`
    );
  }

  if (expectedRef && recomputedRef !== expectedRef) {
    throw new InvariantViolationError(
      `Candidate result_ref integrity check failed: expected '${expectedRef}', recomputed '${recomputedRef}'`
    );
  }

  return recomputedRef;
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
 * Parses a plan version string or number into a prefix and integer number.
 * Supports formats like 'v1', 'v2', 'v9', 'v10', or numbers 1, 2.
 *
 * @param {string|number} v
 * @returns {{ prefix: string, num: number }|null}
 */
export function parseVersion(v) {
  if (typeof v === "number" && Number.isFinite(v)) {
    return { prefix: "", num: v };
  }
  const str = String(v ?? "").trim();
  const match = str.match(/^([a-zA-Z]*)(\d+)$/);
  if (match) {
    return { prefix: match[1], num: parseInt(match[2], 10) };
  }
  return null;
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
    this._initialized = false;
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
    if (this._initialized) {
      throw new InvalidTransitionError(
        "Ledger is already initialized. Re-initialization is prohibited; use materialReplan to adopt plan revisions."
      );
    }
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

    this._initialized = true;

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
    if (!candidatePacket || typeof candidatePacket !== "object" || Array.isArray(candidatePacket)) {
      throw new InvalidTransitionError("Candidate packet must be an object");
    }

    if (this.current_milestone === null) {
      throw new InvalidTransitionError("No active milestone to receive candidate for");
    }

    validateCandidateSemantics(candidatePacket, {
      expectedMilestone: this.current_milestone,
      expectedPlanVersion: this.plan_version,
      milestoneLabel: "active",
      planVersionLabel: "current",
      errorClass: InvalidTransitionError,
    });

    const hasCandArtifact = candidatePacket.candidate_artifact_ref !== undefined;
    const hasAliasArtifact = candidatePacket.artifact_ref !== undefined;

    // Deep clone input packet to completely decouple from caller references
    const clonedPacket = deepClone(candidatePacket);

    // Normalize artifact reference on clonedPacket
    const effectiveArtifactRef = hasCandArtifact
      ? clonedPacket.candidate_artifact_ref
      : clonedPacket.artifact_ref;
    delete clonedPacket.artifact_ref;
    if (effectiveArtifactRef !== undefined) {
      clonedPacket.candidate_artifact_ref = effectiveArtifactRef;
    } else {
      delete clonedPacket.candidate_artifact_ref;
    }

    const computedRef = generateResultRef(clonedPacket);

    // If caller explicitly supplied a result_ref, it must match the computed deterministic hash
    const suppliedRef = candidatePacket.result_ref || candidatePacket.resultRef;
    if (suppliedRef && suppliedRef !== computedRef) {
      throw new RefRebindingError(
        `Supplied result_ref '${suppliedRef}' does not match computed deterministic hash '${computedRef}'`
      );
    }

    // Set canonical result_ref on clonedPacket
    delete clonedPacket.resultRef;
    clonedPacket.result_ref = computedRef;

    // Check against existing known candidates by ref
    const canonicalPayload = canonicalJson(clonedPacket);
    if (this._known_candidates_by_ref[computedRef]) {
      const existing = this._known_candidates_by_ref[computedRef];
      if (existing.canonicalPayload !== canonicalPayload) {
        throw new RefRebindingError(
          `Ref rebinding error: result_ref '${computedRef}' already registered to different candidate content`
        );
      }
    }

    const payload = deepFreeze(deepClone(clonedPacket));

    const candidateRecord = deepFreeze({
      milestone_id: this.current_milestone,
      plan_version: this.plan_version,
      result_ref: computedRef,
      candidate_artifact_ref: effectiveArtifactRef !== undefined ? effectiveArtifactRef : null,
      status: "DONE",
      changes_made: Array.isArray(clonedPacket.changes_made)
        ? deepClone(clonedPacket.changes_made)
        : [clonedPacket.changes_made],
      verification_evidence: Array.isArray(clonedPacket.verification_evidence)
        ? deepClone(clonedPacket.verification_evidence)
        : [clonedPacket.verification_evidence],
      unresolved_unknowns: Array.isArray(clonedPacket.unresolved_unknowns)
        ? deepClone(clonedPacket.unresolved_unknowns)
        : [clonedPacket.unresolved_unknowns],
      scope_deviations: Array.isArray(clonedPacket.scope_deviations)
        ? deepClone(clonedPacket.scope_deviations)
        : [clonedPacket.scope_deviations],
      timestamp: new Date().toISOString(),
      payload,
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
    if (!verdictPacket || typeof verdictPacket !== "object" || Array.isArray(verdictPacket)) {
      throw new InvalidTransitionError("Verdict packet must be an object");
    }

    if (this.current_milestone === null) {
      throw new InvalidTransitionError("No active milestone for Zen verdict");
    }

    const milestoneId = verdictPacket.milestone_id ?? verdictPacket.milestoneId;
    if (typeof milestoneId !== "string" || !milestoneId.trim()) {
      throw new InvalidTransitionError("Zen verdict milestone_id must be a non-empty string");
    }
    if (milestoneId !== this.current_milestone) {
      throw new InvalidTransitionError(
        `Zen verdict milestone_id '${milestoneId}' does not match active milestone '${this.current_milestone}'`
      );
    }

    const planVersion = verdictPacket.plan_version ?? verdictPacket.planVersion;
    if (planVersion === undefined || planVersion === null || planVersion === "") {
      throw new InvalidTransitionError("Zen verdict plan_version must be present");
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

    const resultRef = verdictPacket.result_ref ?? verdictPacket.resultRef;
    if (typeof resultRef !== "string" || !resultRef.trim()) {
      throw new InvalidTransitionError("Zen verdict result_ref must be a non-empty string");
    }
    if (resultRef !== activeCandidate.result_ref) {
      throw new MismatchedResultRefError(
        `Zen verdict result_ref '${resultRef}' does not match active candidate result_ref '${activeCandidate.result_ref}'`
      );
    }

    if (verdictPacket.verdict !== "NO-GO") {
      throw new InvalidTransitionError(
        `recordZenNoGo requires explicit verdict 'NO-GO', got '${verdictPacket.verdict}'`
      );
    }

    if (isEvidenceEmpty(verdictPacket.verification_evidence)) {
      throw new InvalidTransitionError(
        "Zen verdict verification_evidence must be provided and cannot be empty"
      );
    }

    const verificationRecord = Object.freeze({
      milestone_id: milestoneId,
      plan_version: this.plan_version,
      result_ref: resultRef,
      verdict: "NO-GO",
      verification_evidence: Array.isArray(verdictPacket.verification_evidence)
        ? [...verdictPacket.verification_evidence]
        : [verdictPacket.verification_evidence],
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
    if (!verdictPacket || typeof verdictPacket !== "object" || Array.isArray(verdictPacket)) {
      throw new InvalidTransitionError("Verdict packet must be an object");
    }

    if (this.current_milestone === null) {
      throw new InvalidTransitionError("No active milestone for Zen verdict");
    }

    const milestoneId = verdictPacket.milestone_id ?? verdictPacket.milestoneId;
    if (typeof milestoneId !== "string" || !milestoneId.trim()) {
      throw new InvalidTransitionError("Zen verdict milestone_id must be a non-empty string");
    }
    if (milestoneId !== this.current_milestone) {
      throw new InvalidTransitionError(
        `Zen verdict milestone_id '${milestoneId}' does not match active milestone '${this.current_milestone}'`
      );
    }

    const planVersion = verdictPacket.plan_version ?? verdictPacket.planVersion;
    if (planVersion === undefined || planVersion === null || planVersion === "") {
      throw new InvalidTransitionError("Zen verdict plan_version must be present");
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

    const resultRef = verdictPacket.result_ref ?? verdictPacket.resultRef;
    if (typeof resultRef !== "string" || !resultRef.trim()) {
      throw new InvalidTransitionError("Zen verdict result_ref must be a non-empty string");
    }
    if (resultRef !== activeCandidate.result_ref) {
      throw new MismatchedResultRefError(
        `Zen verdict result_ref '${resultRef}' does not match active candidate result_ref '${activeCandidate.result_ref}'`
      );
    }

    if (verdictPacket.verdict !== "GO") {
      throw new InvalidTransitionError(
        `recordZenGo requires explicit verdict 'GO', got '${verdictPacket.verdict}'`
      );
    }

    if (isEvidenceEmpty(verdictPacket.verification_evidence)) {
      throw new InvalidTransitionError(
        "Zen verdict verification_evidence must be provided and cannot be empty"
      );
    }

    const verificationRecord = Object.freeze({
      milestone_id: milestoneId,
      plan_version: this.plan_version,
      result_ref: resultRef,
      verdict: "GO",
      verification_evidence: Array.isArray(verdictPacket.verification_evidence)
        ? [...verdictPacket.verification_evidence]
        : [verdictPacket.verification_evidence],
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
    if (this.current_milestone !== null) {
      throw new InvalidTransitionError(
        `Cannot adopt material replan while milestone '${this.current_milestone}' is actively executing or under review`
      );
    }

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

    // Monotonically increment plan_version fail-closed
    const oldVersion = this.plan_version;
    let nextVersion;
    if (newPlanData.plan_version !== undefined) {
      const explicitVer = newPlanData.plan_version;
      if (typeof explicitVer !== typeof oldVersion) {
        throw new InvalidTransitionError(
          `Material replan plan_version type '${typeof explicitVer}' does not match current plan_version type '${typeof oldVersion}'`
        );
      }

      if (typeof oldVersion === "number") {
        if (!Number.isFinite(explicitVer) || !Number.isInteger(explicitVer)) {
          throw new InvalidTransitionError(
            `Material replan plan_version '${explicitVer}' must be an integer`
          );
        }
        if (explicitVer <= oldVersion) {
          throw new InvalidTransitionError(
            `Material replan plan_version '${explicitVer}' must strictly increment current plan_version '${oldVersion}'`
          );
        }
        nextVersion = explicitVer;
      } else if (typeof oldVersion === "string") {
        const oldParsed = parseVersion(oldVersion);
        const newParsed = parseVersion(explicitVer);
        if (!oldParsed || !newParsed) {
          throw new InvalidTransitionError(
            `Material replan plan_version '${explicitVer}' is not a valid or comparable version format`
          );
        }
        if (oldParsed.prefix !== newParsed.prefix) {
          throw new InvalidTransitionError(
            `Material replan plan_version '${explicitVer}' prefix '${newParsed.prefix}' does not match current prefix '${oldParsed.prefix}'`
          );
        }
        if (newParsed.num <= oldParsed.num) {
          throw new InvalidTransitionError(
            `Material replan plan_version '${explicitVer}' must strictly increment current plan_version '${oldVersion}'`
          );
        }
        nextVersion = explicitVer;
      } else {
        throw new InvalidTransitionError(
          `Current plan_version '${oldVersion}' has unsupported type '${typeof oldVersion}'`
        );
      }
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
      _initialized: this._initialized,
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
      if (!ver || typeof ver !== "object" || Array.isArray(ver)) {
        throw new InvariantViolationError(
          `Ledger state invalid: completed milestone '${completedId}' lacks verification entry`
        );
      }

      validateZenGoSemantics(ver, {
        expectedMilestone: completedId,
        expectedPlanVersion: data.plan_version,
        errorClass: InvariantViolationError,
      });

      const verResultRef = ver.result_ref ?? ver.resultRef;

      let candidate = null;
      if (data.evidence && typeof data.evidence === "object") {
        if (data.evidence[verResultRef]) {
          candidate = data.evidence[verResultRef];
        } else if (
          data.evidence[completedId] &&
          Array.isArray(data.evidence[completedId].candidates)
        ) {
          candidate = data.evidence[completedId].candidates.find(
            (c) => c && (c.result_ref === verResultRef || c.resultRef === verResultRef)
          );
        }
      }

      if (!candidate) {
        throw new InvariantViolationError(
          `Ledger state invalid: completed milestone '${completedId}' verification references dangling result_ref '${verResultRef}' not found in evidence`
        );
      }

      const candMilestoneId = candidate.milestone_id || candidate.milestoneId;
      const candPlanVersion = candidate.plan_version || candidate.planVersion;
      const candResultRef = candidate.result_ref || candidate.resultRef;

      if (candMilestoneId !== completedId) {
        throw new InvariantViolationError(
          `Ledger state invalid: candidate milestone_id '${candMilestoneId}' does not match completed milestone '${completedId}'`
        );
      }
      if (candPlanVersion !== data.plan_version) {
        throw new InvariantViolationError(
          `Ledger state invalid: candidate plan_version '${candPlanVersion}' does not match ledger plan_version '${data.plan_version}'`
        );
      }
      if (candResultRef !== verResultRef) {
        throw new InvariantViolationError(
          `Ledger state invalid: candidate result_ref '${candResultRef}' does not match verification result_ref '${verResultRef}'`
        );
      }

      // Recompute and verify candidate result_ref integrity fail-closed
      verifyCandidateIntegrity(candidate, verResultRef, {
        expectedMilestone: completedId,
        expectedPlanVersion: data.plan_version,
      });
      deepFreeze(candidate);

      if (
        data.evidence &&
        data.evidence[completedId] &&
        Array.isArray(data.evidence[completedId].candidates)
      ) {
        for (const c of data.evidence[completedId].candidates) {
          if (c && (c.result_ref === verResultRef || c.resultRef === verResultRef)) {
            verifyCandidateIntegrity(c, verResultRef, {
              expectedMilestone: completedId,
              expectedPlanVersion: data.plan_version,
            });
            deepFreeze(c);
          }
        }
      }

      if (
        data.evidence &&
        data.evidence[completedId] &&
        data.evidence[completedId].active_candidate
      ) {
        const evActive = data.evidence[completedId].active_candidate;
        if (evActive && (evActive.result_ref === verResultRef || evActive.resultRef === verResultRef)) {
          verifyCandidateIntegrity(evActive, verResultRef, {
            expectedMilestone: completedId,
            expectedPlanVersion: data.plan_version,
          });
          deepFreeze(evActive);
        }
      }
    }

    // Also recompute and verify integrity of any active candidate
    if (data.current_milestone !== null) {
      const activeCandidates = [];
      if (data._active_candidates && data._active_candidates[data.current_milestone]) {
        activeCandidates.push(data._active_candidates[data.current_milestone]);
      }
      if (
        data.evidence &&
        data.evidence[data.current_milestone] &&
        data.evidence[data.current_milestone].active_candidate
      ) {
        const evActive = data.evidence[data.current_milestone].active_candidate;
        if (!activeCandidates.includes(evActive)) {
          activeCandidates.push(evActive);
        }
      }
      for (const activeCand of activeCandidates) {
        verifyCandidateIntegrity(activeCand, null, {
          expectedMilestone: data.current_milestone,
          expectedPlanVersion: data.plan_version,
        });
        deepFreeze(activeCand);
      }
    }

    const ledger = new AuthoritativeLedger();
    ledger._initialized = true;
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
