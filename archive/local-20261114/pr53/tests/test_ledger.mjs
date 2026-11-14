import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  AuthoritativeLedger,
  InvalidTransitionError,
  StaleVerdictError,
  MismatchedResultRefError,
  InvariantViolationError,
  RefRebindingError,
  BlockerNotFoundError,
  generateResultRef,
  incrementPlanVersion,
  parseVersion,
  validateCandidateSemantics,
  validateZenGoSemantics,
} from "../scripts/ledger.mjs";

console.log("=== Native Gravity 44C Authoritative Project Ledger Tests ===");

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       ${err.message}`);
    if (err.stack) {
      console.error(err.stack);
    }
    failed++;
  }
}

function samplePlan() {
  return {
    goal: "Build Native Gravity vNext Orchestration Engine",
    constraints: ["No legacy code derivation", "Strict role authority"],
    plan_version: "v1",
    decision_invariants: [
      {
        id: "DI-001",
        decision: "Steamroller is the sole authority mutating ledger",
        source_ref: "docs/specs/vnext-architecture-contract.md#3.3",
        affects_milestones: ["M1", "M2"],
      },
    ],
    milestones: [
      {
        id: "M1",
        title: "Exact-model Runner Spike",
        objective: "Validate runner and model slug resolution",
        acceptance_criteria: ["Runner resolves slugs", "Process execution works"],
        non_goals: ["Orchestrator rewrites"],
        dependencies: [],
        bounded_scope: ["scripts/runner.mjs", "tests/test_runner_spike.mjs"],
      },
      {
        id: "M2",
        title: "Authoritative Ledger",
        objective: "Implement ledger state machine and persistence",
        acceptance_criteria: ["Ledger validates invariants", "Zen GO promotes milestone"],
        non_goals: ["General database"],
        dependencies: ["M1"],
        bounded_scope: ["scripts/ledger.mjs", "tests/test_ledger.mjs"],
      },
    ],
  };
}

function sampleCandidate(overrides = {}) {
  return {
    milestone_id: "M1",
    plan_version: "v1",
    status: "DONE",
    changes_made: ["Implemented initial runner spike"],
    verification_evidence: ["test_runner_spike.mjs passed with 24/24"],
    unresolved_unknowns: [],
    scope_deviations: [],
    candidate_artifact_ref: "scripts/runner.mjs",
    ...overrides,
  };
}

function sampleVerdict(overrides = {}) {
  return {
    milestone_id: "M1",
    plan_version: "v1",
    verdict: "GO",
    verification_evidence: ["Verified all test assertions passed"],
    ...overrides,
  };
}

// =============================================================================
// Section 1: State Schema & Initialization
// =============================================================================

runTest("1.1: Authoritative state schema strictly maintains all required fields upon initialization", () => {
  const plan = samplePlan();
  const ledger = new AuthoritativeLedger(plan);

  const state = ledger.getState();
  const requiredKeys = [
    "goal",
    "constraints",
    "plan_version",
    "milestones",
    "current_milestone",
    "completed_milestones",
    "evidence",
    "verification",
    "blockers",
    "next_action",
    "decision_invariants",
  ];

  for (const key of requiredKeys) {
    assert.ok(key in state, `Missing required key in state: ${key}`);
    assert.ok(key in ledger, `Missing required property on ledger: ${key}`);
  }

  assert.strictEqual(ledger.goal, plan.goal);
  assert.deepStrictEqual(ledger.constraints, plan.constraints);
  assert.strictEqual(ledger.plan_version, "v1");
  assert.strictEqual(ledger.current_milestone, null);
  assert.deepStrictEqual(ledger.completed_milestones, []);
  assert.deepStrictEqual(ledger.blockers, []);
  assert.deepStrictEqual(ledger.verification, {});
  assert.ok(ledger.next_action.includes("Ready to delegate initial milestone: M1"));
});

runTest("1.2: Plan validation rejects invalid plan configurations", () => {
  // Missing goal
  assert.throws(() => new AuthoritativeLedger({ milestones: [{ id: "M1" }] }), InvariantViolationError);

  // Missing or empty milestones
  assert.throws(() => new AuthoritativeLedger({ goal: "Valid goal", milestones: [] }), InvariantViolationError);

  // Duplicate milestone IDs
  assert.throws(
    () =>
      new AuthoritativeLedger({
        goal: "Valid goal",
        milestones: [{ id: "M1" }, { id: "M1" }],
      }),
    InvariantViolationError
  );

  // Dependency referencing non-existent milestone
  assert.throws(
    () =>
      new AuthoritativeLedger({
        goal: "Valid goal",
        milestones: [{ id: "M1", dependencies: ["M_NONEXISTENT"] }],
      }),
    InvariantViolationError
  );

  // Circular dependency detection
  assert.throws(
    () =>
      new AuthoritativeLedger({
        goal: "Valid goal",
        milestones: [
          { id: "M1", dependencies: ["M2"] },
          { id: "M2", dependencies: ["M1"] },
        ],
      }),
    InvariantViolationError
  );
});

runTest("1.3: Initialized ledger rejects subsequent init() calls, preventing re-init from wiping state", () => {
  const plan = samplePlan();
  const ledger = new AuthoritativeLedger(plan);

  // Advance state: complete M1
  ledger.delegate("M1");
  const cand = sampleCandidate();
  const { result_ref } = ledger.receiveCandidate(cand);
  ledger.recordZenGo(sampleVerdict({ result_ref }));

  assert.deepStrictEqual(ledger.completed_milestones, ["M1"]);

  // Attempting re-initialization must throw InvalidTransitionError
  assert.throws(
    () => ledger.init(samplePlan()),
    (err) => {
      assert.ok(err instanceof InvalidTransitionError);
      assert.ok(
        err.message.includes(
          "Ledger is already initialized. Re-initialization is prohibited; use materialReplan to adopt plan revisions."
        )
      );
      return true;
    }
  );

  // State remains intact (not wiped)
  assert.strictEqual(ledger.goal, plan.goal);
  assert.strictEqual(ledger.plan_version, "v1");
  assert.deepStrictEqual(ledger.completed_milestones, ["M1"]);
  assert.ok(ledger.verification.M1);
  assert.strictEqual(ledger.verification.M1.verdict, "GO");
  assert.ok(ledger.evidence.M1);

  // Resumed ledger from JSON is also initialized and rejects init()
  const resumed = AuthoritativeLedger.fromJSON(ledger.toJSON());
  assert.throws(
    () => resumed.init(samplePlan()),
    InvalidTransitionError
  );
});

// =============================================================================
// Section 2: Delegation & Handoff Packet Generation
// =============================================================================

runTest("2.1: Delegation generates compliant Steamroller -> Bulldozer handoff packet", () => {
  const ledger = new AuthoritativeLedger(samplePlan());

  const handoff = ledger.delegate("M1");
  assert.strictEqual(ledger.current_milestone, "M1");
  assert.ok(ledger.next_action.includes("Executing milestone 'M1' via Bulldozer"));

  assert.strictEqual(handoff.milestone_id, "M1");
  assert.strictEqual(handoff.plan_version, "v1");
  assert.strictEqual(handoff.objective, "Validate runner and model slug resolution");
  assert.deepStrictEqual(handoff.bounded_scope, ["scripts/runner.mjs", "tests/test_runner_spike.mjs"]);
  assert.deepStrictEqual(handoff.non_goals, ["Orchestrator rewrites"]);
  assert.deepStrictEqual(handoff.acceptance_criteria, ["Runner resolves slugs", "Process execution works"]);
  assert.deepStrictEqual(handoff.constraints, ["No legacy code derivation", "Strict role authority"]);
  assert.ok(Array.isArray(handoff.decision_invariants));
  assert.strictEqual(handoff.decision_invariants.length, 1);
  assert.strictEqual(handoff.decision_invariants[0].id, "DI-001");
});

runTest("2.2: Delegation rejects invalid transitions (double delegation, unmet dependencies, unknown milestone)", () => {
  const ledger = new AuthoritativeLedger(samplePlan());

  // Cannot delegate milestone whose dependencies are unmet
  assert.throws(() => ledger.delegate("M2"), InvalidTransitionError);

  // Delegate M1 successfully
  ledger.delegate("M1");

  // Cannot delegate while a milestone is already active (double delegation)
  assert.throws(() => ledger.delegate("M1"), InvalidTransitionError);
  assert.throws(() => ledger.delegate("M2"), InvalidTransitionError);

  // Non-existent milestone
  const cleanLedger = new AuthoritativeLedger(samplePlan());
  assert.throws(() => cleanLedger.delegate("UNKNOWN_M"), InvalidTransitionError);
});

// =============================================================================
// Section 3: Candidate Reception & Result Ref Invariants
// =============================================================================

runTest("3.1: Candidate reception assigns deterministic result_ref, persists evidence, and keeps milestone active", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  const candidate = sampleCandidate({
    changes_made: ["Created scripts/runner.mjs"],
    verification_evidence: ["test_runner_spike.mjs passed with 24/24"],
    candidate_artifact_ref: "scripts/runner.mjs",
  });

  const expectedRef = generateResultRef(candidate);
  assert.ok(expectedRef.startsWith("ref-sha256-"));

  const { result_ref, candidate_record } = ledger.receiveCandidate(candidate);
  assert.strictEqual(result_ref, expectedRef);
  assert.strictEqual(candidate_record.result_ref, expectedRef);
  assert.strictEqual(candidate_record.status, "DONE");

  // Invariant: milestone remains active for Zen review
  assert.strictEqual(ledger.current_milestone, "M1");
  assert.ok(ledger.next_action.includes("Awaiting Zen review"));

  // Invariant: candidate is persisted in evidence
  assert.ok(ledger.evidence.M1);
  assert.strictEqual(ledger.evidence.M1.active_candidate.result_ref, expectedRef);
  assert.strictEqual(ledger.evidence[expectedRef].result_ref, expectedRef);

  // Bulldozer DONE claim != completed milestone
  assert.strictEqual(ledger.completed_milestones.includes("M1"), false);
});

runTest("3.2: Rebinding prevention throws RefRebindingError on tampered candidate content", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  const candidate1 = sampleCandidate({
    changes_made: ["Original content"],
    candidate_artifact_ref: "artifact-1",
  });
  const { result_ref } = ledger.receiveCandidate(candidate1);

  // Attempting to submit different candidate content while claiming the prior result_ref
  const tamperedCandidate = sampleCandidate({
    changes_made: ["Tampered / modified content"],
    candidate_artifact_ref: "artifact-1",
    result_ref: result_ref, // explicitly claiming mismatched ref
  });

  assert.throws(() => ledger.receiveCandidate(tamperedCandidate), RefRebindingError);
});

runTest("3.3: Candidate reception rejects mismatched milestone_id or stale plan_version", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  // Wrong milestone_id
  assert.throws(
    () =>
      ledger.receiveCandidate(
        sampleCandidate({ milestone_id: "M2" })
      ),
    InvalidTransitionError
  );

  // Stale plan_version
  assert.throws(
    () =>
      ledger.receiveCandidate(
        sampleCandidate({ plan_version: "v0" })
      ),
    InvalidTransitionError
  );

  // Calling receiveCandidate when current_milestone is null
  const idleLedger = new AuthoritativeLedger(samplePlan());
  assert.throws(
    () =>
      idleLedger.receiveCandidate(
        sampleCandidate()
      ),
    InvalidTransitionError
  );
});

runTest("3.4: Candidate reception rejects packets with missing or non-DONE status, preventing Zen GO promotion", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  // Missing status
  assert.throws(
    () =>
      ledger.receiveCandidate(
        sampleCandidate({ status: undefined })
      ),
    InvalidTransitionError
  );

  // Empty status
  assert.throws(
    () =>
      ledger.receiveCandidate(
        sampleCandidate({ status: "" })
      ),
    InvalidTransitionError
  );

  // BLOCKED status
  assert.throws(
    () =>
      ledger.receiveCandidate(
        sampleCandidate({ status: "BLOCKED" })
      ),
    InvalidTransitionError
  );

  // NEEDS_DEEP status
  assert.throws(
    () =>
      ledger.receiveCandidate(
        sampleCandidate({ status: "NEEDS_DEEP" })
      ),
    InvalidTransitionError
  );

  // Arbitrary non-DONE status
  assert.throws(
    () =>
      ledger.receiveCandidate(
        sampleCandidate({ status: "IN_PROGRESS" })
      ),
    InvalidTransitionError
  );

  // Verify candidate was NOT recorded in active_candidates or evidence
  assert.strictEqual(ledger._active_candidates.M1, undefined);
  assert.strictEqual(ledger.evidence.M1, undefined);

  // Zen GO promotion is impossible without active candidate
  assert.throws(
    () =>
      ledger.recordZenGo(
        sampleVerdict({
          result_ref: "ref-sha256-nonexistent",
        })
      ),
    InvalidTransitionError
  );

  // Milestone is still active and can receive a valid DONE candidate
  const cand = sampleCandidate();
  const { result_ref } = ledger.receiveCandidate(cand);
  const verdict = ledger.recordZenGo(sampleVerdict({ result_ref }));
  assert.strictEqual(verdict.verdict, "GO");
  assert.deepStrictEqual(ledger.completed_milestones, ["M1"]);
});

runTest("3.5: Candidate reception strictly enforces all required fields fail-closed", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  // 1. Missing or invalid milestone_id
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ milestone_id: undefined })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ milestone_id: "" })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ milestone_id: "   " })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ milestone_id: 123 })), InvalidTransitionError);

  // 2. Missing or invalid plan_version
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ plan_version: undefined })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ plan_version: null })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ plan_version: "" })), InvalidTransitionError);

  // 3. Missing or invalid changes_made
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ changes_made: undefined })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ changes_made: null })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ changes_made: 123 })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ changes_made: { file: "test" } })), InvalidTransitionError);

  // 4. Missing or empty verification_evidence (cannot enter DONE review with empty evidence)
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ verification_evidence: undefined })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ verification_evidence: null })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ verification_evidence: "" })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ verification_evidence: "   " })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ verification_evidence: [] })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ verification_evidence: [""] })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ verification_evidence: ["   ", "\t\n"] })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ verification_evidence: [null] })), InvalidTransitionError);

  // 5. Missing or invalid unresolved_unknowns
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ unresolved_unknowns: undefined })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ unresolved_unknowns: null })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ unresolved_unknowns: 123 })), InvalidTransitionError);

  // 6. Missing or invalid scope_deviations
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ scope_deviations: undefined })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ scope_deviations: null })), InvalidTransitionError);
  assert.throws(() => ledger.receiveCandidate(sampleCandidate({ scope_deviations: 123 })), InvalidTransitionError);

  // Valid submissions with string or array variants succeed
  const validStringCandidate = sampleCandidate({
    changes_made: "Single string change",
    verification_evidence: "Single string evidence",
    unresolved_unknowns: "None observed",
    scope_deviations: "None",
  });
  const res = ledger.receiveCandidate(validStringCandidate);
  assert.ok(res.result_ref.startsWith("ref-sha256-"));
  assert.deepStrictEqual(res.candidate_record.changes_made, ["Single string change"]);
  assert.deepStrictEqual(res.candidate_record.verification_evidence, ["Single string evidence"]);
});

runTest("3.6: Candidate artifact reference normalization, alias consistency, and deterministic hash parity", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  const base = {
    milestone_id: "M1",
    plan_version: "v1",
    status: "DONE",
    changes_made: ["Refactored artifact handling"],
    verification_evidence: ["Tests passed 100%"],
    unresolved_unknowns: [],
    scope_deviations: [],
  };

  // 1. candidate_artifact_ref only
  const candOnly = { ...base, candidate_artifact_ref: "scripts/runner.mjs" };
  const refFromCandOnly = generateResultRef(candOnly);

  // 2. artifact_ref only
  const aliasOnly = { ...base, artifact_ref: "scripts/runner.mjs" };
  const refFromAliasOnly = generateResultRef(aliasOnly);

  // 3. Both aliases present with identical value
  const bothIdentical = {
    ...base,
    candidate_artifact_ref: "scripts/runner.mjs",
    artifact_ref: "scripts/runner.mjs",
  };
  const refFromBoth = generateResultRef(bothIdentical);

  // Deterministic hash must be 100% identical across all three inputs
  assert.strictEqual(refFromCandOnly, refFromAliasOnly);
  assert.strictEqual(refFromBoth, refFromCandOnly);

  // 4. Both aliases present with differing values -> fail-closed
  const conflicting = {
    ...base,
    candidate_artifact_ref: "scripts/runner.mjs",
    artifact_ref: "scripts/other.mjs",
  };
  assert.throws(() => generateResultRef(conflicting), InvariantViolationError);
  assert.throws(() => ledger.receiveCandidate(conflicting), InvalidTransitionError);

  // 5. Normalization in receiveCandidate: stores canonical candidate_artifact_ref and removes artifact_ref
  const { result_ref, candidate_record } = ledger.receiveCandidate(aliasOnly);
  assert.strictEqual(result_ref, refFromAliasOnly);
  assert.strictEqual(candidate_record.candidate_artifact_ref, "scripts/runner.mjs");
  assert.strictEqual(candidate_record.artifact_ref, undefined);
  assert.strictEqual(candidate_record.payload.candidate_artifact_ref, "scripts/runner.mjs");
  assert.strictEqual(candidate_record.payload.artifact_ref, undefined);
});

runTest("3.7: Candidate immutable snapshot enforcement: deep clone and recursive deep freeze prevent mutations", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  const externalPacket = {
    milestone_id: "M1",
    plan_version: "v1",
    status: "DONE",
    changes_made: ["Initial change"],
    verification_evidence: ["Initial evidence"],
    unresolved_unknowns: ["Initial unknown"],
    scope_deviations: ["Initial deviation"],
    candidate_artifact_ref: "scripts/runner.mjs",
  };

  const { result_ref, candidate_record } = ledger.receiveCandidate(externalPacket);

  // 1. Mutate external packet nested arrays and fields
  externalPacket.changes_made.push("Mutated change");
  externalPacket.verification_evidence[0] = "Mutated evidence";
  externalPacket.verification_evidence.push("Second evidence");
  externalPacket.unresolved_unknowns.push("Mutated unknown");
  externalPacket.scope_deviations.push("Mutated deviation");
  externalPacket.status = "MUTATED";
  externalPacket.candidate_artifact_ref = "scripts/mutated.mjs";

  // Internal candidate record remains completely intact
  assert.deepStrictEqual(candidate_record.changes_made, ["Initial change"]);
  assert.deepStrictEqual(candidate_record.verification_evidence, ["Initial evidence"]);
  assert.deepStrictEqual(candidate_record.unresolved_unknowns, ["Initial unknown"]);
  assert.deepStrictEqual(candidate_record.scope_deviations, ["Initial deviation"]);
  assert.strictEqual(candidate_record.status, "DONE");
  assert.strictEqual(candidate_record.candidate_artifact_ref, "scripts/runner.mjs");

  // Internal candidate payload remains completely intact
  assert.deepStrictEqual(candidate_record.payload.changes_made, ["Initial change"]);
  assert.deepStrictEqual(candidate_record.payload.verification_evidence, ["Initial evidence"]);
  assert.deepStrictEqual(candidate_record.payload.unresolved_unknowns, ["Initial unknown"]);
  assert.deepStrictEqual(candidate_record.payload.scope_deviations, ["Initial deviation"]);
  assert.strictEqual(candidate_record.payload.status, "DONE");
  assert.strictEqual(candidate_record.payload.candidate_artifact_ref, "scripts/runner.mjs");

  // Also verify evidence in ledger tracking
  assert.deepStrictEqual(ledger.evidence.M1.active_candidate.changes_made, ["Initial change"]);
  assert.deepStrictEqual(ledger.evidence[result_ref].payload.changes_made, ["Initial change"]);

  // 2. In-memory recursive deep freeze prevents mutation on record and payload
  assert.throws(() => { candidate_record.changes_made.push("Direct mutate"); }, TypeError);
  assert.throws(() => { candidate_record.verification_evidence[0] = "Direct mutate"; }, TypeError);
  assert.throws(() => { candidate_record.payload.changes_made.push("Direct mutate"); }, TypeError);
  assert.throws(() => { candidate_record.status = "FAIL"; }, TypeError);
  assert.throws(() => { candidate_record.payload.status = "FAIL"; }, TypeError);
});

// =============================================================================
// Section 4: Zen Review & Milestone Promotion
// =============================================================================

runTest("4.1: Zen GO verifies and promotes milestone, clears current_milestone, and updates next_action", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  const { result_ref } = ledger.receiveCandidate(
    sampleCandidate({ changes_made: ["files created"], verification_evidence: ["Verified all tests pass"] })
  );

  const verdictRecord = ledger.recordZenGo(
    sampleVerdict({
      milestone_id: "M1",
      plan_version: "v1",
      result_ref: result_ref,
      verdict: "GO",
      verification_evidence: ["Verified all tests pass"],
    })
  );

  assert.strictEqual(verdictRecord.verdict, "GO");
  assert.strictEqual(verdictRecord.is_stale, false);
  assert.strictEqual(ledger.current_milestone, null);
  assert.deepStrictEqual(ledger.completed_milestones, ["M1"]);
  assert.ok(ledger.verification.M1);
  assert.strictEqual(ledger.verification.M1.verdict, "GO");
  assert.ok(ledger.next_action.includes("Milestone 'M1' verified (GO)"));

  // Now dependent milestone M2 can be delegated
  const m2Handoff = ledger.delegate("M2");
  assert.strictEqual(m2Handoff.milestone_id, "M2");
  assert.strictEqual(ledger.current_milestone, "M2");
});

runTest("4.2: Zen NO-GO records verdict, clears current_milestone, leaves milestone incomplete", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  const { result_ref } = ledger.receiveCandidate(
    sampleCandidate({ changes_made: ["flawed implementation"], verification_evidence: ["tests ran and failed"] })
  );

  const verdict = ledger.recordZenNoGo({
    milestone_id: "M1",
    plan_version: "v1",
    result_ref: result_ref,
    verdict: "NO-GO",
    verification_evidence: ["Observed test failure in runner"],
    repair_needs: "Fix concurrency defect",
  });

  assert.strictEqual(verdict.verdict, "NO-GO");
  assert.strictEqual(ledger.current_milestone, null);
  assert.strictEqual(ledger.completed_milestones.includes("M1"), false);
  assert.ok(ledger.verification.M1);
  assert.strictEqual(ledger.verification.M1.verdict, "NO-GO");
  assert.ok(ledger.next_action.includes("Zen NO-GO"));

  // Because M1 is not completed, M2 cannot be delegated
  assert.throws(() => ledger.delegate("M2"), InvalidTransitionError);

  // M1 can be redelegated for repair
  const redelegated = ledger.delegate("M1");
  assert.strictEqual(redelegated.milestone_id, "M1");
});

runTest("4.3: Zen verdict rejects mismatched result_ref (MismatchedResultRefError)", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  ledger.receiveCandidate(sampleCandidate());

  assert.throws(
    () =>
      ledger.recordZenGo(
        sampleVerdict({
          milestone_id: "M1",
          plan_version: "v1",
          result_ref: "ref-sha256-wrong-ref-123456",
          verdict: "GO",
          verification_evidence: ["Verified"],
        })
      ),
    MismatchedResultRefError
  );

  assert.throws(
    () =>
      ledger.recordZenNoGo({
        milestone_id: "M1",
        plan_version: "v1",
        result_ref: "ref-sha256-wrong-ref-123456",
        verdict: "NO-GO",
        verification_evidence: ["Failed verification"],
      }),
    MismatchedResultRefError
  );
});

runTest("4.4: Zen verdict rejects stale plan_version (StaleVerdictError)", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  const { result_ref } = ledger.receiveCandidate(sampleCandidate());

  assert.throws(
    () =>
      ledger.recordZenGo(
        sampleVerdict({
          milestone_id: "M1",
          plan_version: "v0", // stale version
          result_ref: result_ref,
          verdict: "GO",
          verification_evidence: ["Verified"],
        })
      ),
    StaleVerdictError
  );
});

runTest("4.5: Zen verdict fail-open removal - recordZenGo and recordZenNoGo strictly require explicit verdict 'GO' and 'NO-GO'", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");
  const { result_ref } = ledger.receiveCandidate(sampleCandidate());

  const baseGoPacket = {
    milestone_id: "M1",
    plan_version: "v1",
    result_ref: result_ref,
    verification_evidence: ["Zen review completed"],
  };

  // Missing verdict property does NOT default to GO
  assert.throws(() => ledger.recordZenGo({ ...baseGoPacket }), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo({ ...baseGoPacket, verdict: undefined }), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo({ ...baseGoPacket, verdict: null }), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo({ ...baseGoPacket, verdict: "" }), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo({ ...baseGoPacket, verdict: "NO-GO" }), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo({ ...baseGoPacket, verdict: "PASS" }), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo({ ...baseGoPacket, verdict: "APPROVED" }), InvalidTransitionError);

  // Missing verdict property does NOT default to NO-GO
  assert.throws(() => ledger.recordZenNoGo({ ...baseGoPacket }), InvalidTransitionError);
  assert.throws(() => ledger.recordZenNoGo({ ...baseGoPacket, verdict: undefined }), InvalidTransitionError);
  assert.throws(() => ledger.recordZenNoGo({ ...baseGoPacket, verdict: null }), InvalidTransitionError);
  assert.throws(() => ledger.recordZenNoGo({ ...baseGoPacket, verdict: "" }), InvalidTransitionError);
  assert.throws(() => ledger.recordZenNoGo({ ...baseGoPacket, verdict: "GO" }), InvalidTransitionError);
  assert.throws(() => ledger.recordZenNoGo({ ...baseGoPacket, verdict: "REJECT" }), InvalidTransitionError);

  // Milestone promotion was impossible
  assert.strictEqual(ledger.completed_milestones.includes("M1"), false);
  assert.strictEqual(ledger.current_milestone, "M1");
});

runTest("4.6: Zen verdict packet fail-closed required fields validation (milestone_id, plan_version, result_ref, non-empty verification_evidence)", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");
  const { result_ref } = ledger.receiveCandidate(sampleCandidate());

  // Missing / empty milestone_id
  assert.throws(() => ledger.recordZenGo(sampleVerdict({ result_ref, milestone_id: undefined })), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo(sampleVerdict({ result_ref, milestone_id: "" })), InvalidTransitionError);
  assert.throws(() => ledger.recordZenNoGo(sampleVerdict({ result_ref, verdict: "NO-GO", milestone_id: undefined })), InvalidTransitionError);

  // Missing / empty plan_version
  assert.throws(() => ledger.recordZenGo(sampleVerdict({ result_ref, plan_version: undefined })), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo(sampleVerdict({ result_ref, plan_version: null })), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo(sampleVerdict({ result_ref, plan_version: "" })), InvalidTransitionError);

  // Missing / empty result_ref
  assert.throws(() => ledger.recordZenGo(sampleVerdict({ result_ref: undefined })), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo(sampleVerdict({ result_ref: "" })), InvalidTransitionError);
  assert.throws(() => ledger.recordZenNoGo(sampleVerdict({ result_ref: undefined, verdict: "NO-GO" })), InvalidTransitionError);

  // Missing / empty verification_evidence in recordZenGo
  assert.throws(() => ledger.recordZenGo(sampleVerdict({ result_ref, verification_evidence: undefined })), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo(sampleVerdict({ result_ref, verification_evidence: null })), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo(sampleVerdict({ result_ref, verification_evidence: "" })), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo(sampleVerdict({ result_ref, verification_evidence: "   " })), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo(sampleVerdict({ result_ref, verification_evidence: [] })), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo(sampleVerdict({ result_ref, verification_evidence: [""] })), InvalidTransitionError);
  assert.throws(() => ledger.recordZenGo(sampleVerdict({ result_ref, verification_evidence: ["   ", "\t"] })), InvalidTransitionError);

  // Missing / empty verification_evidence in recordZenNoGo
  assert.throws(() => ledger.recordZenNoGo(sampleVerdict({ result_ref, verdict: "NO-GO", verification_evidence: undefined })), InvalidTransitionError);
  assert.throws(() => ledger.recordZenNoGo(sampleVerdict({ result_ref, verdict: "NO-GO", verification_evidence: [] })), InvalidTransitionError);
  assert.throws(() => ledger.recordZenNoGo(sampleVerdict({ result_ref, verdict: "NO-GO", verification_evidence: "   " })), InvalidTransitionError);

  // Crucial invariant: milestone promotion is impossible when any required field is missing
  assert.strictEqual(ledger.completed_milestones.includes("M1"), false);
  assert.strictEqual(ledger.current_milestone, "M1");

  // With all required fields supplied, GO promotes milestone
  const validGo = ledger.recordZenGo(sampleVerdict({ result_ref }));
  assert.strictEqual(validGo.verdict, "GO");
  assert.deepStrictEqual(ledger.completed_milestones, ["M1"]);
  assert.strictEqual(ledger.current_milestone, null);
});

// =============================================================================
// Section 5: Blockers & Resolution
// =============================================================================

runTest("5.1: Failure / blocker reporting clears active milestone, records blocker, does NOT promote milestone", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  const res = ledger.recordBlockedOrFailure({
    milestoneId: "M1",
    status: "BLOCKED",
    blockers: [
      {
        id: "B-01",
        description: "API quota exhausted on third-party service",
      },
    ],
    escalationNeeds: "Piledriver architectural review",
    evidence: "HTTP 429 Too Many Requests observed in runner logs",
  });

  assert.strictEqual(res.status, "BLOCKED");
  assert.strictEqual(ledger.current_milestone, null);
  assert.strictEqual(ledger.completed_milestones.includes("M1"), false);
  assert.strictEqual(ledger.blockers.length, 1);
  assert.strictEqual(ledger.blockers[0].id, "B-01");
  assert.strictEqual(ledger.blockers[0].affects_milestone, "M1");
  assert.ok(ledger.evidence.M1.failure_evidence);
});

runTest("5.2: Blocker resolution requires observed evidence and never promotes milestone", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");
  ledger.recordBlockedOrFailure({
    milestoneId: "M1",
    status: "BLOCKED",
    blockers: [{ id: "B-01", description: "Quota issue" }],
  });

  // Cannot resolve non-existent blocker
  assert.throws(() => ledger.resolveBlocker("NON_EXISTENT", "evidence"), BlockerNotFoundError);

  // Cannot resolve blocker without observed evidence
  assert.throws(() => ledger.resolveBlocker("B-01", ""), InvariantViolationError);
  assert.throws(() => ledger.resolveBlocker("B-01", null), InvariantViolationError);
  assert.throws(() => ledger.resolveBlocker("B-01", []), InvariantViolationError);

  // Successfully resolve with evidence
  const resolution = ledger.resolveBlocker("B-01", "Observed new token pool refreshed, HTTP 200 returned");
  assert.strictEqual(resolution.blocker_id, "B-01");
  assert.strictEqual(ledger.blockers.length, 0);
  assert.ok(ledger.evidence.resolved_blockers.length > 0);

  // Crucial invariant: resolving blocker does NOT promote milestone
  assert.strictEqual(ledger.completed_milestones.includes("M1"), false);
});

// =============================================================================
// Section 6: Material Replan Invalidation
// =============================================================================

runTest("6.1: Material replan monotonically increments plan_version, marks verdicts stale, clears completed milestones", () => {
  const ledger = new AuthoritativeLedger(samplePlan());

  // Complete M1 under v1
  ledger.delegate("M1");
  const { result_ref } = ledger.receiveCandidate(sampleCandidate());
  ledger.recordZenGo(sampleVerdict({ result_ref }));

  assert.deepStrictEqual(ledger.completed_milestones, ["M1"]);
  assert.strictEqual(ledger.verification.M1.is_stale, false);
  assert.strictEqual(ledger.plan_version, "v1");

  // Material replan occurs
  ledger.materialReplan({
    goal: "Updated Goal with Revised Scope",
    milestones: [
      {
        id: "M1",
        title: "Exact-model Runner Spike (Retained)",
        objective: "Retained milestone needing fresh verification",
        acceptance_criteria: ["Runner resolves slugs"],
        dependencies: [],
      },
      {
        id: "M2",
        title: "Authoritative Ledger (Updated)",
        objective: "Milestone 2 updated",
        acceptance_criteria: ["Ledger validates invariants"],
        dependencies: ["M1"],
      },
      {
        id: "M3",
        title: "New Integration Milestone",
        objective: "Connect spine",
        acceptance_criteria: ["Spine connected"],
        dependencies: ["M2"],
      },
    ],
  });

  // Monotonic version increment
  assert.strictEqual(ledger.plan_version, "v2");
  assert.strictEqual(ledger.goal, "Updated Goal with Revised Scope");

  // Verification marked stale
  assert.strictEqual(ledger.verification.M1.is_stale, true);

  // Completed and active cleared
  assert.deepStrictEqual(ledger.completed_milestones, []);
  assert.strictEqual(ledger.current_milestone, null);

  // Cannot declare global completion using stale verification
  assert.throws(() => ledger.declareGlobalCompletion(), InvariantViolationError);

  // Retained milestone must pass fresh in dependency order under new version
  // Cannot delegate M2 because M1 is not completed under v2
  assert.throws(() => ledger.delegate("M2"), InvalidTransitionError);

  // Retest M1 under v2
  ledger.delegate("M1");
  const v2Cand = ledger.receiveCandidate(sampleCandidate({ plan_version: "v2" }));
  ledger.recordZenGo(sampleVerdict({ plan_version: "v2", result_ref: v2Cand.result_ref }));

  assert.deepStrictEqual(ledger.completed_milestones, ["M1"]);
  assert.strictEqual(ledger.verification.M1.is_stale, false);
  assert.strictEqual(ledger.verification.M1.plan_version, "v2");
});

runTest("6.2: Version increment and parsing helper supports both 'vN' and integer version formats", () => {
  assert.strictEqual(incrementPlanVersion("v1"), "v2");
  assert.strictEqual(incrementPlanVersion("v9"), "v10");
  assert.strictEqual(incrementPlanVersion("1"), "2");
  assert.strictEqual(incrementPlanVersion(1), 2);
  assert.strictEqual(incrementPlanVersion(9), 10);

  assert.deepStrictEqual(parseVersion("v1"), { prefix: "v", num: 1 });
  assert.deepStrictEqual(parseVersion("v9"), { prefix: "v", num: 9 });
  assert.deepStrictEqual(parseVersion("v10"), { prefix: "v", num: 10 });
  assert.deepStrictEqual(parseVersion("1"), { prefix: "", num: 1 });
  assert.deepStrictEqual(parseVersion(1), { prefix: "", num: 1 });
});

runTest("6.3: Material replan rejects active execution and non-monotonic / backward plan_version transitions", () => {
  const ledger = new AuthoritativeLedger(samplePlan());

  // 1. Replan blocked while milestone is actively executing
  ledger.delegate("M1");
  assert.strictEqual(ledger.current_milestone, "M1");
  assert.throws(
    () =>
      ledger.materialReplan({
        milestones: [{ id: "M1", title: "M1" }],
      }),
    (err) => {
      assert.ok(err instanceof InvalidTransitionError);
      assert.ok(err.message.includes("is actively executing or under review"));
      return true;
    }
  );

  // Still blocked when candidate is received (under review)
  ledger.receiveCandidate(sampleCandidate());
  assert.throws(
    () =>
      ledger.materialReplan({
        milestones: [{ id: "M1", title: "M1" }],
      }),
    InvalidTransitionError
  );

  // Transition to inactive (e.g. via Zen NO-GO)
  ledger.recordZenNoGo(
    sampleVerdict({
      milestone_id: "M1",
      plan_version: "v1",
      result_ref: ledger._active_candidates.M1.result_ref,
      verdict: "NO-GO",
      verification_evidence: ["NO-GO evidence"],
    })
  );
  assert.strictEqual(ledger.current_milestone, null);

  const replanPayload = {
    goal: "Updated Goal",
    milestones: [{ id: "M1", title: "M1" }],
  };

  // 2. Reject same version (v1 -> v1)
  assert.throws(
    () =>
      ledger.materialReplan({
        ...replanPayload,
        plan_version: "v1",
      }),
    InvalidTransitionError
  );

  // 3. Reject backward version (v9 -> v1)
  ledger.plan_version = "v9";
  assert.throws(
    () =>
      ledger.materialReplan({
        ...replanPayload,
        plan_version: "v1",
      }),
    InvalidTransitionError
  );

  // Also reject backward version with numbers (9 -> 1)
  ledger.plan_version = 9;
  assert.throws(
    () =>
      ledger.materialReplan({
        ...replanPayload,
        plan_version: 1,
      }),
    InvalidTransitionError
  );

  // Reject same numerical version (2 -> 2)
  ledger.plan_version = 2;
  assert.throws(
    () =>
      ledger.materialReplan({
        ...replanPayload,
        plan_version: 2,
      }),
    InvalidTransitionError
  );

  // 4. Monotonic increase succeeds
  ledger.plan_version = "v9";
  ledger.materialReplan({
    ...replanPayload,
    plan_version: "v10",
  });
  assert.strictEqual(ledger.plan_version, "v10");
});

runTest("6.4: Material replan strictly rejects incompatible version formats, prefix changes, and type changes (fail-closed)", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  const baseReplan = {
    goal: "Goal",
    milestones: [{ id: "M1", title: "M1" }],
  };

  // When ledger plan_version is string 'v9':
  ledger.plan_version = "v9";

  // v9 -> x1 (prefix change)
  assert.throws(() => ledger.materialReplan({ ...baseReplan, plan_version: "x1" }), InvalidTransitionError);

  // v9 -> 1 (type change: string to number)
  assert.throws(() => ledger.materialReplan({ ...baseReplan, plan_version: 1 }), InvalidTransitionError);

  // v9 -> "1" (prefix change: 'v' to '')
  assert.throws(() => ledger.materialReplan({ ...baseReplan, plan_version: "1" }), InvalidTransitionError);

  // v9 -> "foo" (incomparable format)
  assert.throws(() => ledger.materialReplan({ ...baseReplan, plan_version: "foo" }), InvalidTransitionError);

  // v9 -> "v8" (backward version)
  assert.throws(() => ledger.materialReplan({ ...baseReplan, plan_version: "v8" }), InvalidTransitionError);

  // v9 -> "v9" (same version)
  assert.throws(() => ledger.materialReplan({ ...baseReplan, plan_version: "v9" }), InvalidTransitionError);

  // Valid monotonic increase v9 -> v10 succeeds
  ledger.materialReplan({ ...baseReplan, plan_version: "v10" });
  assert.strictEqual(ledger.plan_version, "v10");

  // When ledger plan_version is integer 1:
  ledger.plan_version = 1;

  // 1 -> "v2" (type change: number to string)
  assert.throws(() => ledger.materialReplan({ ...baseReplan, plan_version: "v2" }), InvalidTransitionError);

  // 1 -> "foo" (type change / invalid format)
  assert.throws(() => ledger.materialReplan({ ...baseReplan, plan_version: "foo" }), InvalidTransitionError);

  // 1 -> "2" (type change: number to string)
  assert.throws(() => ledger.materialReplan({ ...baseReplan, plan_version: "2" }), InvalidTransitionError);

  // 1 -> 1 (same integer)
  assert.throws(() => ledger.materialReplan({ ...baseReplan, plan_version: 1 }), InvalidTransitionError);

  // 1 -> 0 (backward integer)
  assert.throws(() => ledger.materialReplan({ ...baseReplan, plan_version: 0 }), InvalidTransitionError);

  // Valid monotonic increase 1 -> 2 succeeds
  ledger.materialReplan({ ...baseReplan, plan_version: 2 });
  assert.strictEqual(ledger.plan_version, 2);
});

// =============================================================================
// Section 7: Global Completion Enforcements
// =============================================================================

runTest("7.1: Global completion strictly enforces all acceptance criteria", () => {
  const ledger = new AuthoritativeLedger(samplePlan());

  // 1. Cannot complete on unstarted project
  assert.throws(() => ledger.declareGlobalCompletion(), InvariantViolationError);

  // 2. Complete M1
  ledger.delegate("M1");
  const cand1 = ledger.receiveCandidate(sampleCandidate({ milestone_id: "M1" }));
  ledger.recordZenGo(sampleVerdict({ milestone_id: "M1", result_ref: cand1.result_ref }));

  // Cannot complete with M2 still incomplete
  assert.throws(() => ledger.declareGlobalCompletion(), InvariantViolationError);

  // 3. Delegate M2
  ledger.delegate("M2");
  // Cannot complete while milestone is active
  assert.throws(() => ledger.declareGlobalCompletion(), InvariantViolationError);

  const cand2 = ledger.receiveCandidate(sampleCandidate({ milestone_id: "M2" }));
  ledger.recordZenGo(sampleVerdict({ milestone_id: "M2", result_ref: cand2.result_ref }));

  // 4. Inject an active blocker: cannot complete with active blocker
  ledger.blockers.push({ id: "B-TEST", description: "Unresolved blocker" });
  assert.throws(() => ledger.declareGlobalCompletion(), InvariantViolationError);
  ledger.blockers.pop();

  // 5. All criteria met: global completion succeeds
  const report = ledger.declareGlobalCompletion();
  assert.strictEqual(report.completed, true);
  assert.strictEqual(report.plan_version, "v1");
  assert.deepStrictEqual(report.completed_milestones, ["M1", "M2"]);
  assert.ok(ledger.next_action.includes("Project execution completed"));
});

// =============================================================================
// Section 8: Persistence & Fresh-Context Resume
// =============================================================================

runTest("8.1: Atomic persistence and fresh-context resume without conversational memory", () => {
  const testFile = join(tmpdir(), `ntg-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  try {
    const originalLedger = new AuthoritativeLedger(samplePlan());

    // Complete M1 in original session
    originalLedger.delegate("M1");
    const cand1 = originalLedger.receiveCandidate(sampleCandidate({ milestone_id: "M1" }));
    originalLedger.recordZenGo(sampleVerdict({ milestone_id: "M1", result_ref: cand1.result_ref }));

    // Delegate M2 and receive candidate, then simulate context break / restart
    originalLedger.delegate("M2");
    const cand2 = originalLedger.receiveCandidate(
      sampleCandidate({
        milestone_id: "M2",
        candidate_artifact_ref: "scripts/ledger.mjs",
        changes_made: ["Implemented AuthoritativeLedger"],
        verification_evidence: ["test_ledger.mjs passed"],
      })
    );

    // Save state atomically
    originalLedger.save(testFile);
    assert.ok(existsSync(testFile), "Persisted ledger file must exist");

    // Fresh Steamroller instance loads from disk without conversational memory
    const resumedLedger = AuthoritativeLedger.load(testFile);

    // Verify all restored invariants
    assert.strictEqual(resumedLedger.goal, originalLedger.goal);
    assert.strictEqual(resumedLedger.plan_version, "v1");
    assert.deepStrictEqual(resumedLedger.completed_milestones, ["M1"]);
    assert.strictEqual(resumedLedger.current_milestone, "M2");
    assert.ok(resumedLedger.evidence.M2.active_candidate);
    assert.strictEqual(resumedLedger.evidence.M2.active_candidate.result_ref, cand2.result_ref);

    // Resumed instance accepts Zen GO for M2
    resumedLedger.recordZenGo(
      sampleVerdict({
        milestone_id: "M2",
        result_ref: cand2.result_ref,
        verification_evidence: ["test_ledger.mjs passed"],
      })
    );

    assert.deepStrictEqual(resumedLedger.completed_milestones, ["M1", "M2"]);
    assert.strictEqual(resumedLedger.current_milestone, null);

    // Resumed instance declares global completion
    const completion = resumedLedger.declareGlobalCompletion();
    assert.strictEqual(completion.completed, true);
  } finally {
    try {
      if (existsSync(testFile)) {
        unlinkSync(testFile);
      }
    } catch {}
  }
});

runTest("8.2: Corrupted or invariant-violating persisted file fails to load with InvariantViolationError", () => {
  const badJsonFile = join(tmpdir(), `bad-json-${Date.now()}.json`);
  const corruptedFile = join(tmpdir(), `corrupted-state-${Date.now()}.json`);

  try {
    writeFileSync(badJsonFile, "corrupted json {{{", "utf-8");
    assert.throws(() => AuthoritativeLedger.load(badJsonFile), InvariantViolationError);

    // Invariant violation in state: completed milestone without verification entry
    const invalidState = {
      goal: "Test",
      constraints: [],
      plan_version: "v1",
      milestones: [{ id: "M1" }],
      current_milestone: null,
      completed_milestones: ["M1"],
      evidence: {},
      verification: {}, // missing verification for M1!
      blockers: [],
      decision_invariants: [],
    };
    writeFileSync(corruptedFile, JSON.stringify(invalidState), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(corruptedFile), InvariantViolationError);
  } finally {
    try {
      if (existsSync(badJsonFile)) unlinkSync(badJsonFile);
      if (existsSync(corruptedFile)) unlinkSync(corruptedFile);
    } catch {}
  }
});

runTest("8.3: Resume invariant validation rejects completed milestones with old plan_version, dangling result_ref, or candidate mismatches", () => {
  // Helper to construct a valid completed M1 state object
  function makeValidCompletedState() {
    const candidatePacket = {
      milestone_id: "M1",
      plan_version: "v1",
      status: "DONE",
      candidate_artifact_ref: "scripts/runner.mjs",
      changes_made: ["Initial runner spike"],
      verification_evidence: ["Tests pass"],
      unresolved_unknowns: [],
      scope_deviations: [],
    };
    const ref = generateResultRef(candidatePacket);
    const candRecord = {
      milestone_id: "M1",
      plan_version: "v1",
      result_ref: ref,
      candidate_artifact_ref: "scripts/runner.mjs",
      status: "DONE",
      changes_made: ["Initial runner spike"],
      verification_evidence: ["Tests pass"],
      unresolved_unknowns: [],
      scope_deviations: [],
      timestamp: new Date().toISOString(),
      payload: { ...candidatePacket, result_ref: ref },
    };
    const verRecord = {
      milestone_id: "M1",
      plan_version: "v1",
      result_ref: ref,
      verdict: "GO",
      verification_evidence: ["Tests pass"],
      is_stale: false,
      timestamp: new Date().toISOString(),
      details: { verdict: "GO" },
    };

    return {
      goal: "Valid Project",
      constraints: [],
      plan_version: "v1",
      milestones: [{ id: "M1", title: "M1", acceptance_criteria: ["Done"], dependencies: [] }],
      current_milestone: null,
      completed_milestones: ["M1"],
      evidence: {
        M1: { active_candidate: candRecord, candidates: [candRecord] },
        [ref]: candRecord,
      },
      verification: {
        M1: verRecord,
      },
      blockers: [],
      decision_invariants: [],
      next_action: "Ready",
    };
  }

  // Baseline check: valid state restores cleanly
  const validState = makeValidCompletedState();
  const restored = AuthoritativeLedger.fromJSON(validState);
  assert.strictEqual(restored.plan_version, "v1");
  assert.deepStrictEqual(restored.completed_milestones, ["M1"]);

  // 8.3.a: Completed milestone with old plan_version GO in verification
  const oldPlanVerState = makeValidCompletedState();
  oldPlanVerState.plan_version = "v2"; // Ledger is v2, but verification.M1 is v1
  assert.throws(
    () => AuthoritativeLedger.fromJSON(oldPlanVerState),
    InvariantViolationError
  );

  // 8.3.b: Dangling result_ref in verification (not in evidence)
  const danglingRefState = makeValidCompletedState();
  danglingRefState.verification.M1.result_ref = "ref-sha256-dangling-ghost-ref";
  assert.throws(
    () => AuthoritativeLedger.fromJSON(danglingRefState),
    InvariantViolationError
  );

  // Also test missing/empty result_ref in verification
  const missingRefState = makeValidCompletedState();
  delete missingRefState.verification.M1.result_ref;
  assert.throws(
    () => AuthoritativeLedger.fromJSON(missingRefState),
    InvariantViolationError
  );

  // 8.3.c: Candidate / verification milestone mismatch
  const candMilestoneMismatchState = makeValidCompletedState();
  const refC = candMilestoneMismatchState.verification.M1.result_ref;
  candMilestoneMismatchState.evidence[refC] = {
    ...candMilestoneMismatchState.evidence[refC],
    milestone_id: "M2", // Mismatch with completed milestone M1
  };
  assert.throws(
    () => AuthoritativeLedger.fromJSON(candMilestoneMismatchState),
    InvariantViolationError
  );

  // 8.3.d: Candidate / verification plan_version mismatch
  const candPlanVerMismatchState = makeValidCompletedState();
  const refD = candPlanVerMismatchState.verification.M1.result_ref;
  candPlanVerMismatchState.evidence[refD] = {
    ...candPlanVerMismatchState.evidence[refD],
    plan_version: "v2", // Mismatch with ledger plan_version v1
  };
  assert.throws(
    () => AuthoritativeLedger.fromJSON(candPlanVerMismatchState),
    InvariantViolationError
  );

  // Also candidate result_ref mismatch
  const candRefMismatchState = makeValidCompletedState();
  const refE = candRefMismatchState.verification.M1.result_ref;
  candRefMismatchState.evidence[refE] = {
    ...candRefMismatchState.evidence[refE],
    result_ref: "ref-sha256-mismatched-cand-ref",
  };
  assert.throws(
    () => AuthoritativeLedger.fromJSON(candRefMismatchState),
    InvariantViolationError
  );
});

runTest("8.4: fromJSON() and load() result_ref integrity recomputation rejects tampered candidate payload with unchanged result_ref", () => {
  function makeValidState() {
    const candidatePacket = {
      milestone_id: "M1",
      plan_version: "v1",
      status: "DONE",
      candidate_artifact_ref: "scripts/runner.mjs",
      changes_made: ["Initial runner spike"],
      verification_evidence: ["Tests pass"],
      unresolved_unknowns: [],
      scope_deviations: [],
    };
    const ref = generateResultRef(candidatePacket);
    const candRecord = {
      milestone_id: "M1",
      plan_version: "v1",
      result_ref: ref,
      candidate_artifact_ref: "scripts/runner.mjs",
      status: "DONE",
      changes_made: ["Initial runner spike"],
      verification_evidence: ["Tests pass"],
      unresolved_unknowns: [],
      scope_deviations: [],
      timestamp: new Date().toISOString(),
      payload: { ...candidatePacket, result_ref: ref },
    };
    const verRecord = {
      milestone_id: "M1",
      plan_version: "v1",
      result_ref: ref,
      verdict: "GO",
      verification_evidence: ["Tests pass"],
      is_stale: false,
      timestamp: new Date().toISOString(),
      details: { verdict: "GO" },
    };
    return {
      goal: "Valid Project",
      constraints: [],
      plan_version: "v1",
      milestones: [{ id: "M1", title: "M1", acceptance_criteria: ["Done"], dependencies: [] }],
      current_milestone: null,
      completed_milestones: ["M1"],
      evidence: {
        M1: { active_candidate: candRecord, candidates: [candRecord] },
        [ref]: candRecord,
      },
      verification: { M1: verRecord },
      blockers: [],
      decision_invariants: [],
      next_action: "Ready",
    };
  }

  // Baseline: valid state passes fromJSON
  assert.ok(AuthoritativeLedger.fromJSON(makeValidState()));

  // 1. Tamper payload.changes_made while keeping stored result_ref unchanged
  const tamperedPayloadState = makeValidState();
  const ref = tamperedPayloadState.verification.M1.result_ref;
  tamperedPayloadState.evidence[ref].payload.changes_made = ["Unauthorized backdoored code"];
  assert.throws(
    () => AuthoritativeLedger.fromJSON(tamperedPayloadState),
    InvariantViolationError
  );

  // Test via load() from file
  const testFile = join(tmpdir(), `tampered-payload-${Date.now()}.json`);
  try {
    writeFileSync(testFile, JSON.stringify(tamperedPayloadState), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(testFile), InvariantViolationError);
  } finally {
    try { if (existsSync(testFile)) unlinkSync(testFile); } catch {}
  }

  // 2. Tamper candidate record changes_made while leaving payload alone
  const tamperedCandRecordState = makeValidState();
  tamperedCandRecordState.evidence[ref].changes_made = ["Diverged from payload"];
  assert.throws(
    () => AuthoritativeLedger.fromJSON(tamperedCandRecordState),
    InvariantViolationError
  );

  // 3. Tamper payload.verification_evidence while keeping result_ref unchanged
  const tamperedEvState = makeValidState();
  tamperedEvState.evidence[ref].payload.verification_evidence = ["Fabricated test evidence"];
  assert.throws(
    () => AuthoritativeLedger.fromJSON(tamperedEvState),
    InvariantViolationError
  );
});

runTest("8.5: fromJSON() and load() result_ref integrity recomputation rejects tampered artifact binding with unchanged result_ref", () => {
  function makeValidStateWithArtifact() {
    const candidatePacket = {
      milestone_id: "M1",
      plan_version: "v1",
      status: "DONE",
      candidate_artifact_ref: "scripts/legit_artifact.mjs",
      changes_made: ["Legitimate implementation"],
      verification_evidence: ["Passes all tests"],
      unresolved_unknowns: [],
      scope_deviations: [],
    };
    const ref = generateResultRef(candidatePacket);
    const candRecord = {
      milestone_id: "M1",
      plan_version: "v1",
      result_ref: ref,
      candidate_artifact_ref: "scripts/legit_artifact.mjs",
      status: "DONE",
      changes_made: ["Legitimate implementation"],
      verification_evidence: ["Passes all tests"],
      unresolved_unknowns: [],
      scope_deviations: [],
      timestamp: new Date().toISOString(),
      payload: { ...candidatePacket, result_ref: ref },
    };
    const verRecord = {
      milestone_id: "M1",
      plan_version: "v1",
      result_ref: ref,
      verdict: "GO",
      verification_evidence: ["Passes all tests"],
      is_stale: false,
      timestamp: new Date().toISOString(),
      details: { verdict: "GO" },
    };
    return {
      goal: "Valid Project",
      constraints: [],
      plan_version: "v1",
      milestones: [{ id: "M1", title: "M1", acceptance_criteria: ["Done"], dependencies: [] }],
      current_milestone: null,
      completed_milestones: ["M1"],
      evidence: {
        M1: { active_candidate: candRecord, candidates: [candRecord] },
        [ref]: candRecord,
      },
      verification: { M1: verRecord },
      blockers: [],
      decision_invariants: [],
      next_action: "Ready",
    };
  }

  // Baseline: valid state passes fromJSON
  assert.ok(AuthoritativeLedger.fromJSON(makeValidStateWithArtifact()));

  // 1. Tamper candidate record artifact_ref only (mismatch with payload)
  const tamperedRecordArtifactState = makeValidStateWithArtifact();
  const ref = tamperedRecordArtifactState.verification.M1.result_ref;
  tamperedRecordArtifactState.evidence[ref].candidate_artifact_ref = "scripts/malicious_artifact.mjs";
  assert.throws(
    () => AuthoritativeLedger.fromJSON(tamperedRecordArtifactState),
    InvariantViolationError
  );

  // 2. Tamper BOTH record and payload artifact_ref while keeping result_ref unchanged
  const tamperedBothArtifactState = makeValidStateWithArtifact();
  tamperedBothArtifactState.evidence[ref].candidate_artifact_ref = "scripts/malicious_artifact.mjs";
  tamperedBothArtifactState.evidence[ref].payload.candidate_artifact_ref = "scripts/malicious_artifact.mjs";
  assert.throws(
    () => AuthoritativeLedger.fromJSON(tamperedBothArtifactState),
    InvariantViolationError
  );

  // Test via load()
  const testFile = join(tmpdir(), `tampered-artifact-${Date.now()}.json`);
  try {
    writeFileSync(testFile, JSON.stringify(tamperedBothArtifactState), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(testFile), InvariantViolationError);
  } finally {
    try { if (existsSync(testFile)) unlinkSync(testFile); } catch {}
  }

  // 3. Tampering active candidate's artifact binding or payload also throws
  const activeCandState = makeValidStateWithArtifact();
  activeCandState.completed_milestones = [];
  activeCandState.verification = {};
  activeCandState.current_milestone = "M1";
  activeCandState._active_candidates = { M1: activeCandState.evidence[ref] };

  // Valid active candidate loads cleanly
  assert.ok(AuthoritativeLedger.fromJSON(activeCandState));

  // Tamper active candidate's payload
  activeCandState._active_candidates.M1 = {
    ...activeCandState._active_candidates.M1,
    payload: {
      ...activeCandState._active_candidates.M1.payload,
      changes_made: ["Tampered active candidate payload"],
    },
  };
  assert.throws(
    () => AuthoritativeLedger.fromJSON(activeCandState),
    InvariantViolationError
  );
});

runTest("8.6: fromJSON() and load() reject candidate record divergence from payload (verification_evidence, unresolved_unknowns, scope_deviations, status, milestone_id, plan_version)", () => {
  function makeValidSavedState() {
    const candidatePacket = {
      milestone_id: "M1",
      plan_version: "v1",
      status: "DONE",
      candidate_artifact_ref: "scripts/runner.mjs",
      changes_made: ["Baseline changes"],
      verification_evidence: ["Baseline verification"],
      unresolved_unknowns: ["Baseline unknown"],
      scope_deviations: ["Baseline deviation"],
    };
    const ref = generateResultRef(candidatePacket);
    const candRecord = {
      milestone_id: "M1",
      plan_version: "v1",
      result_ref: ref,
      candidate_artifact_ref: "scripts/runner.mjs",
      status: "DONE",
      changes_made: ["Baseline changes"],
      verification_evidence: ["Baseline verification"],
      unresolved_unknowns: ["Baseline unknown"],
      scope_deviations: ["Baseline deviation"],
      timestamp: new Date().toISOString(),
      payload: { ...candidatePacket, result_ref: ref },
    };
    const verRecord = {
      milestone_id: "M1",
      plan_version: "v1",
      result_ref: ref,
      verdict: "GO",
      verification_evidence: ["Baseline verification"],
      is_stale: false,
      timestamp: new Date().toISOString(),
      details: { verdict: "GO" },
    };
    return {
      goal: "Test Project",
      constraints: [],
      plan_version: "v1",
      milestones: [{ id: "M1", title: "M1", acceptance_criteria: ["Done"], dependencies: [] }],
      current_milestone: null,
      completed_milestones: ["M1"],
      evidence: {
        M1: { active_candidate: candRecord, candidates: [candRecord] },
        [ref]: candRecord,
      },
      verification: { M1: verRecord },
      blockers: [],
      decision_invariants: [],
      next_action: "Ready",
    };
  }

  // Baseline: valid state passes fromJSON
  assert.ok(AuthoritativeLedger.fromJSON(makeValidSavedState()));

  // 8.6.b: Persisted top-level verification_evidence tampered (diverged from payload) -> load rejects with InvariantViolationError
  const tamperedEvState = makeValidSavedState();
  const ref = tamperedEvState.verification.M1.result_ref;
  tamperedEvState.evidence[ref].verification_evidence = ["Diverged / tampered verification evidence"];
  const fileB = join(tmpdir(), `tamper-ev-${Date.now()}.json`);
  try {
    writeFileSync(fileB, JSON.stringify(tamperedEvState), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(fileB), InvariantViolationError);
  } finally {
    try { if (existsSync(fileB)) unlinkSync(fileB); } catch {}
  }

  // 8.6.c: Persisted top-level unresolved_unknowns tampered -> load rejects with InvariantViolationError
  const tamperedUnknownsState = makeValidSavedState();
  tamperedUnknownsState.evidence[ref].unresolved_unknowns = ["Diverged / fabricated unknowns"];
  const fileC = join(tmpdir(), `tamper-unk-${Date.now()}.json`);
  try {
    writeFileSync(fileC, JSON.stringify(tamperedUnknownsState), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(fileC), InvariantViolationError);
  } finally {
    try { if (existsSync(fileC)) unlinkSync(fileC); } catch {}
  }

  // 8.6.d: Persisted top-level scope_deviations tampered -> load rejects with InvariantViolationError
  const tamperedDeviationsState = makeValidSavedState();
  tamperedDeviationsState.evidence[ref].scope_deviations = ["Diverged / fabricated deviations"];
  const fileD = join(tmpdir(), `tamper-dev-${Date.now()}.json`);
  try {
    writeFileSync(fileD, JSON.stringify(tamperedDeviationsState), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(fileD), InvariantViolationError);
  } finally {
    try { if (existsSync(fileD)) unlinkSync(fileD); } catch {}
  }

  // 8.6.e: Persisted top-level status tampered -> load rejects with InvariantViolationError
  const tamperedStatusState = makeValidSavedState();
  tamperedStatusState.evidence[ref].status = "IN_PROGRESS";
  const fileE = join(tmpdir(), `tamper-status-${Date.now()}.json`);
  try {
    writeFileSync(fileE, JSON.stringify(tamperedStatusState), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(fileE), InvariantViolationError);
  } finally {
    try { if (existsSync(fileE)) unlinkSync(fileE); } catch {}
  }

  // 8.6.f1: Persisted top-level milestone_id tampered -> load rejects with InvariantViolationError
  const tamperedMilestoneState = makeValidSavedState();
  tamperedMilestoneState.evidence[ref].payload.milestone_id = "M2"; // diverge payload from record
  const fileF1 = join(tmpdir(), `tamper-milestone-${Date.now()}.json`);
  try {
    writeFileSync(fileF1, JSON.stringify(tamperedMilestoneState), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(fileF1), InvariantViolationError);
  } finally {
    try { if (existsSync(fileF1)) unlinkSync(fileF1); } catch {}
  }

  // 8.6.f2: Persisted top-level plan_version tampered -> load rejects with InvariantViolationError
  const tamperedPlanVerState = makeValidSavedState();
  tamperedPlanVerState.evidence[ref].payload.plan_version = "v2"; // diverge payload from record
  const fileF2 = join(tmpdir(), `tamper-planver-${Date.now()}.json`);
  try {
    writeFileSync(fileF2, JSON.stringify(tamperedPlanVerState), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(fileF2), InvariantViolationError);
  } finally {
    try { if (existsSync(fileF2)) unlinkSync(fileF2); } catch {}
  }
});

runTest("8.7: Persistence save -> load roundtrip across all artifact_ref alias forms and rejection of tampered artifact binding", () => {
  const tmpFile = join(tmpdir(), `test-ledger-aliases-${Date.now()}.json`);

  try {
    // 8.7.a: artifact_ref only input -> save/load succeeds
    const ledgerA = new AuthoritativeLedger(samplePlan());
    ledgerA.delegate("M1");
    const candA = sampleCandidate({
      candidate_artifact_ref: undefined,
      artifact_ref: "scripts/runner.mjs",
    });
    const { result_ref: refA } = ledgerA.receiveCandidate(candA);
    ledgerA.recordZenGo(sampleVerdict({ result_ref: refA }));
    ledgerA.save(tmpFile);
    const loadedA = AuthoritativeLedger.load(tmpFile);
    assert.deepStrictEqual(loadedA.completed_milestones, ["M1"]);
    assert.strictEqual(loadedA.evidence[refA].candidate_artifact_ref, "scripts/runner.mjs");

    // 8.7.b: candidate_artifact_ref only input -> save/load succeeds
    const ledgerB = new AuthoritativeLedger(samplePlan());
    ledgerB.delegate("M1");
    const candB = sampleCandidate({
      candidate_artifact_ref: "scripts/runner.mjs",
      artifact_ref: undefined,
    });
    const { result_ref: refB } = ledgerB.receiveCandidate(candB);
    ledgerB.recordZenGo(sampleVerdict({ result_ref: refB }));
    ledgerB.save(tmpFile);
    const loadedB = AuthoritativeLedger.load(tmpFile);
    assert.deepStrictEqual(loadedB.completed_milestones, ["M1"]);
    assert.strictEqual(loadedB.evidence[refB].candidate_artifact_ref, "scripts/runner.mjs");

    // 8.7.c: Both aliases present with identical value -> save/load succeeds
    const ledgerC = new AuthoritativeLedger(samplePlan());
    ledgerC.delegate("M1");
    const candC = sampleCandidate({
      candidate_artifact_ref: "scripts/runner.mjs",
      artifact_ref: "scripts/runner.mjs",
    });
    const { result_ref: refC } = ledgerC.receiveCandidate(candC);
    ledgerC.recordZenGo(sampleVerdict({ result_ref: refC }));
    ledgerC.save(tmpFile);
    const loadedC = AuthoritativeLedger.load(tmpFile);
    assert.deepStrictEqual(loadedC.completed_milestones, ["M1"]);
    assert.strictEqual(loadedC.evidence[refC].candidate_artifact_ref, "scripts/runner.mjs");

    // Hashes must be 100% identical
    assert.strictEqual(refA, refB);
    assert.strictEqual(refB, refC);

    // 8.7.d: Both aliases present with different values -> rejects fail-closed
    const ledgerD = new AuthoritativeLedger(samplePlan());
    ledgerD.delegate("M1");
    const candD = sampleCandidate({
      candidate_artifact_ref: "scripts/runner.mjs",
      artifact_ref: "scripts/conflicting.mjs",
    });
    assert.throws(
      () => ledgerD.receiveCandidate(candD),
      (err) => err instanceof InvalidTransitionError || err instanceof InvariantViolationError
    );

    // 8.7.e: Tampered artifact binding after saving -> rejects fail-closed
    // Save valid state first
    ledgerA.save(tmpFile);
    const savedContent = JSON.parse(readFileSync(tmpFile, "utf-8"));
    // Tamper record artifact binding in file
    savedContent.evidence[refA].candidate_artifact_ref = "scripts/tampered_artifact.mjs";
    writeFileSync(tmpFile, JSON.stringify(savedContent, null, 2), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(tmpFile), InvariantViolationError);
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch {}
  }
});

runTest("8.8: fromJSON() and load() reject persisted candidate with non-DONE status (e.g. BLOCKED) even when record, payload, and recomputed result_ref all match", () => {
  function makeConsistentBlockedState(status = "BLOCKED") {
    const candidatePacket = {
      milestone_id: "M1",
      plan_version: "v1",
      status,
      candidate_artifact_ref: "scripts/runner.mjs",
      changes_made: ["Blocked task changes"],
      verification_evidence: ["Blocked reason documented"],
      unresolved_unknowns: [],
      scope_deviations: [],
    };
    const ref = generateResultRef(candidatePacket);
    const candRecord = {
      ...candidatePacket,
      result_ref: ref,
      timestamp: new Date().toISOString(),
      payload: { ...candidatePacket, result_ref: ref },
    };
    const verRecord = {
      milestone_id: "M1",
      plan_version: "v1",
      result_ref: ref,
      verdict: "GO",
      verification_evidence: ["Tests passed"],
      is_stale: false,
      timestamp: new Date().toISOString(),
      details: { verdict: "GO" },
    };
    return {
      goal: "Test Project",
      constraints: [],
      plan_version: "v1",
      milestones: [{ id: "M1", title: "M1", acceptance_criteria: ["Done"], dependencies: [] }],
      current_milestone: null,
      completed_milestones: ["M1"],
      evidence: {
        M1: { active_candidate: candRecord, candidates: [candRecord] },
        [ref]: candRecord,
      },
      verification: { M1: verRecord },
      blockers: [],
      decision_invariants: [],
      next_action: "Ready",
    };
  }

  // Completed milestone candidate with status="BLOCKED" (matching record, payload, and hash)
  const blockedState = makeConsistentBlockedState("BLOCKED");
  assert.throws(() => AuthoritativeLedger.fromJSON(blockedState), InvariantViolationError);

  const tmpFile = join(tmpdir(), `test-blocked-${Date.now()}.json`);
  try {
    writeFileSync(tmpFile, JSON.stringify(blockedState), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(tmpFile), InvariantViolationError);
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch {}
  }

  // Active candidate with status="BLOCKED" (matching record, payload, and hash)
  const activeBlocked = makeConsistentBlockedState("BLOCKED");
  const ref = activeBlocked.verification.M1.result_ref;
  activeBlocked.completed_milestones = [];
  activeBlocked.verification = {};
  activeBlocked.current_milestone = "M1";
  activeBlocked._active_candidates = { M1: activeBlocked.evidence[ref] };

  assert.throws(() => AuthoritativeLedger.fromJSON(activeBlocked), InvariantViolationError);

  // Status="IN_PROGRESS" and status="FAILED" also rejected
  assert.throws(() => AuthoritativeLedger.fromJSON(makeConsistentBlockedState("IN_PROGRESS")), InvariantViolationError);
  assert.throws(() => AuthoritativeLedger.fromJSON(makeConsistentBlockedState("FAILED")), InvariantViolationError);
});

runTest("8.9: fromJSON() and load() reject persisted candidate with empty verification_evidence even when record, payload, and recomputed result_ref all match", () => {
  function makeConsistentEvidenceState(evidenceValue) {
    const candidatePacket = {
      milestone_id: "M1",
      plan_version: "v1",
      status: "DONE",
      candidate_artifact_ref: "scripts/runner.mjs",
      changes_made: ["Changes done"],
      verification_evidence: evidenceValue,
      unresolved_unknowns: [],
      scope_deviations: [],
    };
    const ref = generateResultRef(candidatePacket);
    const candRecord = {
      ...candidatePacket,
      result_ref: ref,
      timestamp: new Date().toISOString(),
      payload: { ...candidatePacket, result_ref: ref },
    };
    const verRecord = {
      milestone_id: "M1",
      plan_version: "v1",
      result_ref: ref,
      verdict: "GO",
      verification_evidence: ["Tests passed"],
      is_stale: false,
      timestamp: new Date().toISOString(),
      details: { verdict: "GO" },
    };
    return {
      goal: "Test Project",
      constraints: [],
      plan_version: "v1",
      milestones: [{ id: "M1", title: "M1", acceptance_criteria: ["Done"], dependencies: [] }],
      current_milestone: null,
      completed_milestones: ["M1"],
      evidence: {
        M1: { active_candidate: candRecord, candidates: [candRecord] },
        [ref]: candRecord,
      },
      verification: { M1: verRecord },
      blockers: [],
      decision_invariants: [],
      next_action: "Ready",
    };
  }

  // 1. Empty array []
  const emptyArrState = makeConsistentEvidenceState([]);
  assert.throws(() => AuthoritativeLedger.fromJSON(emptyArrState), InvariantViolationError);

  const tmpFile = join(tmpdir(), `test-empty-ev-${Date.now()}.json`);
  try {
    writeFileSync(tmpFile, JSON.stringify(emptyArrState), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(tmpFile), InvariantViolationError);
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch {}
  }

  // 2. Empty string ""
  assert.throws(() => AuthoritativeLedger.fromJSON(makeConsistentEvidenceState("")), InvariantViolationError);

  // 3. Whitespace string "   "
  assert.throws(() => AuthoritativeLedger.fromJSON(makeConsistentEvidenceState("   \t\n")), InvariantViolationError);

  // 4. Array of empty strings [""]
  assert.throws(() => AuthoritativeLedger.fromJSON(makeConsistentEvidenceState([""])), InvariantViolationError);

  // 5. Array of whitespace strings ["  ", "\t"]
  assert.throws(() => AuthoritativeLedger.fromJSON(makeConsistentEvidenceState(["  ", "\t"])), InvariantViolationError);

  // 6. Array with null [null]
  assert.throws(() => AuthoritativeLedger.fromJSON(makeConsistentEvidenceState([null])), InvariantViolationError);
});

runTest("8.10: fromJSON() and load() reject persisted candidate with missing required field (changes_made, unresolved_unknowns, scope_deviations) even when recomputed hash matches", () => {
  function makePacketWithFields(omitField, invalidValue = undefined) {
    const candidatePacket = {
      milestone_id: "M1",
      plan_version: "v1",
      status: "DONE",
      candidate_artifact_ref: "scripts/runner.mjs",
      changes_made: ["Valid change"],
      verification_evidence: ["Valid evidence"],
      unresolved_unknowns: [],
      scope_deviations: [],
    };
    if (invalidValue !== undefined) {
      candidatePacket[omitField] = invalidValue;
    } else {
      delete candidatePacket[omitField];
    }
    const ref = generateResultRef(candidatePacket);
    const candRecord = {
      ...candidatePacket,
      result_ref: ref,
      timestamp: new Date().toISOString(),
      payload: { ...candidatePacket, result_ref: ref },
    };
    const verRecord = {
      milestone_id: "M1",
      plan_version: "v1",
      result_ref: ref,
      verdict: "GO",
      verification_evidence: ["Tests passed"],
      is_stale: false,
      timestamp: new Date().toISOString(),
      details: { verdict: "GO" },
    };
    return {
      goal: "Test Project",
      constraints: [],
      plan_version: "v1",
      milestones: [{ id: "M1", title: "M1", acceptance_criteria: ["Done"], dependencies: [] }],
      current_milestone: null,
      completed_milestones: ["M1"],
      evidence: {
        M1: { active_candidate: candRecord, candidates: [candRecord] },
        [ref]: candRecord,
      },
      verification: { M1: verRecord },
      blockers: [],
      decision_invariants: [],
      next_action: "Ready",
    };
  }

  const tmpFile = join(tmpdir(), `test-missing-fields-${Date.now()}.json`);
  try {
    // 1. Missing changes_made
    const missingChanges = makePacketWithFields("changes_made");
    assert.throws(() => AuthoritativeLedger.fromJSON(missingChanges), InvariantViolationError);
    writeFileSync(tmpFile, JSON.stringify(missingChanges), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(tmpFile), InvariantViolationError);

    // 2. Invalid type changes_made (number)
    const invalidChanges = makePacketWithFields("changes_made", 12345);
    assert.throws(() => AuthoritativeLedger.fromJSON(invalidChanges), InvariantViolationError);

    // 3. Missing unresolved_unknowns
    const missingUnknowns = makePacketWithFields("unresolved_unknowns");
    assert.throws(() => AuthoritativeLedger.fromJSON(missingUnknowns), InvariantViolationError);
    writeFileSync(tmpFile, JSON.stringify(missingUnknowns), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(tmpFile), InvariantViolationError);

    // 4. Invalid type unresolved_unknowns (boolean)
    const invalidUnknowns = makePacketWithFields("unresolved_unknowns", true);
    assert.throws(() => AuthoritativeLedger.fromJSON(invalidUnknowns), InvariantViolationError);

    // 5. Missing scope_deviations
    const missingDeviations = makePacketWithFields("scope_deviations");
    assert.throws(() => AuthoritativeLedger.fromJSON(missingDeviations), InvariantViolationError);
    writeFileSync(tmpFile, JSON.stringify(missingDeviations), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(tmpFile), InvariantViolationError);

    // 6. Invalid type scope_deviations (object)
    const invalidDeviations = makePacketWithFields("scope_deviations", { dev: "none" });
    assert.throws(() => AuthoritativeLedger.fromJSON(invalidDeviations), InvariantViolationError);
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch {}
  }
});

runTest("8.11: fromJSON() and load() reject completed milestone with Zen GO verification having empty, missing, or whitespace verification_evidence", () => {
  function makeCompletedWithZenEv(evidenceValue) {
    const candidatePacket = {
      milestone_id: "M1",
      plan_version: "v1",
      status: "DONE",
      candidate_artifact_ref: "scripts/runner.mjs",
      changes_made: ["Valid change"],
      verification_evidence: ["Valid evidence"],
      unresolved_unknowns: [],
      scope_deviations: [],
    };
    const ref = generateResultRef(candidatePacket);
    const candRecord = {
      ...candidatePacket,
      result_ref: ref,
      timestamp: new Date().toISOString(),
      payload: { ...candidatePacket, result_ref: ref },
    };
    const verRecord = {
      milestone_id: "M1",
      plan_version: "v1",
      result_ref: ref,
      verdict: "GO",
      verification_evidence: evidenceValue,
      is_stale: false,
      timestamp: new Date().toISOString(),
      details: { verdict: "GO" },
    };
    return {
      goal: "Test Project",
      constraints: [],
      plan_version: "v1",
      milestones: [{ id: "M1", title: "M1", acceptance_criteria: ["Done"], dependencies: [] }],
      current_milestone: null,
      completed_milestones: ["M1"],
      evidence: {
        M1: { active_candidate: candRecord, candidates: [candRecord] },
        [ref]: candRecord,
      },
      verification: { M1: verRecord },
      blockers: [],
      decision_invariants: [],
      next_action: "Ready",
    };
  }

  const tmpFile = join(tmpdir(), `test-zen-ev-${Date.now()}.json`);
  try {
    // 1. Empty array []
    const emptyArrState = makeCompletedWithZenEv([]);
    assert.throws(() => AuthoritativeLedger.fromJSON(emptyArrState), InvariantViolationError);
    writeFileSync(tmpFile, JSON.stringify(emptyArrState), "utf-8");
    assert.throws(() => AuthoritativeLedger.load(tmpFile), InvariantViolationError);

    // 2. Empty string ""
    assert.throws(() => AuthoritativeLedger.fromJSON(makeCompletedWithZenEv("")), InvariantViolationError);

    // 3. Whitespace string "   "
    assert.throws(() => AuthoritativeLedger.fromJSON(makeCompletedWithZenEv("   ")), InvariantViolationError);

    // 4. Missing / undefined
    assert.throws(() => AuthoritativeLedger.fromJSON(makeCompletedWithZenEv(undefined)), InvariantViolationError);

    // 5. Null
    assert.throws(() => AuthoritativeLedger.fromJSON(makeCompletedWithZenEv(null)), InvariantViolationError);

    // 6. Array of whitespace / null ["  ", null]
    assert.throws(() => AuthoritativeLedger.fromJSON(makeCompletedWithZenEv(["  ", null])), InvariantViolationError);
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch {}
  }
});

runTest("8.12: Persistence save -> load roundtrip happy path continues to succeed with full candidate and Zen GO semantic verification", () => {
  const tmpFile = join(tmpdir(), `test-happy-roundtrip-${Date.now()}.json`);
  try {
    const plan = samplePlan();
    const ledger = new AuthoritativeLedger(plan);

    // Complete M1
    ledger.delegate("M1");
    const cand1 = ledger.receiveCandidate(sampleCandidate({ milestone_id: "M1" }));
    ledger.recordZenGo(sampleVerdict({ milestone_id: "M1", result_ref: cand1.result_ref }));

    // Delegate M2 and receive candidate
    ledger.delegate("M2");
    const cand2 = ledger.receiveCandidate(
      sampleCandidate({
        milestone_id: "M2",
        candidate_artifact_ref: "scripts/ledger.mjs",
        changes_made: ["Added semantic validation helpers"],
        verification_evidence: ["test_ledger.mjs passed"],
      })
    );

    // Save and reload
    ledger.save(tmpFile);
    assert.ok(existsSync(tmpFile));

    const resumed = AuthoritativeLedger.load(tmpFile);
    assert.strictEqual(resumed.plan_version, "v1");
    assert.deepStrictEqual(resumed.completed_milestones, ["M1"]);
    assert.strictEqual(resumed.current_milestone, "M2");
    assert.strictEqual(resumed.evidence.M2.active_candidate.result_ref, cand2.result_ref);

    // Complete M2 on resumed instance
    resumed.recordZenGo(
      sampleVerdict({
        milestone_id: "M2",
        result_ref: cand2.result_ref,
        verification_evidence: ["Final verification passed"],
      })
    );

    assert.deepStrictEqual(resumed.completed_milestones, ["M1", "M2"]);
    const completion = resumed.declareGlobalCompletion();
    assert.strictEqual(completion.completed, true);

    // Save again and reload completed ledger
    resumed.save(tmpFile);
    const fullyCompleted = AuthoritativeLedger.load(tmpFile);
    assert.deepStrictEqual(fullyCompleted.completed_milestones, ["M1", "M2"]);
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch {}
  }
});

console.log("=========================================================");
console.log(`Summary: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);

if (failed > 0) {
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
