# Native Gravity Orchestration Contract

This document specifies the vNext orchestration architecture, role boundaries, ledger state machine, handoff contracts, and completion semantics for Native Gravity.

## 1. Target Orchestration Graph

### 1.1 Normal Execution Spine

```text
USER
  └─► STEAMROLLER  (3.8 Flash / High — long-horizon sentinel)
          │
          ├─► PILEDRIVER  (3.1 Pro / High — planner/architect/decision)
          │       [invoked when planning or difficult decision is needed]
          │
          └─► BULLDOZER  (3.8 Flash / High — milestone orchestrator)
                  │  [one bounded milestone at a time]
                  │
                  ├─► JAGUAR   (Flash — read-only factual retrieval)
                  ├─► PUMA     (Flash — quick/writing/mechanical)
                  └─► BOBCAT   (Flash — bounded implementation)
                          └─► STRIX HALO  (Pro — implementation advisor/gate)

[After each milestone]
  BULLDOZER ──candidate packet──► STEAMROLLER ──review request──► ZEN
  ZEN ──GO / NO-GO──► STEAMROLLER  (ledger update)
```

### 1.2 Core Topology Rules

- **Steamroller** is the sole top-level supervisor. It is not a specialist subordinate to Bulldozer.
- **Piledriver** is invoked exclusively by Steamroller when planning, material replanning, or high-impact architectural decisions are needed. Piledriver does not orchestrate workers.
- **Bulldozer** receives exactly one bounded milestone packet per invocation. It operates strictly within that assigned scope.
- **Zen** is an independent verification gate, not a child of Bulldozer. Its verdict is delivered directly to Steamroller.
- **Excavator** remains a separate primary agent during initial migration slices, serving as a failure diagnosis and recovery specialist when normal execution encounters repeated material failures.
- **Instinct** is a heterogeneous alternate-framing specialist (targeting Sonnet via the exact-model runner), reserved for post-P0 reconnection.

## 2. Role Ownership and Boundaries

### 2.1 Steamroller — Long-Horizon Sentinel & Supervisor
- **Model:** Gemini 3.8 Flash / High effort (via exact-model runner).
- **Owns:** Global goal and constraints, plan version, milestone graph, active milestone identity (`current_milestone`), authoritative project ledger, evidence and gate state, blocker state, next action, and global project completion.
- **Responsibilities:** Maintains the project ledger as the sole authoritative source of truth. Delegates one bounded milestone at a time to Bulldozer. Assigns immutable candidate `result_ref` upon receiving Bulldozer's candidate packet. Requests Zen review. Observes current Zen GO before promoting milestones. Declares global completion.
- **Hard Boundaries:** Does not implement project source code. Does not orchestrate specialist workers directly. Never relies on conversational memory as authoritative state. May not promote a milestone without an observed current Zen GO. Sole authority for global project completion.

### 2.2 Piledriver — Bounded Planner / Architect / Decision Specialist
- **Model:** Gemini 3.1 Pro / High effort (via exact-model runner).
- **Owns:** Initial plan and task graph, architecture and API decisions, acceptance and verification strategy, material replanning, high-impact trade-off resolution, and `NEEDS_DEEP` escalation resolution.
- **Responsibilities:** Produces complete, testable plans with explicit acceptance criteria and verification strategies. Resolves architectural ambiguities upon request from Steamroller. Formulates material replans when necessary.
- **Hard Boundaries:** Strictly no implementation. No project state ownership. No worker orchestration. No milestone or project completion claims. Output is advisory to Steamroller; Steamroller decides whether to adopt it.

### 2.3 Bulldozer — Bounded Milestone Orchestrator
- **Model:** Gemini 3.8 Flash / High effort (via exact-model runner).
- **Owns:** Execution within a single bounded milestone, delegation to Jaguar / Puma / Bobcat within that milestone, milestone-local repair loops, and candidate milestone result packet delivered to Steamroller.
- **Responsibilities:** Accepts exactly one milestone packet from Steamroller. Coordinates specialist workers. Conducts local repair loops. Gathers verification evidence. Delivers candidate result packet to Steamroller. Reports `NEEDS_DEEP` to Steamroller when architectural escalations arise.
- **Hard Boundaries:** Scope is strictly limited to the received milestone. Does not mutate the authoritative project ledger. Does not invoke Piledriver directly. Does not declare global project completion. `DONE` means candidate milestone criteria are satisfied—never global project complete (`DONE != project complete`). Fresh context per milestone is standard; conversational memory must not be assumed.

### 2.4 Jaguar — Read-Only Factual Retrieval
- **Model:** Native Flash tier.
- **Role:** Read-only codebase and context discovery. Delivers factual findings to Bulldozer.
- **Hard Boundaries:** No subagents. No file modifications. No implementation.

### 2.5 Puma — Quick / Writing / Mechanical Worker
- **Model:** Native Flash tier.
- **Role:** Small, explicit, low-risk text, writing, formatting, and configuration edits.
- **Hard Boundaries:** No advisor ceremony (no Strix Halo). No subagents. Keeps trivial edits out of the Bobcat → Strix Halo loop.

### 2.6 Bobcat — Bounded Implementation Worker
- **Model:** Native Flash tier.
- **Role:** Ordinary bounded project-source implementation.
- **Advisor Gate:** Subject to `ADVISOR_GATE: REQUIRED | NONE` set by Bulldozer. `REQUIRED` for substantive behavior, API, state, lifecycle, or test changes; `NONE` for low-risk mechanical work.
- **Hard Boundaries:** May invoke only Strix Halo. Cannot invoke peer workers (Jaguar, Puma).

### 2.7 Strix Halo — Implementation Advisor / Gate
- **Model:** Native Pro tier.
- **Role:** Read-only implementation advisor gate, invoked exclusively by Bobcat.
- **Verdict:** `ACCEPT | REVISE | NEEDS_DEEP`. Evaluates: *"Did Bobcat implement its bounded contract correctly?"*
- **Hard Boundaries:** Implementation-local authority only. Strix `ACCEPT` != milestone complete. Corrects through Bobcat, never instead of Bobcat. `NEEDS_DEEP` routes back through Bulldozer to Steamroller.

### 2.8 Zen — Independent Verification Gate
- **Model:** Native Pro tier (exact 3.1 Pro / High if validation shows material improvement).
- **Role:** Independent, non-mutating milestone verification. Must prefix shell commands with `NTG_ZEN_VERIFY=1`.
- **Verdict:** `GO | NO-GO`. Evaluates: *"Does the delivered milestone result actually satisfy the governing contract?"*
- **Hard Boundaries:** Independent gate reporting to Steamroller. Non-mutating only. Zen verdict is a mandatory hard completion gate; parent confidence or worker claims cannot substitute for an observed current Zen GO.

## 3. Authoritative Project Ledger

### 3.1 Principle
Conversational memory is ephemeral and non-authoritative. The project ledger is the single source of truth for long-horizon project state. A fresh Steamroller or Bulldozer context must be able to resume deterministically from the ledger without conversational history.

### 3.2 Minimum State Schema
```yaml
goal: ""                  # Human-readable overall project objective
constraints: []           # Hard constraints all milestones must satisfy
decision_invariants: []   # Settled architectural decisions {id, decision, source_ref, affects_milestones}
plan_version: ""          # Monotonically increasing identifier (e.g. "v1", "v2")
milestones: []            # Ordered descriptors {id, title, objective, acceptance_criteria, non_goals, dependencies}
current_milestone: ""     # ID of the single active milestone delegated to Bulldozer
completed_milestones: []  # Milestone IDs with verified Zen GO accepted by Steamroller
evidence: {}              # Keyed by milestone ID; persists {milestone_id, plan_version, result_ref, candidate_artifact_ref}
verification: {}          # Keyed by milestone ID; records Zen verdict (GO|NO-GO), plan_version, result_ref
blockers: []              # Active blockers {id, description, affects_milestone, escalation_path}
next_action: ""           # Steamroller's current intended next action
```

### 3.3 Valid Ledger Transitions
All ledger transitions are executed exclusively by Steamroller:
1. **Initialize / Adopt Initial Plan:** Record goal, constraints, plan_version, milestone graph, and decision invariants before delegation. Active and completed milestone lists start empty.
2. **Delegate / Retry:** Ensure no execution or review is active; select one incomplete milestone whose dependencies are met, set `current_milestone`, and issue the handoff packet.
3. **Receive Candidate:** Validate matching active milestone and plan version. Assign immutable `result_ref`, persist candidate record in `evidence`, keep `current_milestone` active, and request Zen review.
4. **BLOCKED / NEEDS_DEEP / Failure:** Record blockers or escalation needs, clear `current_milestone`, and do not promote the milestone.
5. **Zen NO-GO:** Record verdict and repair needs, clear `current_milestone`, leave milestone incomplete for bounded repair or replan.
6. **Zen GO / Promote:** Validate matching active milestone, current `plan_version`, and matching `result_ref`. Promote `milestone_id` to `completed_milestones`, update evidence, clear `current_milestone`, and update `next_action`.
7. **Material Replan:** End active execution/review, increment `plan_version`, mark all prior verdicts STALE, clear `completed_milestones` and `current_milestone`. Retained milestones must be re-verified under the new plan version.
8. **Resolve Blocker:** Remove blocker upon observed resolution evidence. Does not itself complete a milestone.
9. **Global Completion:** Permitted only when all milestones are completed with valid Zen GOs, no active blockers exist, plan versions match, evidence is directly observed, and `current_milestone` is empty.

## 4. Handoff Contracts

### 4.1 Steamroller → Bulldozer Packet
Delivered to Bulldozer for each milestone invocation:
- `milestone_id`: Stable identifier matching the ledger.
- `plan_version`: Current ledger plan version.
- `objective`: Clear, actionable statement of milestone goal.
- `bounded_scope`: Explicit permitted files, subsystems, or operations.
- `non_goals`: Explicit exclusions.
- `acceptance_criteria`: Objective, testable criteria for completion.
- `constraints`: Hard constraints inherited from ledger.
- `relevant_evidence`: OBSERVED facts relevant to this milestone.
- `decision_invariants`: Settled decision references relevant to this milestone.

### 4.2 Bulldozer → Steamroller Result Packet
Returned by Bulldozer upon completing milestone execution:
- `milestone_id`: Matching received milestone.
- `plan_version`: Plan version executed against.
- `status`: `DONE` | `BLOCKED` | `NEEDS_DEEP`.
- `changes_made`: Concrete list of files created/modified and artifacts produced.
- `verification_evidence`: OBSERVED evidence for each acceptance criterion.
- `unresolved_unknowns`: UNKNOWN or INFERRED items for Steamroller to track.
- `scope_deviations`: Explicit report of any scope deviations (must not be silently absorbed).
- `blockers`: Active blockers if status is `BLOCKED`.
- `escalation_needs`: Specific question/artifact for Piledriver if status is `NEEDS_DEEP`.

### 4.3 Zen Review Request & Verdict Packet
- **Request (Steamroller → Zen):** Contains governing contract, candidate result packet, and Steamroller-assigned immutable `result_ref`.
- **Verdict (Zen → Steamroller):** Contains `milestone_id`, `plan_version`, `result_ref` (must match candidate), `verdict` (`GO | NO-GO`), and `verification_evidence`.

## 5. Completion Semantics & Authority Rules

- **Deterministic Authority Constraints:**
  - Worker `READY` ≠ Milestone Complete.
  - Strix `ACCEPT` ≠ Milestone Complete.
  - Bulldozer `DONE` ≠ Project Complete.
  - Only Steamroller may declare global project completion.
  - Required current Zen `GO` must be observed before a milestone is verified.
  - Stale Zen verdicts issued against a prior plan version never authorize a new plan version.

- **Milestone Promotion Sequence:**
  1. Bulldozer reports `DONE` with complete result packet.
  2. Steamroller assigns unique `result_ref`, persists candidate snapshot in `evidence`, and requests Zen review.
  3. Zen issues current `GO` matching `plan_version` and `result_ref`.
  4. Steamroller observes the `GO` verdict.
  5. Steamroller updates ledger: moves `milestone_id` to `completed_milestones`, records verification, clears `current_milestone`, and sets `next_action`.

## 6. Migration and Non-Activation Preconditions

- 44D is a non-activated migration slice.
- AGENTS.md, plugin.json, hooks, hooks.json, and runtime wiring must NOT be modified in 44D.
- Agent frontmatter must not introduce changes that cause premature runtime activation before 44G.
- Full runtime activation and topology update occur together in slice 44G upon complete live validation.
