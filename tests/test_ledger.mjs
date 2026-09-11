import assert from "node:assert/strict";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
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
  const { result_ref } = ledger.receiveCandidate({
    milestone_id: "M1",
    plan_version: "v1",
    status: "DONE",
    changes_made: ["test"],
  });
  ledger.recordZenGo({
    milestone_id: "M1",
    plan_version: "v1",
    result_ref: result_ref,
    verdict: "GO",
  });

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

  const candidate = {
    milestone_id: "M1",
    plan_version: "v1",
    status: "DONE",
    changes_made: ["Created scripts/runner.mjs"],
    verification_evidence: ["test_runner_spike.mjs passed with 24/24"],
    candidate_artifact_ref: "scripts/runner.mjs",
  };

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

  const candidate1 = {
    milestone_id: "M1",
    plan_version: "v1",
    status: "DONE",
    changes_made: ["Original content"],
    candidate_artifact_ref: "artifact-1",
  };
  const { result_ref } = ledger.receiveCandidate(candidate1);

  // Attempting to submit different candidate content while claiming the prior result_ref
  const tamperedCandidate = {
    milestone_id: "M1",
    plan_version: "v1",
    status: "DONE",
    changes_made: ["Tampered / modified content"],
    candidate_artifact_ref: "artifact-1",
    result_ref: result_ref, // explicitly claiming mismatched ref
  };

  assert.throws(() => ledger.receiveCandidate(tamperedCandidate), RefRebindingError);
});

runTest("3.3: Candidate reception rejects mismatched milestone_id or stale plan_version", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  // Wrong milestone_id
  assert.throws(
    () =>
      ledger.receiveCandidate({
        milestone_id: "M2",
        plan_version: "v1",
        status: "DONE",
      }),
    InvalidTransitionError
  );

  // Stale plan_version
  assert.throws(
    () =>
      ledger.receiveCandidate({
        milestone_id: "M1",
        plan_version: "v0",
        status: "DONE",
      }),
    InvalidTransitionError
  );

  // Calling receiveCandidate when current_milestone is null
  const idleLedger = new AuthoritativeLedger(samplePlan());
  assert.throws(
    () =>
      idleLedger.receiveCandidate({
        milestone_id: "M1",
        plan_version: "v1",
        status: "DONE",
      }),
    InvalidTransitionError
  );
});

runTest("3.4: Candidate reception rejects packets with missing or non-DONE status, preventing Zen GO promotion", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  // Missing status
  assert.throws(
    () =>
      ledger.receiveCandidate({
        milestone_id: "M1",
        plan_version: "v1",
      }),
    InvalidTransitionError
  );

  // Empty status
  assert.throws(
    () =>
      ledger.receiveCandidate({
        milestone_id: "M1",
        plan_version: "v1",
        status: "",
      }),
    InvalidTransitionError
  );

  // BLOCKED status
  assert.throws(
    () =>
      ledger.receiveCandidate({
        milestone_id: "M1",
        plan_version: "v1",
        status: "BLOCKED",
      }),
    InvalidTransitionError
  );

  // NEEDS_DEEP status
  assert.throws(
    () =>
      ledger.receiveCandidate({
        milestone_id: "M1",
        plan_version: "v1",
        status: "NEEDS_DEEP",
      }),
    InvalidTransitionError
  );

  // Arbitrary non-DONE status
  assert.throws(
    () =>
      ledger.receiveCandidate({
        milestone_id: "M1",
        plan_version: "v1",
        status: "IN_PROGRESS",
      }),
    InvalidTransitionError
  );

  // Verify candidate was NOT recorded in active_candidates or evidence
  assert.strictEqual(ledger._active_candidates.M1, undefined);
  assert.strictEqual(ledger.evidence.M1, undefined);

  // Zen GO promotion is impossible without active candidate
  assert.throws(
    () =>
      ledger.recordZenGo({
        milestone_id: "M1",
        plan_version: "v1",
        result_ref: "ref-sha256-nonexistent",
        verdict: "GO",
      }),
    InvalidTransitionError
  );

  // Milestone is still active and can receive a valid DONE candidate
  const { result_ref } = ledger.receiveCandidate({
    milestone_id: "M1",
    plan_version: "v1",
    status: "DONE",
  });
  const verdict = ledger.recordZenGo({
    milestone_id: "M1",
    plan_version: "v1",
    result_ref: result_ref,
    verdict: "GO",
  });
  assert.strictEqual(verdict.verdict, "GO");
  assert.deepStrictEqual(ledger.completed_milestones, ["M1"]);
});

// =============================================================================
// Section 4: Zen Review & Milestone Promotion
// =============================================================================

runTest("4.1: Zen GO verifies and promotes milestone, clears current_milestone, and updates next_action", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  const { result_ref } = ledger.receiveCandidate({
    milestone_id: "M1",
    plan_version: "v1",
    status: "DONE",
    changes_made: ["files created"],
  });

  const verdictRecord = ledger.recordZenGo({
    milestone_id: "M1",
    plan_version: "v1",
    result_ref: result_ref,
    verdict: "GO",
    verification_evidence: ["Verified all tests pass"],
  });

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

  const { result_ref } = ledger.receiveCandidate({
    milestone_id: "M1",
    plan_version: "v1",
    status: "DONE",
    changes_made: ["flawed implementation"],
  });

  const verdict = ledger.recordZenNoGo({
    milestone_id: "M1",
    plan_version: "v1",
    result_ref: result_ref,
    verdict: "NO-GO",
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

  ledger.receiveCandidate({
    milestone_id: "M1",
    plan_version: "v1",
    status: "DONE",
  });

  assert.throws(
    () =>
      ledger.recordZenGo({
        milestone_id: "M1",
        plan_version: "v1",
        result_ref: "ref-sha256-wrong-ref-123456",
        verdict: "GO",
      }),
    MismatchedResultRefError
  );

  assert.throws(
    () =>
      ledger.recordZenNoGo({
        milestone_id: "M1",
        plan_version: "v1",
        result_ref: "ref-sha256-wrong-ref-123456",
        verdict: "NO-GO",
      }),
    MismatchedResultRefError
  );
});

runTest("4.4: Zen verdict rejects stale plan_version (StaleVerdictError)", () => {
  const ledger = new AuthoritativeLedger(samplePlan());
  ledger.delegate("M1");

  const { result_ref } = ledger.receiveCandidate({
    milestone_id: "M1",
    plan_version: "v1",
    status: "DONE",
  });

  assert.throws(
    () =>
      ledger.recordZenGo({
        milestone_id: "M1",
        plan_version: "v0", // stale version
        result_ref: result_ref,
        verdict: "GO",
      }),
    StaleVerdictError
  );
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
  const { result_ref } = ledger.receiveCandidate({
    milestone_id: "M1",
    plan_version: "v1",
    status: "DONE",
  });
  ledger.recordZenGo({
    milestone_id: "M1",
    plan_version: "v1",
    result_ref: result_ref,
    verdict: "GO",
  });

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
  const v2Cand = ledger.receiveCandidate({
    milestone_id: "M1",
    plan_version: "v2",
    status: "DONE",
  });
  ledger.recordZenGo({
    milestone_id: "M1",
    plan_version: "v2",
    result_ref: v2Cand.result_ref,
    verdict: "GO",
  });

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
  ledger.receiveCandidate({
    milestone_id: "M1",
    plan_version: "v1",
    status: "DONE",
  });
  assert.throws(
    () =>
      ledger.materialReplan({
        milestones: [{ id: "M1", title: "M1" }],
      }),
    InvalidTransitionError
  );

  // Transition to inactive (e.g. via Zen NO-GO)
  ledger.recordZenNoGo({
    milestone_id: "M1",
    plan_version: "v1",
    result_ref: ledger._active_candidates.M1.result_ref,
    verdict: "NO-GO",
  });
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

// =============================================================================
// Section 7: Global Completion Enforcements
// =============================================================================

runTest("7.1: Global completion strictly enforces all acceptance criteria", () => {
  const ledger = new AuthoritativeLedger(samplePlan());

  // 1. Cannot complete on unstarted project
  assert.throws(() => ledger.declareGlobalCompletion(), InvariantViolationError);

  // 2. Complete M1
  ledger.delegate("M1");
  const cand1 = ledger.receiveCandidate({ milestone_id: "M1", plan_version: "v1", status: "DONE" });
  ledger.recordZenGo({ milestone_id: "M1", plan_version: "v1", result_ref: cand1.result_ref, verdict: "GO" });

  // Cannot complete with M2 still incomplete
  assert.throws(() => ledger.declareGlobalCompletion(), InvariantViolationError);

  // 3. Delegate M2
  ledger.delegate("M2");
  // Cannot complete while milestone is active
  assert.throws(() => ledger.declareGlobalCompletion(), InvariantViolationError);

  const cand2 = ledger.receiveCandidate({ milestone_id: "M2", plan_version: "v1", status: "DONE" });
  ledger.recordZenGo({ milestone_id: "M2", plan_version: "v1", result_ref: cand2.result_ref, verdict: "GO" });

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
    const cand1 = originalLedger.receiveCandidate({ milestone_id: "M1", plan_version: "v1", status: "DONE" });
    originalLedger.recordZenGo({ milestone_id: "M1", plan_version: "v1", result_ref: cand1.result_ref, verdict: "GO" });

    // Delegate M2 and receive candidate, then simulate context break / restart
    originalLedger.delegate("M2");
    const cand2 = originalLedger.receiveCandidate({
      milestone_id: "M2",
      plan_version: "v1",
      status: "DONE",
      candidate_artifact_ref: "scripts/ledger.mjs",
      changes_made: ["Implemented AuthoritativeLedger"],
    });

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
    resumedLedger.recordZenGo({
      milestone_id: "M2",
      plan_version: "v1",
      result_ref: cand2.result_ref,
      verdict: "GO",
      verification_evidence: ["test_ledger.mjs passed"],
    });

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

console.log("=========================================================");
console.log(`Summary: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);

if (failed > 0) {
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
