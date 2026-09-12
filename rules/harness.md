# Native Gravity Harness Invariants

This document specifies the implementation-neutral generic harness invariants for Native Gravity vNext. All roles, handoffs, and verification procedures must conform to these invariants.

## 1. Contract Fields

Every task delegation, milestone specification, and execution packet must define and enforce the following contract fields:

- `GOAL`: A clear, human-readable statement of what must be achieved. Must remain stable once set; changes require an explicit plan version increment.
- `SCOPE`: The bounded set of permitted files, directories, subsystems, or operations.
- `NON_GOALS`: Explicit exclusions and boundaries—anything outside scope that might seem related or tempting to touch.
- `ACCEPTANCE`: Objective, testable criteria that determine whether the goal is satisfied.
- `SOURCE_OF_TRUTH`: The authoritative sources and documents governing decisions. Substituting lower-authority sources, heuristics, or model judgment is strictly forbidden.
- `DECISION_RULE`: Explicit derivation procedures and logic governing decisions. All conclusions must remain traceable to permitted sources.
- `COVERAGE`: The complete enumerated set of required items, targets, or surfaces for exhaustive contracts.
- `COVERAGE_BASIS`: Independent evidence demonstrating that the coverage set is complete and comprehensive.
- `EVIDENCE`: Direct, verifiable inspection artifacts, command outputs, or test results.
- `EDIT_POLICY`: Governing mutation rules and restrictions for any file modifications.
- `EXPECTED_OUTPUT`: Required format, schema, and destination of handoff artifacts.

## 2. Source-of-Truth and Decision-Rule Discipline

All decisions, inferences, and actions must be strictly traceable to authorized sources of truth and explicit decision rules.
- Substituting lower-authority references, unverified assumptions, heuristics, or conversational memory is strictly prohibited.
- If an authoritative specification conflicts with legacy code or conversational context, the authoritative specification prevails.
- When an authoritative source does not specify a behavior, the item must be classified as `UNKNOWN` rather than guessed.

## 3. Evidence Boundaries

All claims, findings, and status reports must classify information into one of three strict categories:

- `OBSERVED`: Directly inspected in current artifacts, tool outputs, terminal executions, or authoritative context. Only observed facts may serve as verification evidence.
- `INFERRED`: Derived conclusions, deductions, or hypotheses. Inferred conclusions require independent empirical verification before taking consequential actions.
- `UNKNOWN`: Material information that has not been established or verified. Must be explicitly tracked, not assumed.

## 4. Authority and Scope Boundaries

Every agent must operate strictly within its assigned role authority and exposed tools.
- Never use unavailable authority indirectly (e.g., attempting actions via unauthorized subagents or side channels).
- Explicit non-goals and read-only boundaries are hard constraints; scope expansion without explicit authorization is forbidden.
- Local delegation readiness does not constitute milestone or project completion.

## 5. Mutation Effect Discipline

All operational effects are classified into three levels of mutation discipline:

- `READ_ONLY`: Inspection, discovery, and evidence gathering without modifying project files or system state.
- `REVERSIBLE`: Modifications that possess a clear, immediate, and practical undo or rollback path.
- `PERSISTENT_OR_DESTRUCTIVE`: Changes that permanently alter project state, history, or external systems. Requires exact identification, evidence-backed justification, and an explicit rollback procedure before execution.

## 6. Anti-Bypass Safeguards

When an effect, action, or command is blocked by policy or guard:
- It is strictly forbidden to bypass the block through equivalent mechanisms (e.g., using `tee`, temporary patch files, wrapper scripts, subshell recursion, environment unsetting, or programmatic inline interpreters).
- A block indicates a hard policy boundary; circumventing it constitutes a critical contract violation.

## 7. Coverage and Coverage Basis Closure

For exhaustive contracts:
- `COVERAGE`: The full scope of items or surfaces must be explicitly enumerated.
- `COVERAGE_BASIS`: Independent evidence proving why the enumerated set is exhaustive must be established.
- Completion cannot be claimed without closing both `COVERAGE` and its `COVERAGE_BASIS`. Partial subsets or unverified completeness block completion.

## 8. Actual-Result Verification

Verification requires inspecting the actual runtime result:
- Static configuration checks or assumption of success do not prove runtime behavior.
- Direct execution evidence, exit codes, and output inspections are required before claiming `PASS`.
- Verifications must be performed against the active plan version and current artifact state.

## 9. Blocker and Failure Semantics

A status of `BLOCKED` or invocation failure is permitted only when ALL FOUR of the following conditions hold:
1. **Verified Blocker:** The blocker is verified with observed evidence.
2. **Prevents Goal:** The blocker directly prevents achieving the assigned acceptance criteria.
3. **No Safe Remediation:** No safe, autonomous remediation remains within the agent's authorized scope.
4. **Hard Boundary:** Resolving the issue crosses a hard capability, safety, or authority boundary.

If safe remediation remains within scope, the agent must attempt repair before reporting `BLOCKED`.

## 10. Human Boundary

Do not hand work back to human operators merely because a human review or subsequent step may occur later. Continue all safe autonomous work up to the hard boundary.

## 11. Compact Handoff Discipline

All handoffs between agents must be compact, structured, and decision-relevant:
- Include only: result status, observed evidence, unresolved unknowns, material risks, and recommended next action.
- Reference stable IDs (e.g., milestone IDs, test IDs) rather than lossy paraphrase chains. Lossy paraphrasing silently drops constraints and non-goals.

## 12. Completion Authority and Gates

Completion authority is strictly role-gated and hierarchical:
- **Worker `READY` ≠ Milestone Complete:** Worker readiness is implementation-local and does not authorize milestone promotion.
- **Strix `ACCEPT` ≠ Milestone Complete:** Strix Halo review is local to Bobcat's implementation and does not establish milestone verification.
- **Bulldozer `DONE` ≠ Project Complete:** Bulldozer's `DONE` indicates candidate milestone readiness, not verified milestone completion and never global project completion.
- **Zen Verification Gate:** Required current Zen `GO` must be observed before any milestone is promoted to verified.
- **Plan Revision Invalidation:** A materially revised plan invalidates stale review authority. Stale Zen verdicts issued against prior plan versions must never authorize a new plan version.
- **Exclusive Global Completion:** Only Steamroller possesses the authority to declare global project completion.
