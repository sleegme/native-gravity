import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { redactTelemetryValue } from "../../scripts/telemetry.mjs";
import { snapshotScope, validateCoverage } from "../../scripts/coverage.mjs";
import { acquireLedgerLock, recoverStaleLock, verifyLedgerIntegrity } from "./lock-manager.mjs";
import { computeAcceptanceDigest, validateHaloReviewBinding } from "./lightweight-log.mjs";

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

export class UncoveredCriteriaError extends InvalidTransitionError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "UncoveredCriteriaError";
    this.code = "UNCOVERED_CRITERIA";
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

export const DEFAULT_MAX_RECOVERY_RETRIES = 3;
export const HALO_ALLOWED_CALLERS = Object.freeze(["steamroller", "bulldozer", "bobcat"]);

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

export function deepClone(obj) {
  if (typeof structuredClone === "function") {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

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
 * Code-computed delivered working-tree digest over bounded_scope (#201 A3).
 */
export function computeDeliveredTreeDigest(boundedScope, { cwd } = {}) {
  const snap = snapshotScope(Array.isArray(boundedScope) ? boundedScope : [], { cwd });
  return `sha256:${createHash("sha256").update(JSON.stringify(snap.files)).digest("hex")}`;
}

export function normalizeCandidateArtifactRef(candidatePacket, { errorClass = InvariantViolationError } = {}) {
  if (!candidatePacket || typeof candidatePacket !== "object" || Array.isArray(candidatePacket)) {
    throw new errorClass("Candidate packet must be an object");
  }

  const hasCand = candidatePacket.candidate_artifact_ref !== undefined;
  const hasArt = candidatePacket.artifact_ref !== undefined;

  if (hasCand && hasArt && candidatePacket.candidate_artifact_ref !== candidatePacket.artifact_ref) {
    throw new errorClass(
      `Conflicting candidate artifact references: candidate_artifact_ref '${candidatePacket.candidate_artifact_ref}' vs artifact_ref '${candidatePacket.artifact_ref}'`
    );
  }

  const clone = { ...candidatePacket };
  delete clone.artifact_ref;

  const effectiveRef = hasCand ? candidatePacket.candidate_artifact_ref : candidatePacket.artifact_ref;
  if (effectiveRef !== undefined) {
    clone.candidate_artifact_ref = effectiveRef;
  } else {
    delete clone.candidate_artifact_ref;
  }

  return clone;
}

export function generateResultRef(candidatePacket) {
  const clone = normalizeCandidateArtifactRef(candidatePacket);
  delete clone.result_ref;
  delete clone.resultRef;
  const artifactRef = clone.candidate_artifact_ref ?? "";
  const canonical = canonicalJson(clone) + "::" + String(artifactRef);
  const hash = createHash("sha256").update(canonical, "utf-8").digest("hex");
  return `ref-sha256-${hash}`;
}

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

export function uncoveredAcceptanceCriteria(acceptanceCriteria, verificationEvidence) {
  const criteria = Array.isArray(acceptanceCriteria) ? acceptanceCriteria : [];
  if (criteria.length === 0) return [];
  const items = Array.isArray(verificationEvidence)
    ? verificationEvidence
    : verificationEvidence === undefined || verificationEvidence === null
      ? []
      : [verificationEvidence];
  const covered = new Set(
    items
      .filter(item => item && typeof item === "object"
        && item.classification === "OBSERVED"
        && typeof item.criterion === "string"
        && item.criterion.trim()
        && typeof item.result === "string"
        && item.result.trim())
      .map(item => item.criterion.trim())
  );
  return criteria.filter(
    criterion => !covered.has(typeof criterion === "string" ? criterion.trim() : criterion)
  );
}

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

  const changesMade = packet.changes_made;
  if (
    changesMade === undefined ||
    changesMade === null ||
    (!Array.isArray(changesMade) && typeof changesMade !== "string")
  ) {
    throw new ErrorClass("Candidate changes_made must be provided as an Array or string");
  }

  if (isEvidenceEmpty(packet.verification_evidence)) {
    throw new ErrorClass("Candidate verification_evidence must be provided and cannot be empty");
  }

  const unknowns = packet.unresolved_unknowns;
  if (
    unknowns === undefined ||
    unknowns === null ||
    (!Array.isArray(unknowns) && typeof unknowns !== "string")
  ) {
    throw new ErrorClass("Candidate unresolved_unknowns must be provided as an Array or string");
  }

  const deviations = packet.scope_deviations;
  if (
    deviations === undefined ||
    deviations === null ||
    (!Array.isArray(deviations) && typeof deviations !== "string")
  ) {
    throw new ErrorClass("Candidate scope_deviations must be provided as an Array or string");
  }

  normalizeCandidateArtifactRef(packet, { errorClass: ErrorClass });

  return true;
}

export function validateZenGoSemantics(verRecord, opts = {}) {
  const ErrorClass = opts.errorClass || InvariantViolationError;

  if (!verRecord || typeof verRecord !== "object" || Array.isArray(verRecord)) {
    throw new ErrorClass("Zen GO verification record must be an object");
  }

  if (verRecord.verdict !== "GO") {
    throw new ErrorClass(`Zen GO verification record verdict must be 'GO', got '${verRecord.verdict}'`);
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
    throw new ErrorClass("Zen GO verification verification_evidence must be provided and cannot be empty");
  }

  if (Array.isArray(opts.expectedCriteria)) {
    const uncovered = uncoveredAcceptanceCriteria(opts.expectedCriteria, verRecord.verification_evidence);
    if (uncovered.length) {
      throw new ErrorClass(
        `Zen GO verification must cover every acceptance criterion with OBSERVED evidence naming the criterion and a non-empty result; uncovered: ${JSON.stringify(uncovered)}`
      );
    }
  }

  return true;
}

/**
 * Single authoritative runtime Zen verdict validator shared by LedgerKernel,
 * TrackRunner, and SteamrollerController (#233).
 */
export function validateZenVerdictPacket(verdict, opts = {}) {
  const ErrorClass = opts.errorClass || InvalidTransitionError;
  const StaleErrorClass = opts.staleErrorClass || ErrorClass;
  const MismatchErrorClass = opts.mismatchErrorClass || ErrorClass;
  const NoGoErrorClass = opts.noGoErrorClass || ErrorClass;
  const requireObservedItems = opts.requireObservedItems !== false;
  const requireRepairNeedsForNoGo = opts.requireRepairNeedsForNoGo !== false;

  if (!verdict || typeof verdict !== "object" || Array.isArray(verdict)) {
    throw new ErrorClass("Verdict packet must be an object");
  }

  const milestoneId = verdict.milestone_id ?? verdict.milestoneId;
  if (typeof milestoneId !== "string" || !milestoneId.trim()) {
    throw new ErrorClass(
      opts.expectedMilestone !== undefined && opts.expectedMilestone !== null
        ? "Zen verdict does not match the current candidate binding"
        : "Zen verdict milestone_id must be a non-empty string"
    );
  }
  if (
    opts.expectedMilestone !== undefined &&
    opts.expectedMilestone !== null &&
    milestoneId !== opts.expectedMilestone
  ) {
    throw new ErrorClass(
      `Zen verdict does not match the current candidate binding: milestone_id '${milestoneId}' != '${opts.expectedMilestone}'`
    );
  }

  const planVersion = verdict.plan_version ?? verdict.planVersion;
  if (planVersion === undefined || planVersion === null || planVersion === "") {
    throw new ErrorClass(
      opts.expectedPlanVersion !== undefined && opts.expectedPlanVersion !== null
        ? "Zen verdict does not match the current candidate binding"
        : "Zen verdict plan_version must be present"
    );
  }
  if (
    opts.expectedPlanVersion !== undefined &&
    opts.expectedPlanVersion !== null &&
    planVersion !== opts.expectedPlanVersion
  ) {
    throw new StaleErrorClass(
      `Zen verdict does not match the current candidate binding: plan_version '${planVersion}' != '${opts.expectedPlanVersion}'`
    );
  }

  if (typeof opts.beforeResultRefCheck === "function") {
    opts.beforeResultRefCheck();
  }

  const resultRef = verdict.result_ref ?? verdict.resultRef;
  if (typeof resultRef !== "string" || !resultRef.trim()) {
    throw new ErrorClass(
      opts.expectedResultRef !== undefined && opts.expectedResultRef !== null
        ? "Zen verdict does not match the current candidate binding"
        : "Zen verdict result_ref must be a non-empty string"
    );
  }
  if (
    opts.expectedResultRef !== undefined &&
    opts.expectedResultRef !== null &&
    resultRef !== opts.expectedResultRef
  ) {
    throw new MismatchErrorClass(
      `Zen verdict does not match the current candidate binding: result_ref '${resultRef}' != '${opts.expectedResultRef}'`
    );
  }

  if (verdict.verdict !== "GO" && verdict.verdict !== "NO-GO") {
    throw new ErrorClass("Zen must return an observed GO or NO-GO");
  }
  if (opts.expectedVerdict && verdict.verdict !== opts.expectedVerdict) {
    throw new ErrorClass(
      `Expected Zen verdict '${opts.expectedVerdict}', got '${verdict.verdict}'`
    );
  }

  const verdictTreeDigest = verdict.delivered_tree_digest ?? null;
  if (
    opts.candidateTreeDigest &&
    opts.expectedTreeDigest &&
    opts.candidateTreeDigest !== opts.expectedTreeDigest
  ) {
    throw new ErrorClass(
      `Zen GO delivered_tree_digest '${opts.expectedTreeDigest}' does not match candidate digest '${opts.candidateTreeDigest}'`
    );
  }
  if (
    opts.candidateTreeDigest &&
    verdictTreeDigest !== null &&
    opts.candidateTreeDigest !== verdictTreeDigest
  ) {
    throw new ErrorClass(
      `Zen GO delivered_tree_digest '${verdictTreeDigest}' does not match candidate digest '${opts.candidateTreeDigest}'`
    );
  }
  if (
    opts.expectedTreeDigest &&
    verdictTreeDigest !== null &&
    opts.expectedTreeDigest !== verdictTreeDigest
  ) {
    throw new ErrorClass(
      `Zen GO delivered_tree_digest '${verdictTreeDigest}' does not match candidate digest '${opts.expectedTreeDigest}'`
    );
  }

  if (
    !Array.isArray(verdict.verification_evidence) ||
    verdict.verification_evidence.length === 0 ||
    isEvidenceEmpty(verdict.verification_evidence)
  ) {
    throw new ErrorClass("Zen must supply directly observed verification evidence");
  }

  if (requireObservedItems) {
    const unobserved = verdict.verification_evidence.filter((item) => item?.classification !== "OBSERVED");
    if (unobserved.length > 0) {
      const named = unobserved.map(
        (item) => `${item?.classification ?? "UNCLASSIFIED"}: ${item?.criterion ?? "unnamed criterion"}`
      );
      throw new ErrorClass(
        `Zen must supply directly observed verification evidence; not observed: ${named.join("; ")}`
      );
    }
  }

  if (verdict.verdict === "GO") {
    const uncovered = uncoveredAcceptanceCriteria(opts.expectedCriteria ?? [], verdict.verification_evidence);
    if (uncovered.length > 0) {
      throw new UncoveredCriteriaError(
        `Zen GO must cover every acceptance criterion with OBSERVED evidence naming the criterion and a non-empty result; uncovered: ${JSON.stringify(uncovered)}`,
        { uncovered }
      );
    }
  }

  if (
    requireRepairNeedsForNoGo &&
    verdict.verdict === "NO-GO" &&
    (typeof verdict.repair_needs !== "string" || !verdict.repair_needs.trim())
  ) {
    throw new NoGoErrorClass("Zen NO-GO must supply non-empty repair_needs");
  }

  return true;
}

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

  if (!candidate.payload || typeof candidate.payload !== "object" || Array.isArray(candidate.payload)) {
    throw new InvariantViolationError("Candidate record missing valid payload object");
  }

  const payload = candidate.payload;

  validateCandidateSemantics(candidate, {
    expectedMilestone: opts.expectedMilestone,
    expectedPlanVersion: opts.expectedPlanVersion,
    errorClass: InvariantViolationError,
  });

  validateCandidateSemantics(payload, {
    expectedMilestone: opts.expectedMilestone,
    expectedPlanVersion: opts.expectedPlanVersion,
    errorClass: InvariantViolationError,
  });

  if (!candidate.status || typeof candidate.status !== "string") {
    throw new InvariantViolationError("Candidate record status must be a non-empty string");
  }
  if (candidate.status !== payload.status) {
    throw new InvariantViolationError(
      `Candidate record status '${candidate.status}' does not match payload status '${payload.status}' (tampering detected)`
    );
  }

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

  if (candidate.changes_made === undefined || candidate.changes_made === null) {
    throw new InvariantViolationError("Candidate record missing changes_made");
  }
  if (payload.changes_made === undefined || payload.changes_made === null) {
    throw new InvariantViolationError("Candidate payload missing changes_made");
  }
  const normCandChanges = Array.isArray(candidate.changes_made) ? candidate.changes_made : [candidate.changes_made];
  const normPayloadChanges = Array.isArray(payload.changes_made) ? payload.changes_made : [payload.changes_made];
  if (canonicalJson(normCandChanges) !== canonicalJson(normPayloadChanges)) {
    throw new InvariantViolationError(
      "Candidate record changes_made does not match payload changes_made (tampering detected)"
    );
  }

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

  // #201 A3: verify code-computed delivered_tree_digest consistency when present
  if ((candidate.delivered_tree_digest ?? null) !== (payload.delivered_tree_digest ?? null)) {
    throw new InvariantViolationError(
      `Candidate delivered_tree_digest mismatch: record '${candidate.delivered_tree_digest}' vs payload '${payload.delivered_tree_digest}' (tampering detected)`
    );
  }
  if (opts.expectedTreeDigest && candidate.delivered_tree_digest !== opts.expectedTreeDigest) {
    throw new InvariantViolationError(
      `Candidate delivered_tree_digest '${candidate.delivered_tree_digest}' does not match expected tree digest '${opts.expectedTreeDigest}'`
    );
  }

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
          throw new InvariantViolationError(`Milestone '${m.id}' cannot depend on itself`);
        }
      }
    }
  }

  validateCoverage(plan, InvariantViolationError);

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

function normalizeMilestones(milestones) {
  return milestones.map((m) => ({
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
    coverage: Array.isArray(m.coverage) ? deepClone(m.coverage) : [],
    verify: Array.isArray(m.verify) ? [...m.verify] : [],
  }));
}

/**
 * NTG 2.0 Thin Authoritative LedgerKernel (with 1.x AuthoritativeLedger alias).
 * Only LedgerKernel mutates `.ntg/ledger.json` via internal host-process Node FS APIs.
 */
export class LedgerKernel {
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
    this.usage = {};
    this.track = null;
    this.assurance_badge = null;
    this.halo_reviews = {};
    this.recovery_attempts = {};
    this.max_recovery_retries = DEFAULT_MAX_RECOVERY_RETRIES;

    this._initialized = false;
    this._active_candidates = {};
    this._known_candidates_by_ref = {};
    this._verification_history = [];
    this._halo_review_history = [];

    if (initialPlan) {
      this.init(initialPlan);
    }
  }

  static acquireLock = acquireLedgerLock;
  static verifyIntegrity = verifyLedgerIntegrity;
  static recoverStaleLock = recoverStaleLock;

  init(initialPlan) {
    if (this._initialized) {
      throw new InvalidTransitionError(
        "Ledger is already initialized. Re-initialization is prohibited; use materialReplan to adopt plan revisions."
      );
    }
    validatePlan(initialPlan);

    this.goal = String(initialPlan.goal || "").trim();
    this.constraints = Array.isArray(initialPlan.constraints) ? [...initialPlan.constraints] : [];
    this.plan_version = initialPlan.plan_version !== undefined ? initialPlan.plan_version : "v1";
    this.milestones = normalizeMilestones(initialPlan.milestones);
    this.current_milestone = null;
    this.completed_milestones = [];
    this.evidence = initialPlan.evidence ? { ...initialPlan.evidence } : {};
    this.verification = {};
    this.blockers = [];
    this.decision_invariants = Array.isArray(initialPlan.decision_invariants)
      ? [...initialPlan.decision_invariants]
      : [];
    this.usage = {};
    this.track = initialPlan.track ? String(initialPlan.track).toUpperCase() : null;
    if (this.track === "L") {
      throw new InvariantViolationError(
        "Track L runs belong in LightweightLog (.ntg/lightweight-runs.jsonl), not Track S/M LedgerKernel"
      );
    }
    this.assurance_badge = this.track ? "ZEN_DURABLE" : null;
    this.halo_reviews = {};
    this.recovery_attempts = {};
    this.max_recovery_retries =
      Number.isInteger(initialPlan.max_recovery_retries) && initialPlan.max_recovery_retries > 0
        ? initialPlan.max_recovery_retries
        : DEFAULT_MAX_RECOVERY_RETRIES;

    this._active_candidates = {};
    this._known_candidates_by_ref = {};
    this._verification_history = [];
    this._halo_review_history = [];

    const firstMilestone = this.milestones.find((m) => !m.dependencies || m.dependencies.length === 0);
    this.next_action = firstMilestone
      ? `Ready to delegate initial milestone: ${firstMilestone.id}`
      : "Ready to delegate milestone";

    this._initialized = true;
    return this;
  }

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
    return this.buildMilestoneHandoffPacket(milestoneId);
  }

  buildMilestoneHandoffPacket(milestoneId) {
    const milestone = this.milestones.find((m) => m.id === milestoneId);
    if (!milestone) {
      throw new InvalidTransitionError(`Milestone '${milestoneId}' not found in current plan`);
    }
    return {
      milestone_id: milestone.id,
      plan_version: this.plan_version,
      objective: milestone.objective,
      bounded_scope: [...milestone.bounded_scope],
      non_goals: [...milestone.non_goals],
      acceptance_criteria: [...milestone.acceptance_criteria],
      coverage: deepClone(milestone.coverage ?? []),
      verify: [...(milestone.verify ?? [])],
      constraints: [...this.constraints],
      relevant_evidence: this.getRelevantEvidence(milestoneId),
      decision_invariants: this.getRelevantDecisionInvariants(milestoneId),
    };
  }

  getRelevantEvidence(milestoneId) {
    const targets = [];
    if (this.evidence[milestoneId]) {
      targets.push({ mId: milestoneId, entry: this.evidence[milestoneId] });
    }
    const milestone = this.milestones.find((m) => m.id === milestoneId);
    if (milestone && milestone.dependencies) {
      for (const dep of milestone.dependencies) {
        if (this.evidence[dep] && !targets.some((t) => t.mId === dep)) {
          targets.push({ mId: dep, entry: this.evidence[dep] });
        }
      }
    }

    const MAX_RELEVANT_FAILURES = 5;

    return targets.map(({ mId, entry }) => {
      if (!entry || typeof entry !== "object") {
        return deepClone(entry);
      }

      const projected = { ...entry };
      projected.full_evidence_ref = `evidence.${mId}`;
      projected.full_record_ref = `evidence.${mId}`;
      projected.ledger_ref = `evidence.${mId}`;

      if (Array.isArray(entry.failure_evidence)) {
        projected.failure_evidence = entry.failure_evidence.slice(-MAX_RELEVANT_FAILURES);
      }

      const repairNeeds = this.verification[mId]?.repair_needs ?? entry.repair_needs;
      if (repairNeeds !== undefined && repairNeeds !== null) {
        projected.repair_needs = repairNeeds;
      }

      const latestCandidate =
        entry.active_candidate ||
        (Array.isArray(entry.candidates) && entry.candidates.length > 0
          ? entry.candidates[entry.candidates.length - 1]
          : null);

      const resultRef = latestCandidate?.result_ref || entry.result_ref;
      if (resultRef) {
        projected.result_ref = resultRef;
      }

      const candidateArtifactRef =
        latestCandidate?.candidate_artifact_ref !== undefined
          ? latestCandidate.candidate_artifact_ref
          : latestCandidate?.artifact_ref !== undefined
          ? latestCandidate.artifact_ref
          : entry.candidate_artifact_ref !== undefined
          ? entry.candidate_artifact_ref
          : entry.artifact_ref;
      if (candidateArtifactRef !== undefined) {
        projected.candidate_artifact_ref = candidateArtifactRef;
      }

      const artifactHashes = new Set();
      const addArtifact = (ref) => {
        if (typeof ref === "string" && ref.trim()) {
          artifactHashes.add(ref.trim());
        }
      };

      if (Array.isArray(entry.artifact_hashes)) {
        for (const h of entry.artifact_hashes) addArtifact(h);
      }
      addArtifact(projected.candidate_artifact_ref);
      addArtifact(entry.candidate_artifact_ref);
      addArtifact(entry.artifact_ref);

      if (Array.isArray(entry.candidates)) {
        for (const c of entry.candidates) {
          if (!c || typeof c !== "object") continue;
          addArtifact(c.candidate_artifact_ref);
          addArtifact(c.artifact_ref);
          addArtifact(c.payload?.candidate_artifact_ref);
          addArtifact(c.payload?.artifact_ref);
        }
      }

      if (entry.active_candidate && typeof entry.active_candidate === "object") {
        addArtifact(entry.active_candidate.candidate_artifact_ref);
        addArtifact(entry.active_candidate.artifact_ref);
        addArtifact(entry.active_candidate.payload?.candidate_artifact_ref);
        addArtifact(entry.active_candidate.payload?.artifact_ref);
      }

      if (artifactHashes.size > 0 || latestCandidate || entry.candidates) {
        projected.artifact_hashes = Array.from(artifactHashes);
      }

      if (Array.isArray(entry.candidates)) {
        projected.candidates = entry.candidates.map((c) => {
          if (!c || typeof c !== "object") return c;
          const isLatest =
            latestCandidate &&
            (c === latestCandidate || (c.result_ref && c.result_ref === latestCandidate.result_ref));

          if (!isLatest) {
            const compacted = {
              milestone_id: c.milestone_id,
              plan_version: c.plan_version,
              status: c.status,
              timestamp: c.timestamp,
              result_ref: c.result_ref,
              candidate_artifact_ref:
                c.candidate_artifact_ref !== undefined
                  ? c.candidate_artifact_ref
                  : c.artifact_ref !== undefined
                  ? c.artifact_ref
                  : null,
              full_record_ref: `evidence.${c.result_ref}`,
            };
            if (c.artifact_ref !== undefined) {
              compacted.artifact_ref = c.artifact_ref;
            }
            return compacted;
          }

          const { payload, ...compacted } = c;
          return compacted;
        });
      }

      if (entry.active_candidate && typeof entry.active_candidate === "object") {
        const { payload, ...compacted } = entry.active_candidate;
        projected.active_candidate = compacted;
      }

      if (projected.payload !== undefined) {
        delete projected.payload;
      }

      const targetMilestone = this.milestones.find((m) => m.id === mId);
      const criteria = Array.isArray(targetMilestone?.acceptance_criteria)
        ? targetMilestone.acceptance_criteria
        : [];

      const getCriterionKey = (item) => {
        if (item === null || item === undefined) return null;

        let raw = item;
        if (typeof item === "object") {
          raw =
            item.criterion ??
            item.criterion_id ??
            item.acceptance_criterion ??
            item.id ??
            item.criterion_index ??
            item.index;
          if (raw === undefined || raw === null) {
            return JSON.stringify(item);
          }
        }

        if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw.trim()))) {
          const idx = typeof raw === "number" ? raw : parseInt(raw.trim(), 10);
          if (idx >= 0 && idx < criteria.length) {
            return String(criteria[idx]).trim();
          }
          if (idx >= 1 && idx <= criteria.length) {
            return String(criteria[idx - 1]).trim();
          }
          return String(raw).trim();
        }

        if (typeof raw !== "string") {
          return String(raw);
        }

        const trimmed = raw.trim();
        const colonMatch = trimmed.match(/^CRITERION:\s*([^:\n]+)/i);
        if (colonMatch) {
          const rawPrefix = colonMatch[1].trim();
          for (const crit of criteria) {
            if (typeof crit === "string" && crit.trim() === rawPrefix) {
              return crit.trim();
            }
          }
          return rawPrefix;
        }

        for (const crit of criteria) {
          if (typeof crit === "string" && crit.trim() === trimmed) {
            return crit.trim();
          }
        }

        for (const crit of criteria) {
          if (typeof crit === "string") {
            const critTrimmed = crit.trim();
            if (trimmed.startsWith(critTrimmed + ":")) {
              return critTrimmed;
            }
          }
        }

        return trimmed;
      };

      const candidates = [];
      if (Array.isArray(entry.candidates)) {
        for (const cand of entry.candidates) {
          if (cand) candidates.push(cand);
        }
      }
      if (
        entry.active_candidate &&
        typeof entry.active_candidate === "object" &&
        !candidates.some(
          (c) =>
            c === entry.active_candidate ||
            (c.result_ref && c.result_ref === entry.active_candidate.result_ref)
        )
      ) {
        candidates.push(entry.active_candidate);
      }

      const verRecords = [];
      if (Array.isArray(this._verification_history)) {
        for (const v of this._verification_history) {
          if (v && (v.milestone_id === mId || v.milestoneId === mId)) {
            verRecords.push(v);
          }
        }
      }
      const latestVer = this.verification?.[mId];
      if (latestVer && !verRecords.includes(latestVer)) {
        verRecords.push(latestVer);
      }

      const rawEvidenceItems = [];
      if (entry.verification_evidence) {
        const ev = entry.verification_evidence;
        if (Array.isArray(ev)) rawEvidenceItems.push(...ev);
        else rawEvidenceItems.push(ev);
      }

      const attachedVerRecords = new Set();
      for (const cand of candidates) {
        const ev = cand.verification_evidence ?? cand.payload?.verification_evidence;
        if (ev) {
          if (Array.isArray(ev)) rawEvidenceItems.push(...ev);
          else rawEvidenceItems.push(ev);
        }

        for (const v of verRecords) {
          if (v && v.result_ref && cand.result_ref && v.result_ref === cand.result_ref) {
            attachedVerRecords.add(v);
            const vEv = v.verification_evidence;
            if (vEv) {
              if (Array.isArray(vEv)) rawEvidenceItems.push(...vEv);
              else rawEvidenceItems.push(vEv);
            }
          }
        }
      }

      for (const v of verRecords) {
        if (!attachedVerRecords.has(v)) {
          const vEv = v.verification_evidence;
          if (vEv) {
            if (Array.isArray(vEv)) rawEvidenceItems.push(...vEv);
            else rawEvidenceItems.push(vEv);
          }
        }
      }

      const evidenceByCriterion = new Map();
      for (const item of rawEvidenceItems) {
        if (item === undefined || item === null) continue;
        const key = getCriterionKey(item);
        if (key !== null) {
          evidenceByCriterion.set(key, item);
        }
      }

      if (
        rawEvidenceItems.length > 0 ||
        entry.verification_evidence !== undefined ||
        entry.active_candidate ||
        (Array.isArray(entry.candidates) && entry.candidates.length > 0)
      ) {
        projected.verification_evidence = Array.from(evidenceByCriterion.values());
      }

      return deepClone(projected);
    });
  }

  getRelevantDecisionInvariants(milestoneId) {
    if (!Array.isArray(this.decision_invariants)) return [];
    return this.decision_invariants.filter((di) => {
      if (!di.affects_milestones || !Array.isArray(di.affects_milestones)) return true;
      return di.affects_milestones.includes(milestoneId);
    });
  }

  receiveCandidate(candidatePacket, opts = {}) {
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

    const clonedPacket = deepClone(normalizeCandidateArtifactRef(candidatePacket));
    const effectiveArtifactRef = clonedPacket.candidate_artifact_ref;

    // #201 A3: code-computed delivered_tree_digest binding
    let computedTreeDigest = opts.deliveredTreeDigest ?? clonedPacket.delivered_tree_digest;
    if (opts.cwd) {
      const milestone = this.milestones.find((m) => m.id === this.current_milestone);
      const scopeDigest = computeDeliveredTreeDigest(milestone?.bounded_scope ?? [], { cwd: opts.cwd });
      if (
        opts.deliveredTreeDigest !== undefined &&
        opts.deliveredTreeDigest !== null &&
        opts.deliveredTreeDigest !== scopeDigest
      ) {
        throw new InvalidTransitionError(
          `Supplied deliveredTreeDigest '${opts.deliveredTreeDigest}' does not match code-computed digest '${scopeDigest}'`
        );
      }
      if (
        clonedPacket.delivered_tree_digest !== undefined &&
        clonedPacket.delivered_tree_digest !== scopeDigest
      ) {
        throw new InvalidTransitionError(
          `Candidate delivered_tree_digest '${clonedPacket.delivered_tree_digest}' does not match code-computed digest '${scopeDigest}'`
        );
      }
      computedTreeDigest = scopeDigest;
    }
    if (computedTreeDigest !== undefined && computedTreeDigest !== null) {
      clonedPacket.delivered_tree_digest = computedTreeDigest;
    }

    const computedRef = generateResultRef(clonedPacket);

    const suppliedRef = candidatePacket.result_ref || candidatePacket.resultRef;
    if (suppliedRef && suppliedRef !== computedRef) {
      throw new RefRebindingError(
        `Supplied result_ref '${suppliedRef}' does not match computed deterministic hash '${computedRef}'`
      );
    }

    delete clonedPacket.resultRef;
    clonedPacket.result_ref = computedRef;

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
      ...(computedTreeDigest !== undefined && computedTreeDigest !== null
        ? { delivered_tree_digest: computedTreeDigest }
        : {}),
      ...(Array.isArray(clonedPacket.coverage_table)
        ? { coverage_table: deepClone(clonedPacket.coverage_table) }
        : {}),
      timestamp: new Date().toISOString(),
      payload,
    });

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

    this.evidence[computedRef] = candidateRecord;
    this._active_candidates[this.current_milestone] = candidateRecord;
    this._known_candidates_by_ref[computedRef] = {
      record: candidateRecord,
      canonicalPayload,
    };

    this.next_action = `Awaiting Zen review for milestone '${this.current_milestone}' (result_ref: ${computedRef})`;

    return {
      result_ref: computedRef,
      candidate_record: candidateRecord,
    };
  }

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

    if (blockers) {
      const list = Array.isArray(blockers) ? blockers : [blockers];
      for (const b of list) {
        let blockerObj;
        if (typeof b === "string") {
          blockerObj = {
            id: `blocker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            description: b,
            affects_milestone: activeMilestone,
            escalation_path: redactTelemetryValue(escalationNeeds),
            created_at: new Date().toISOString(),
          };
        } else if (typeof b === "object" && b !== null) {
          blockerObj = {
            id: `blocker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            description: b.description || b.message || "Unspecified blocker",
            affects_milestone: activeMilestone,
            escalation_path: redactTelemetryValue(escalationNeeds),
            created_at: new Date().toISOString(),
          };
        }
        if (blockerObj) {
          this.blockers.push(blockerObj);
        }
      }
    }

    if (evidence) {
      if (!this.evidence[activeMilestone]) {
        this.evidence[activeMilestone] = {};
      }
      if (!this.evidence[activeMilestone].failure_evidence) {
        this.evidence[activeMilestone].failure_evidence = [];
      }
      let redactedEvidence;
      if (evidence && typeof evidence === "object" && !Array.isArray(evidence)
          && Object.prototype.hasOwnProperty.call(evidence, "transcript_ref")) {
        const { transcript_ref: transcriptRef, ...evidenceRest } = evidence;
        redactedEvidence = redactTelemetryValue(evidenceRest);
        redactedEvidence.transcript_ref = transcriptRef;
      } else {
        redactedEvidence = redactTelemetryValue(evidence);
      }
      this.evidence[activeMilestone].failure_evidence.push({
        status,
        evidence: redactedEvidence,
        escalation_needs: redactTelemetryValue(escalationNeeds),
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
   * Tracks orchestration-level milestone recovery retries against LedgerKernel's
   * hard safety cap (separate from per-turn tool/read count limits).
   */
  recordRecoveryAttempt(milestoneId) {
    if (!milestoneId || typeof milestoneId !== "string") {
      throw new InvalidTransitionError("milestoneId must be a non-empty string");
    }
    const count = (this.recovery_attempts[milestoneId] ?? 0) + 1;
    if (count > this.max_recovery_retries) {
      throw new InvariantViolationError(
        `Recovery safety cap (${this.max_recovery_retries}) exceeded for milestone '${milestoneId}'`
      );
    }
    this.recovery_attempts[milestoneId] = count;
    return { milestone_id: milestoneId, attempt: count, max_recovery_retries: this.max_recovery_retries };
  }

  recordAltAdvice(record = {}) {
    const entry = {
      milestone_id: record.milestone_id ?? null,
      task: redactTelemetryValue(record.task ?? ""),
      needs_alt: redactTelemetryValue(record.needs_alt ?? null),
      advice: redactTelemetryValue(record.advice ?? null),
      adopted: false,
      timestamp: new Date().toISOString(),
    };
    if (!Array.isArray(this.evidence.alt_framing)) {
      this.evidence.alt_framing = [];
    }
    this.evidence.alt_framing.push(entry);
    return entry;
  }

  /**
   * Records a bound Strix Halo formative review (`ACCEPT | REVISE | ESCALATE`),
   * strictly separated from `this.verification` (Zen summative verdicts).
   * Halo ACCEPT never promotes a Track S/M milestone or satisfies declareGlobalCompletion.
   */
  recordHaloReview(reviewPacket) {
    if (!reviewPacket || typeof reviewPacket !== "object" || Array.isArray(reviewPacket)) {
      throw new InvalidTransitionError("Halo review packet must be an object");
    }
    const caller = typeof reviewPacket.caller === "string" ? reviewPacket.caller.trim().toLowerCase() : "";
    if (!HALO_ALLOWED_CALLERS.includes(caller)) {
      throw new InvalidTransitionError(
        `Strix Halo caller '${reviewPacket.caller}' is not permitted; allowed: ${HALO_ALLOWED_CALLERS.join(", ")}`
      );
    }
    const key = reviewPacket.milestone_id ?? reviewPacket.candidate_id_or_run_id;
    if (!key || typeof key !== "string" || !key.trim()) {
      throw new InvalidTransitionError("Halo review requires milestone_id or candidate_id_or_run_id");
    }
    if (
      reviewPacket.plan_version === undefined ||
      reviewPacket.plan_version === null ||
      String(reviewPacket.plan_version).trim() === ""
    ) {
      throw new InvalidTransitionError(
        "Invalid Halo review binding: Halo review missing required binding field 'plan_version'"
      );
    }
    const planVersion = reviewPacket.plan_version;
    if (planVersion !== this.plan_version) {
      throw new StaleVerdictError(
        `Halo review plan_version '${planVersion}' does not match current ledger plan_version '${this.plan_version}'`
      );
    }

    const milestone = this.milestones.find((m) => m.id === key);
    const expectedCriteriaDigest = milestone
      ? computeAcceptanceDigest(milestone.acceptance_criteria)
      : undefined;

    const bindingCheck = validateHaloReviewBinding(reviewPacket, {
      plan_version: this.plan_version,
      ...(expectedCriteriaDigest !== undefined
        ? { acceptance_criteria_digest: expectedCriteriaDigest }
        : {}),
    });
    if (!bindingCheck.valid) {
      throw new InvalidTransitionError(`Invalid Halo review binding: ${bindingCheck.reason}`);
    }

    const record = Object.freeze({
      key,
      milestone_id: reviewPacket.milestone_id ?? null,
      caller,
      candidate_id_or_run_id: reviewPacket.candidate_id_or_run_id,
      reviewed_diff_digest: reviewPacket.reviewed_diff_digest,
      acceptance_criteria_digest: reviewPacket.acceptance_criteria_digest,
      plan_version: planVersion,
      evidence_basis: deepClone(reviewPacket.evidence_basis),
      verdict: reviewPacket.verdict,
      findings: Array.isArray(reviewPacket.findings) ? deepClone(reviewPacket.findings) : [],
      is_stale: false,
      timestamp: reviewPacket.timestamp || new Date().toISOString(),
    });

    this.halo_reviews[key] = record;
    this._halo_review_history.push(record);
    return record;
  }

  /**
   * Checks whether a stored Halo review for `key` is still fresh and bound
   * against the current diff digest, criteria digest, plan_version, and evidence basis.
   * Marks stale reviews as `is_stale: true` when drift is observed.
   */
  isHaloReviewFresh(key, currentBinding = {}) {
    const existing = this.halo_reviews?.[key];
    if (!existing) {
      return { fresh: false, reason: `No Halo review recorded for '${key}'` };
    }
    const milestone = this.milestones.find((m) => m.id === key);
    const expected = {
      candidate_id_or_run_id: currentBinding.candidate_id_or_run_id ?? existing.candidate_id_or_run_id,
      reviewed_diff_digest: currentBinding.reviewed_diff_digest,
      acceptance_criteria_digest:
        currentBinding.acceptance_criteria_digest ??
        (milestone ? computeAcceptanceDigest(milestone.acceptance_criteria) : undefined),
      plan_version: currentBinding.plan_version ?? this.plan_version,
      evidence_basis: currentBinding.evidence_basis,
    };
    const check = validateHaloReviewBinding(existing, expected);
    if (!check.valid) {
      if (!existing.is_stale) {
        this.halo_reviews[key] = Object.freeze({ ...existing, is_stale: true });
      }
      return { fresh: false, reason: check.reason, review: this.halo_reviews[key] };
    }
    if (existing.verdict !== "ACCEPT") {
      return { fresh: false, reason: `Halo verdict is '${existing.verdict}', not 'ACCEPT'`, review: existing };
    }
    return { fresh: true, review: existing };
  }

  invalidateStaleHaloReviews(key = null, currentBinding = {}) {
    if (key !== null) {
      return this.isHaloReviewFresh(key, currentBinding);
    }
    for (const k of Object.keys(this.halo_reviews)) {
      if (this.halo_reviews[k]) {
        this.halo_reviews[k] = Object.freeze({ ...this.halo_reviews[k], is_stale: true });
      }
    }
    this._halo_review_history = this._halo_review_history.map((r) =>
      Object.freeze({ ...r, is_stale: true })
    );
    return { invalidated: true };
  }

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

    delete this._active_candidates[milestoneId];
    this.current_milestone = null;
    this.next_action = `Zen NO-GO recorded for milestone '${milestoneId}'. Requires repair or replan.`;

    return verificationRecord;
  }

  recordZenGo(verdictPacket, opts = {}) {
    if (!verdictPacket || typeof verdictPacket !== "object" || Array.isArray(verdictPacket)) {
      throw new InvalidTransitionError("Verdict packet must be an object");
    }

    if (this.current_milestone === null) {
      throw new InvalidTransitionError("No active milestone for Zen verdict");
    }

    const activeCandidate = this._active_candidates[this.current_milestone];
    const milestone = this.milestones.find((m) => m.id === this.current_milestone);

    validateZenVerdictPacket(verdictPacket, {
      expectedMilestone: this.current_milestone,
      expectedPlanVersion: this.plan_version,
      beforeResultRefCheck: () => {
        if (!activeCandidate) {
          throw new InvalidTransitionError(
            `No active candidate received for milestone '${this.current_milestone}'`
          );
        }
      },
      expectedResultRef: activeCandidate?.result_ref,
      expectedVerdict: "GO",
      expectedCriteria: milestone?.acceptance_criteria ?? [],
      candidateTreeDigest: activeCandidate?.delivered_tree_digest,
      expectedTreeDigest: opts.expectedTreeDigest,
      errorClass: InvalidTransitionError,
      staleErrorClass: StaleVerdictError,
      mismatchErrorClass: MismatchedResultRefError,
    });

    const milestoneId = this.current_milestone;
    const resultRef = activeCandidate.result_ref;

    const verificationRecord = Object.freeze({
      milestone_id: milestoneId,
      plan_version: this.plan_version,
      result_ref: resultRef,
      verdict: "GO",
      verification_evidence: Array.isArray(verdictPacket.verification_evidence)
        ? [...verdictPacket.verification_evidence]
        : [verdictPacket.verification_evidence],
      criteria_coverage_verified: true,
      ...(activeCandidate.delivered_tree_digest
        ? { delivered_tree_digest: activeCandidate.delivered_tree_digest }
        : {}),
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

  reopenLastCandidateReview(milestoneId = null, opts = {}) {
    if (this.current_milestone !== null) {
      throw new InvalidTransitionError(
        `Cannot reopen review: milestone '${this.current_milestone}' is already active`
      );
    }
    if (milestoneId !== null && !this.milestones.some((m) => m.id === milestoneId)) {
      throw new InvalidTransitionError(`Milestone '${milestoneId}' not found in current plan`);
    }
    const ids = milestoneId !== null ? [milestoneId] : this.milestones.map((m) => m.id);
    let selected = null;
    for (const id of ids) {
      if (this.completed_milestones.includes(id)) continue;
      const candidates = this.evidence[id]?.candidates;
      if (!Array.isArray(candidates) || candidates.length === 0) continue;
      const last = candidates[candidates.length - 1];
      if (!last || typeof last !== "object" || last.plan_version !== this.plan_version) continue;
      if (!selected || String(last.timestamp ?? "") > String(selected.candidate.timestamp ?? "")) {
        selected = { id, candidate: last };
      }
    }
    if (!selected) {
      throw new InvalidTransitionError(
        `No persisted candidate awaiting Zen review${milestoneId !== null ? ` for milestone '${milestoneId}'` : ""} under plan_version '${this.plan_version}'`
      );
    }
    const candidate = selected.candidate;
    if (candidate.is_stale === true) {
      throw new StaleVerdictError(
        `Persisted candidate '${candidate.result_ref}' for milestone '${selected.id}' is marked STALE and cannot reopen Zen review`
      );
    }
    verifyCandidateIntegrity(candidate, candidate.result_ref);

    const milestone = this.milestones.find((m) => m.id === selected.id);
    const expectedTreeDigest =
      opts.expectedTreeDigest ??
      (opts.cwd ? computeDeliveredTreeDigest(milestone?.bounded_scope ?? [], { cwd: opts.cwd }) : null);
    if (expectedTreeDigest && (candidate.delivered_tree_digest ?? null) !== expectedTreeDigest) {
      const staleCandidate = deepFreeze({
        ...candidate,
        is_stale: true,
        stale_reason: "delivered_tree_digest_mismatch",
      });
      const candList = this.evidence[selected.id]?.candidates;
      if (Array.isArray(candList) && candList.length > 0) {
        const idx = candList.lastIndexOf(candidate);
        if (idx !== -1) candList[idx] = staleCandidate;
      }
      if (candidate.result_ref && this.evidence[candidate.result_ref]) {
        this.evidence[candidate.result_ref] = staleCandidate;
      }
      if (this.evidence[selected.id] && "active_candidate" in this.evidence[selected.id]) {
        delete this.evidence[selected.id].active_candidate;
      }
      delete this._active_candidates[selected.id];
      this.invalidateStaleHaloReviews(selected.id, { reviewed_diff_digest: expectedTreeDigest });
      this.next_action = `Persisted candidate '${candidate.result_ref}' for milestone '${selected.id}' marked STALE (bounded working tree changed)`;
      throw new StaleVerdictError(
        `Persisted candidate '${candidate.result_ref}' delivered_tree_digest '${candidate.delivered_tree_digest ?? null}' does not match current bounded working-tree digest '${expectedTreeDigest}' (STALE)`
      );
    }

    this._active_candidates[selected.id] = candidate;
    this.current_milestone = selected.id;
    this.next_action = `Zen review retry opened for milestone '${selected.id}' (result_ref: ${candidate.result_ref})`;
    return {
      milestone_id: selected.id,
      plan_version: this.plan_version,
      result_ref: candidate.result_ref,
      contract: this.buildMilestoneHandoffPacket(selected.id),
      candidate_record: candidate,
    };
  }

  #resolveNextVersion(explicitVer) {
    const oldVersion = this.plan_version;
    if (explicitVer === undefined) {
      return incrementPlanVersion(oldVersion);
    }
    if (typeof explicitVer !== typeof oldVersion) {
      throw new InvalidTransitionError(
        `Replan plan_version type '${typeof explicitVer}' does not match current plan_version type '${typeof oldVersion}'`
      );
    }
    if (typeof oldVersion === "number") {
      if (!Number.isFinite(explicitVer) || !Number.isInteger(explicitVer)) {
        throw new InvalidTransitionError(`Replan plan_version '${explicitVer}' must be an integer`);
      }
      if (explicitVer <= oldVersion) {
        throw new InvalidTransitionError(
          `Replan plan_version '${explicitVer}' must strictly increment current plan_version '${oldVersion}'`
        );
      }
      return explicitVer;
    }
    if (typeof oldVersion === "string") {
      const oldParsed = parseVersion(oldVersion);
      const newParsed = parseVersion(explicitVer);
      if (!oldParsed || !newParsed) {
        throw new InvalidTransitionError(
          `Replan plan_version '${explicitVer}' is not a valid or comparable version format`
        );
      }
      if (oldParsed.prefix !== newParsed.prefix) {
        throw new InvalidTransitionError(
          `Replan plan_version '${explicitVer}' prefix '${newParsed.prefix}' does not match current prefix '${oldParsed.prefix}'`
        );
      }
      if (newParsed.num <= oldParsed.num) {
        throw new InvalidTransitionError(
          `Replan plan_version '${explicitVer}' must strictly increment current plan_version '${oldVersion}'`
        );
      }
      return explicitVer;
    }
    throw new InvalidTransitionError(
      `Current plan_version '${oldVersion}' has unsupported type '${typeof oldVersion}'`
    );
  }

  #invalidatePriorVersionState() {
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

    this.invalidateStaleHaloReviews(null);

    this.completed_milestones = [];
    this.current_milestone = null;
    this._active_candidates = {};
    this.recovery_attempts = {};

    // #201 A1: separate active candidates from prior plan_version evidence
    for (const key of Object.keys(this.evidence)) {
      const entry = this.evidence[key];
      if (entry && typeof entry === "object" && !Array.isArray(entry) && "active_candidate" in entry) {
        delete entry.active_candidate;
      }
    }
  }

  /**
   * Tactical Replan (PO_CONFIRMED): autonomously adopted when execution strategy,
   * scope boundaries, or remaining milestones change without altering user-approved
   * goal or decision invariants. Increments plan_version and marks ALL prior Zen GO
   * verdicts (and prior Halo receipts) STALE for full Zen revalidation.
   */
  tacticalReplan(newPlanData) {
    if (this.current_milestone !== null) {
      throw new InvalidTransitionError(
        `Cannot adopt tactical replan while milestone '${this.current_milestone}' is actively executing or under review`
      );
    }
    if (!newPlanData || typeof newPlanData !== "object") {
      throw new InvariantViolationError("newPlanData must be a non-null object");
    }
    if (!Array.isArray(newPlanData.milestones) || newPlanData.milestones.length === 0) {
      throw new InvariantViolationError("newPlanData must include a non-empty milestones array");
    }
    if (newPlanData.goal !== undefined && String(newPlanData.goal).trim() !== this.goal) {
      throw new InvalidTransitionError(
        "Tactical replan cannot alter user-approved goal; use materialReplan with user approval"
      );
    }
    if (
      newPlanData.decision_invariants !== undefined &&
      canonicalJson(newPlanData.decision_invariants) !== canonicalJson(this.decision_invariants)
    ) {
      throw new InvalidTransitionError(
        "Tactical replan cannot alter decision_invariants; use materialReplan with user approval"
      );
    }

    validatePlan({
      goal: this.goal,
      milestones: newPlanData.milestones,
    });

    this.plan_version = this.#resolveNextVersion(newPlanData.plan_version);
    this.#invalidatePriorVersionState();
    this.milestones = normalizeMilestones(newPlanData.milestones);
    if (newPlanData.constraints) {
      this.constraints = Array.isArray(newPlanData.constraints) ? [...newPlanData.constraints] : [];
    }

    this.next_action = `Tactical replan adopted (version: ${this.plan_version}). All prior Zen GO verdicts marked STALE; full revalidation required.`;
    return this;
  }

  /**
   * Material Replan: changes goal, acceptance criteria, decision invariants, or
   * destructive scope (requires explicit user re-approval). Marks all prior Zen GO
   * verdicts and Halo receipts STALE and clears active/completed milestone state.
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

    this.plan_version = this.#resolveNextVersion(newPlanData.plan_version);
    this.#invalidatePriorVersionState();
    this.milestones = normalizeMilestones(newPlanData.milestones);

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
   * Resolves an active blocker on observed resolution evidence (#201 A7).
   * Removes blocker from blockers, records resolution evidence in evidence.
   * Never promotes a milestone.
   */
  resolveBlocker(blockerId, resolutionEvidence) {
    if (!blockerId || typeof blockerId !== "string") {
      throw new BlockerNotFoundError("blockerId must be a non-empty string");
    }

    const index = this.blockers.findIndex((b) => b.id === blockerId);
    if (index === -1) {
      throw new BlockerNotFoundError(`Blocker '${blockerId}' not found in active blockers`);
    }

    const isEmptyString = typeof resolutionEvidence === "string" && !resolutionEvidence.trim();
    const isEmptyArray = Array.isArray(resolutionEvidence) && resolutionEvidence.length === 0;
    const isObject =
      resolutionEvidence !== null &&
      typeof resolutionEvidence === "object" &&
      !Array.isArray(resolutionEvidence);
    const isInvalidObject =
      isObject &&
      (Object.keys(resolutionEvidence).length === 0 ||
        ("classification" in resolutionEvidence && resolutionEvidence.classification !== "OBSERVED"));

    if (
      resolutionEvidence === undefined ||
      resolutionEvidence === null ||
      isEmptyString ||
      isEmptyArray ||
      isInvalidObject
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
      throw new InvariantViolationError("Cannot declare global completion: plan contains no milestones");
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

  recordUsage(milestoneId, entry) {
    if (!milestoneId || typeof milestoneId !== "string" || !milestoneId.trim()) {
      throw new InvariantViolationError("milestoneId must be a non-empty string");
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new InvariantViolationError("entry must be an object");
    }

    const normalized = {
      role: typeof entry.role === "string" ? entry.role : null,
      slug: typeof entry.slug === "string" ? entry.slug : null,
      duration_ms:
        typeof entry.duration_ms === "number" && Number.isFinite(entry.duration_ms)
          ? entry.duration_ms
          : undefined,
      usage:
        entry.usage !== null && typeof entry.usage === "object" && !Array.isArray(entry.usage)
          ? deepClone(entry.usage)
          : undefined,
      status:
        typeof entry.status === "string"
          ? entry.status
          : entry.status != null
          ? String(entry.status)
          : null,
      source: typeof entry.source === "string" ? entry.source : "runtime",
      verified: entry.verified !== false,
    };

    if (!this.usage[milestoneId]) {
      this.usage[milestoneId] = [];
    }
    const frozen = deepFreeze(normalized);
    this.usage[milestoneId].push(frozen);
    return frozen;
  }

  toJSON() {
    const data = {
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
    if (this.usage && Object.keys(this.usage).length > 0) {
      data.usage = this.usage;
    }
    if (this.track) {
      data.track = this.track;
    }
    if (this.assurance_badge) {
      data.assurance_badge = this.assurance_badge;
    }
    if (this.halo_reviews && Object.keys(this.halo_reviews).length > 0) {
      data.halo_reviews = this.halo_reviews;
    }
    if (this._halo_review_history && this._halo_review_history.length > 0) {
      data._halo_review_history = this._halo_review_history;
    }
    if (this.recovery_attempts && Object.keys(this.recovery_attempts).length > 0) {
      data.recovery_attempts = this.recovery_attempts;
    }
    if (this.max_recovery_retries !== DEFAULT_MAX_RECOVERY_RETRIES) {
      data.max_recovery_retries = this.max_recovery_retries;
    }
    return data;
  }

  getState() {
    return this.toJSON();
  }

  save(filePath) {
    if (!filePath || typeof filePath !== "string") {
      throw new Error("filePath must be a non-empty string");
    }
    const resolved = resolve(filePath);
    LedgerKernel._instancesByPath.set(resolved, this);
    const dir = dirname(resolved);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tempFile = join(dir, `.ledger-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    const jsonStr = JSON.stringify(this.toJSON(), null, 2);
    writeFileSync(tempFile, jsonStr, "utf-8");
    renameSync(tempFile, resolved);
  }

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
      throw new InvariantViolationError("Ledger state invalid: 'completed_milestones' must be an array");
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
      throw new InvariantViolationError("Ledger state invalid: 'decision_invariants' must be an array");
    }
    if (data.usage !== undefined) {
      if (typeof data.usage !== "object" || data.usage === null || Array.isArray(data.usage)) {
        throw new InvariantViolationError("Ledger state invalid: 'usage' must be an object");
      }
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

      const milestoneCriteria =
        data.milestones.find((m) => m.id === completedId)?.acceptance_criteria ?? [];
      validateZenGoSemantics(ver, {
        expectedMilestone: completedId,
        expectedPlanVersion: data.plan_version,
        expectedCriteria: ver.criteria_coverage_verified === true ? milestoneCriteria : undefined,
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

    const ledger = new LedgerKernel();
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
    ledger.usage = data.usage ? deepClone(data.usage) : {};
    ledger.track = data.track ?? null;
    ledger.assurance_badge = data.assurance_badge ?? null;
    ledger.halo_reviews = data.halo_reviews ? deepClone(data.halo_reviews) : {};
    ledger.recovery_attempts = data.recovery_attempts ? deepClone(data.recovery_attempts) : {};
    ledger.max_recovery_retries =
      Number.isInteger(data.max_recovery_retries) && data.max_recovery_retries > 0
        ? data.max_recovery_retries
        : DEFAULT_MAX_RECOVERY_RETRIES;

    ledger._active_candidates = data._active_candidates ? { ...data._active_candidates } : {};
    ledger._known_candidates_by_ref = data._known_candidates_by_ref
      ? { ...data._known_candidates_by_ref }
      : {};
    ledger._verification_history = Array.isArray(data._verification_history)
      ? [...data._verification_history]
      : [];
    ledger._halo_review_history = Array.isArray(data._halo_review_history)
      ? [...data._halo_review_history]
      : [];

    return ledger;
  }

  static _instancesByPath = new Map();

  static getInstance(filePath) {
    if (!filePath || typeof filePath !== "string") return null;
    return LedgerKernel._instancesByPath.get(resolve(filePath)) || null;
  }

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
    const ledger = LedgerKernel.fromJSON(parsed);
    LedgerKernel._instancesByPath.set(resolved, ledger);
    return ledger;
  }
}

export const AuthoritativeLedger = LedgerKernel;

function tokenCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

export function computeUsageRollup(stateOrUsage) {
  if (!stateOrUsage || typeof stateOrUsage !== "object" || Array.isArray(stateOrUsage)) {
    return null;
  }
  let usage;
  if ("usage" in stateOrUsage) {
    usage = stateOrUsage.usage;
  } else if ("milestones" in stateOrUsage || "plan_version" in stateOrUsage || "goal" in stateOrUsage) {
    return null;
  } else {
    usage = stateOrUsage;
  }

  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }

  const result = {};
  let hasEntries = false;

  for (const [milestoneId, entries] of Object.entries(usage)) {
    if (!Array.isArray(entries) || entries.length === 0) {
      continue;
    }
    const roles = {};
    const declaredRoles = {};
    let declaredEntries = 0;
    let milestoneDurationMs = 0;
    let milestoneTokens = 0;
    let milestoneHasValidEntries = false;

    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const role = entry.role || "unknown";
      if (entry.verified === false || entry.source === "declared") {
        declaredEntries += 1;
        if (!declaredRoles[role]) declaredRoles[role] = { entries: 0 };
        declaredRoles[role].entries += 1;
        continue;
      }
      milestoneHasValidEntries = true;
      const durationMs = typeof entry.duration_ms === "number" && !isNaN(entry.duration_ms) ? entry.duration_ms : 0;
      let tokens = 0;
      if (entry.usage && typeof entry.usage === "object" && !Array.isArray(entry.usage)) {
        const total = tokenCount(entry.usage.total_tokens);
        if (total !== undefined) {
          tokens = total;
        } else {
          const input = tokenCount(entry.usage.input_tokens) ?? tokenCount(entry.usage.prompt_tokens);
          const output = tokenCount(entry.usage.output_tokens) ?? tokenCount(entry.usage.completion_tokens);
          tokens = (input ?? 0) + (output ?? 0);
        }
      }

      milestoneDurationMs += durationMs;
      milestoneTokens += tokens;

      if (!roles[role]) {
        roles[role] = { duration_ms: 0, total_duration_ms: 0, total_tokens: 0 };
      }
      roles[role].duration_ms += durationMs;
      roles[role].total_duration_ms += durationMs;
      roles[role].total_tokens += tokens;
    }

    if (!milestoneHasValidEntries && declaredEntries === 0) {
      continue;
    }

    hasEntries = true;
    const summary = {};
    if (milestoneHasValidEntries) {
      summary.roles = roles;
      summary.by_role = roles;
      summary.total_duration_ms = milestoneDurationMs;
      summary.duration_ms = milestoneDurationMs;
      summary.total_tokens = milestoneTokens;
      summary.total = {
        duration_ms: milestoneDurationMs,
        total_duration_ms: milestoneDurationMs,
        total_tokens: milestoneTokens,
      };
    }
    if (declaredEntries > 0) {
      summary.declared_unverified = { entries: declaredEntries, roles: declaredRoles };
    }
    result[milestoneId] = summary;
  }

  return hasEntries ? result : null;
}
