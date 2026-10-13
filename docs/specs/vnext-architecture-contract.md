# Native Gravity vNext Architecture Contract

> **Status:** Canonical vNext specification — issue #44A
> **Branch:** `docs/issue-44-architecture-contract`

This document is the canonical Native Gravity vNext architecture contract. It was the clean implementation contract for the issue #44 implementation slices (44B–44G) and is the specification of record for the released vNext runtime.

All vNext agent prompts, rules, hooks, and runtime code are authored independently from this vNext architecture contract.

**Prohibited drafting sources:** legacy NTG implementation surfaces, abandoned rewrite branches (`feat/clean-rewrite-issue-33`, `feat/clean-rewrite-issue-33-v2`), PR #41, and any external OMO/GJC/OMP source text. This document does not perform any rewrite; it only specifies the target.

---

## Table of Contents

1. [Target Orchestration Graph](#1-target-orchestration-graph)
2. [Role Ownership](#2-role-ownership)
3. [Authoritative Project Ledger](#3-authoritative-project-ledger)
4. [Handoff Contracts](#4-handoff-contracts)
5. [Completion Semantics](#5-completion-semantics)
6. [Exact-Model / Effort Invocation Boundary](#6-exact-model--effort-invocation-boundary)
7. [Preserved Invariants and Activation](#7-preserved-invariants-and-activation)
8. [Implementation Sequence](#8-implementation-sequence)
9. [Open Questions / Spec Gaps](#9-open-questions--spec-gaps)

---

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
                  ├─► BOBCAT   (Flash — bounded implementation)
                  │      └─► STRIX HALO  (Pro — implementation advisor/gate)
                  └─► EXCAVATOR (Pro — difficult diagnosis/repair)

[After each milestone]
  BULLDOZER ──candidate packet──► STEAMROLLER ──review request──► ZEN
  ZEN ──GO / NO-GO──► STEAMROLLER  (ledger update)
```

**Key topology rules:**

- Steamroller is the sole top-level supervisor. It is not a specialist subordinate to Bulldozer.
- Piledriver is invoked by Steamroller when planning, replanning, or a high-impact architectural decision is needed. Piledriver does not orchestrate workers.
- Bulldozer receives exactly one milestone packet per invocation. It operates within that bounded scope only.
- Zen is an independent gate, not a child of Bulldozer. Its verdict is delivered to Steamroller.
- Excavator is a Bulldozer worker for difficult diagnosis/repair inside one milestone — see §2.9 and §7.
- Instinct is implemented as the runner-only NEEDS_ALT advisory (#20) — see §2.10.

### 1.2 Failure / Recovery Path (post-P0)

```text
Normal execution → material failure
  └─► EXCAVATOR  (failure diagnosis / recovery specialist)
          │
          ├─► success → return result
          └─► stalled repeated failure (same class, no new evidence)
                  └─► NEEDS_ALT → INSTINCT  (Sonnet via exact-model runner, #20)
```

Excavator runs this path as a Bulldozer worker inside the delegated milestone (owner decision; §2.9). Instinct is connected to the validated runner in #20.

---

## 2. Role Ownership

### 2.1 Steamroller — Long-Horizon Sentinel

**Model target:** Gemini 3.8 Flash / High effort (via exact-model runner — §6)

**Owns:**
- Global goal and constraints
- Plan version
- Milestone graph and active milestone identity
- Authoritative project ledger (§3)
- Evidence/gate state
- Blocker state
- Next action
- Global project completion

**Responsibilities:**
- Maintain the project ledger as the authoritative source of truth (not conversational memory)
- Hand one bounded milestone at a time to Bulldozer via a structured packet (§4.1)
- Decide when to invoke Piledriver for planning, replanning, or difficult decisions
- Consume candidate milestone result packets from Bulldozer and independently delivered Zen verdicts (§4.2)
- Observe current Zen GO before promoting a milestone to verified
- Update the ledger after each verified milestone
- Declare global project completion — this authority belongs exclusively to Steamroller

**Hard boundaries:**
- Does not implement project source
- Does not orchestrate specialist workers directly (delegates that authority to Bulldozer)
- Does not rely on conversational memory as the authoritative project state
- May not declare a milestone verified without observing the current Zen verdict when review is required

**Only Steamroller may declare global project completion.**

### 2.2 Piledriver — Bounded Planner / Architect / Decision Specialist

**Model target:** Gemini 3.1 Pro / High effort (via exact-model runner — §6)

**Owns:**
- Initial plan and task graph
- Architecture and API decisions
- Acceptance and verification strategy
- Material replanning
- High-impact trade-off resolution
- `NEEDS_DEEP` escalation path

**Responsibilities:**
- Produce a complete, testable plan with explicit acceptance criteria and verification strategy
- Resolve architectural ambiguities and high-impact decisions on request from Steamroller
- Issue a material replan when the current plan cannot accommodate observed reality

**Hard boundaries:**
- No implementation
- No project state ownership
- No worker orchestration
- No completion claims of any kind (neither milestone nor project)
- Piledriver output is advisory to Steamroller; Steamroller decides whether to adopt it
- Planning visibility is bounded to the tier-B `replan_context` projection (§4.3); prompt text, role text, and contract fragments (tier C) are never part of its packet

**Rationale:** Gemini 3.1 Pro's planning and architecture intelligence is valuable precisely because it is used narrowly. When left as a long-running executor it tends to take implementation ownership. Piledriver's bounded authority prevents that drift.

### 2.3 Bulldozer — Bounded Milestone Orchestrator

**Model target:** Gemini 3.8 Flash / High effort (via exact-model runner — §6)

**Owns:**
- Execution within a single bounded milestone
- Delegation to Jaguar / Puma / Bobcat within that milestone
- Repair loops inside the milestone scope
- Milestone result packet delivered to Steamroller

**Responsibilities:**
- Accept exactly one milestone packet from Steamroller
- Inspect and delegate bounded work to appropriate specialists
- Drive internal repair loops within the milestone boundary
- Gather verification evidence
- Return a complete milestone result packet to Steamroller (§4.2)
- Escalate `NEEDS_DEEP` to Steamroller for routing to Piledriver (not directly)

**Hard boundaries:**
- Scope is limited to the received milestone — Bulldozer must not expand scope unilaterally
- `DONE` means the milestone is complete — never global project complete
- Bulldozer does not update the authoritative project ledger — that is Steamroller's responsibility
- Bulldozer does not declare global project completion
- A fresh Bulldozer context per milestone is desirable; prior conversational state must not be assumed available

**Bulldozer `DONE` != project complete.**

### 2.4 Jaguar — Read-Only Factual Retrieval

**Model:** native Flash tier

**vNext invariant.**

- Read-only codebase and context discovery
- No subagent delegation
- No implementation
- Delivers factual findings to Bulldozer

### 2.5 Puma — Quick / Writing / Mechanical Worker

**Model:** native Flash tier

**vNext invariant.**

- Small, explicit, low-risk writing, formatting, and mechanical text/config edits
- No advisor ceremony (no Strix Halo)
- No subagent delegation
- Keeps trivial work out of the Bobcat → Strix Halo loop

### 2.6 Bobcat — Bounded Implementation Worker

**Model:** native Flash tier

**vNext invariant.**

- Ordinary bounded project-source implementation
- Subject to `ADVISOR_GATE: REQUIRED | NONE` set by Bulldozer
- May invoke only Strix Halo
- `ADVISOR_GATE: REQUIRED` for substantive code/behavior/API/state/lifecycle/test work
- `ADVISOR_GATE: NONE` for clearly low-risk mechanical work

### 2.7 Strix Halo — Implementation Advisor / Gate

**Model:** native Pro tier

**vNext invariant.**

- Read-only advisor gate, invoked by Bobcat only
- Verdict: `ACCEPT | REVISE | NEEDS_DEEP`
- Scope question: *"Did Bobcat implement its bounded contract correctly?"*
- Corrects through Bobcat, never instead of Bobcat
- `NEEDS_DEEP` routes back through Bulldozer to Piledriver (not directly to Piledriver)

**Strix `ACCEPT` != milestone complete.** Strix Halo authority is implementation-local.

### 2.8 Zen — Independent Verification Gate

**Model:** native Pro tier (exact 3.1P/High only if live validation shows material improvement)

**vNext invariant.**

- Independent, non-mutating verification
- Must prefix all verification shell commands with `NTG_ZEN_VERIFY=1`
- Verdict: `GO | NO-GO`
- Scope question: *"Does the delivered milestone/task result actually satisfy the governing contract?"*
- Zen verdict is a hard completion gate — parent confidence or worker `READY` must not substitute for the observed current verdict when review is required
- Stale Zen verdicts (issued against a prior plan version) do not authorize the current plan version

**Required current Zen `GO` must be observed before a milestone becomes verified.**

### 2.9 Excavator — Diagnosis / Repair Worker under Bulldozer

**vNext invariant:** the existing shell guard machinery is preserved. Excavator is a Bulldozer worker, not a primary (owner decision; OQ-3 resolved).

**What is decided:**
- Excavator is a specialist worker that only Bulldozer invokes, for difficult work inside one milestone: diagnose -> reproduce -> root-cause -> repair -> verify
- It is NOT a natively selectable primary; no natively selectable primary remains and the entry is `ntg-vnext`
- It has no nested delegation and never invokes Zen — Zen is Steamroller's independent milestone gate
- It returns a worker result (ROOT_CAUSE `CONFIRMED | LIKELY | SPECULATIVE`, CHANGES, VERIFICATION_EVIDENCE, ROLLBACK, RESIDUAL_RISK, STATUS `READY | BLOCKED`) to Bulldozer; STATUS is a local signal like other workers'
- The former native-primary Zen completion gate (plugin `Stop` hook) is removed with the primary
- It is NOT assumed to be a "deep autonomous investigator" — do not assume Gemini 3.1 Pro reproduces Hephaestus-style behavior merely from a prompt
- Existing shell guard (`NTG_EXCAVATOR=1` prefix, privilege-drift prevention, broad-upgrade prevention) is preserved until a validated replacement is specified

**Working escalation policy (post-P0 connection):**

```text
same materially-similar failure class ≥ 3 attempts
AND no meaningful new evidence or causal-model progress
    → NEEDS_ALT → Instinct
```

This is not a raw retry count. Track failure class/signature, current hypothesis, attempt count within that class, and whether meaningful new evidence appeared.

**RESOLVED (owner decision; OQ-3):** Excavator's authority and placement are fixed as a Bulldozer worker for hard diagnosis/repair on native Pro, with no nested delegation and no Zen invocation. #137's `inheritCustomizations: true` decision applied to the former native primary and is superseded by the demotion; workers carry no `inheritCustomizations` field. Continue validating behavior against real AGY failure cases inside the worker role. Do not invent from role aesthetics.

### 2.10 Instinct — Alternate-Framing Specialist (#20)

Instinct is the heterogeneous alternate-framing specialist, targeting Claude Sonnet 5.5 / High via the exact-model AGY invocation path, with Claude Opus 5.5 / High only on explicit escalation.

**Purpose:** Challenge the current framing when Gemini-led paths have over-converged. Not a ritual review step. Advisory only: no implementation, worker orchestration, ledger writes, plan adoption or completion/verdict claims. Its output is recorded as advisory evidence (`adopted: false`); Steamroller decides whether to act.

**Trigger conditions:**
- Stalled same-class failures meeting the escalation threshold in §2.9
- Multiple same-family agents converging on the same unsuccessful framing
- Evidence that the current problem model cannot explain observed behavior
- Explicit request for a heterogeneous alternate perspective

The runner invokes Instinct with a bounded NEEDS_ALT packet (failure class/signature, current hypothesis, attempt count, evidence, tier-B replan context) and receives one bare JSON object: current framing, why it may be wrong, materially different hypotheses (each with an OBSERVED / INFERRED / UNKNOWN evidence basis and a discriminating test), recommendation and unknowns.

**RESOLVED (#20, OQ-4):** The exact-model runner validates the Sonnet invocation path; Instinct is a runner role with the same fail-closed slug resolution as Piledriver and Bulldozer.

---

## 3. Authoritative Project Ledger

### 3.1 Purpose

Steamroller's conversational memory is not authoritative. The project ledger is the single source of truth for long-horizon project state. A fresh Steamroller or Bulldozer context must be able to resume from the ledger without reconstructing state from conversational history.

### 3.2 Minimum State Contract

```yaml
# Native Gravity vNext — Project Ledger (minimum schema)

goal: |
  # Human-readable statement of the project's overall objective.
  # Must be stable once set; changes require a new plan_version.

constraints: []
  # List of hard constraints that all milestones and plans must satisfy.
  # Examples: provenance rules, prohibited sources, scope limits.

decision_invariants: []
  # Settled architectural decisions adopted by Steamroller.
  # Each entry: { id, decision, source_ref, affects_milestones }
  # Material changes require a new plan_version.

plan_version: ""
  # Monotonically increasing identifier (e.g. "v1", "v2").
  # A material replan increments this value.
  # Stale Zen verdicts issued against a prior plan_version are invalid.

milestones: []
  # Ordered list of milestone descriptors.
  # Each entry: { id, title, objective, acceptance_criteria, non_goals, dependencies }

current_milestone: ""
  # ID of the active milestone currently delegated to Bulldozer.
  # Exactly one milestone is active at a time.

completed_milestones: []
  # List of milestone IDs that have received a current Zen GO
  # and been accepted by Steamroller.

evidence: {}
  # Keyed by milestone ID or global key.
  # Records OBSERVED facts, artifact locations, tool outputs.
  # Candidate records persist { milestone_id, plan_version, result_ref,
  # candidate_artifact_ref }; result_ref is assigned by Steamroller (§4.2).
  # Classify entries as OBSERVED | INFERRED | UNKNOWN.
  # Failure records carry tier-B telemetry ({ status, evidence, failed_step })
  # with the §4.3 redaction list applied at the record boundary.

verification: {}
  # Keyed by milestone ID.
  # Records Zen verdict (GO | NO-GO), verdict timestamp/context,
  # and the plan_version and result_ref the verdict was issued against.
  # result_ref must match the persisted candidate record for that milestone.
  # A verdict issued against a prior plan_version is marked STALE.

blockers: []
  # Active blockers preventing forward progress.
  # Each entry: { id, description, affects_milestone, escalation_path }

next_action: ""
  # Steamroller's current intended next step.
  # Updated after each ledger transition.
```

### 3.3 Ledger Invariants

- Only Steamroller may write authoritative ledger state, including initialization and pre-completion transitions.
- Bulldozer does not write to the ledger — it returns a result packet.
- `current_milestone` is set to exactly one milestone ID while Bulldozer is active.
- A `verification` entry is only marked valid when `plan_version` matches the current ledger `plan_version`.
- A material replan follows the invalidation and revalidation rules in §5.2.
- `completed_milestones` must not include a milestone ID until Steamroller has observed a valid (non-stale) Zen GO for it.

### 3.4 Scope Constraint

Do not expand the ledger schema into a broad workflow platform. This is a minimum, not a ceiling: 44C may add narrowly justified fields needed to enforce this contract and resume from fresh contexts. Persistence representation remains an implementation decision; it must not change role authority or completion semantics.

### 3.5 Valid Ledger Transitions

All transitions are performed by Steamroller and update `next_action`.

| Transition | Preconditions and effects |
|---|---|
| Initialize / adopt initial plan | Record goal, constraints, plan version, milestone graph and decision invariants before delegation; active and completed milestone state starts empty |
| Delegate / retry | No executor or review is active; select one incomplete milestone whose dependencies are completed, set `current_milestone` before invocation, and issue the current-version packet |
| Receive candidate | Require matching active milestone and plan version; Steamroller assigns and persists `result_ref` with the immutable candidate record in `evidence` before requesting Zen review (§4.2), and keeps the milestone active while Zen reviews |
| BLOCKED / NEEDS_DEEP / invocation failure | Record evidence, blockers or escalation needs; end the invocation and clear `current_milestone`; do not promote the milestone |
| Zen NO-GO | Record the matching verdict and repair needs, clear `current_milestone`, leave the milestone incomplete for bounded repair or replan |
| Zen GO / promote | Require matching active milestone, current plan version and candidate result reference; observe evidence and verdict, then apply §5.3 |
| Material replan | End active execution/review before adopting the new plan; apply §5.2 and reject subsequent old-version packets as transition authority |
| Resolve blocker | Remove a blocker only on observed resolution evidence; this does not itself complete a milestone |

An empty `current_milestone` means no execution or review is active. Duplicate or mismatched packets do not authorize transitions. Global completion additionally requires §5.4 and an empty `current_milestone`.

---

## 4. Handoff Contracts

### 4.1 Steamroller → Bulldozer Packet

The Steamroller-to-Bulldozer packet must include at minimum:

| Field | Description |
|---|---|
| `milestone_id` | Stable identifier matching the ledger entry |
| `plan_version` | Current ledger plan version (Bulldozer must not act on a stale version) |
| `objective` | Clear, actionable statement of what this milestone must accomplish |
| `bounded_scope` | Explicit list of permitted files, subsystems, or operations |
| `non_goals` | Explicit exclusions — anything not in scope that might seem related |
| `acceptance_criteria` | Objective, testable criteria that constitute milestone completion |
| `constraints` | Hard constraints inherited from the project ledger |
| `relevant_evidence` | OBSERVED facts from the ledger relevant to this milestone |
| `decision_invariants` | Relevant settled decisions from ledger `decision_invariants`, by stable ID/reference or exact value; not unresolved questions |

**Preference:** Reference stable milestone IDs and acceptance criteria rather than paraphrasing the governing contract at each handoff. Lossy paraphrase chains silently drop non-goals and constraints.

### 4.2 Bulldozer → Steamroller Result Packet

The Bulldozer-to-Steamroller result packet must include at minimum:

| Field | Description |
|---|---|
| `milestone_id` | Matching the received packet |
| `plan_version` | Plan version the work was executed against |
| `status` | `DONE` (all acceptance criteria met) \| `BLOCKED` (genuine blocker) \| `NEEDS_DEEP` (requires Piledriver) |
| `changes_made` | Concrete list of changes: files created/modified, state transitions, artifacts produced |
| `verification_evidence` | OBSERVED evidence for each acceptance criterion |
| `unresolved_unknowns` | UNKNOWN or INFERRED items that Steamroller must track |
| `scope_deviations` | Any deviation from the bounded scope — must be explicit, not silently absorbed |
| `blockers` | Active blockers preventing `DONE`, if status is `BLOCKED` |
| `escalation_needs` | Specific question or artifact to route to Piledriver if status is `NEEDS_DEEP` |

**NEEDS_DEEP routing:** Bulldozer reports `NEEDS_DEEP` to Steamroller. Steamroller decides whether to invoke Piledriver and what packet to send. Bulldozer does not invoke Piledriver directly.

This is a pre-review candidate packet: `DONE` is Bulldozer's claim that acceptance criteria are met, not verified completion. Zen is mandatory for every P0 milestone; there is no `NOT_REQUIRED` path. Steamroller invokes Zen with this packet and the authoritative milestone contract. Zen returns a separate packet to Steamroller containing `milestone_id`, `plan_version`, `result_ref` (the immutable candidate artifact reference), `verdict` (`GO | NO-GO`), and `verification_evidence`. Steamroller associates that observed verdict with the candidate result; Bulldozer does not author or relay Zen authority. The accepted combined record contains the current Zen verdict.

Steamroller is the sole issuer of `result_ref`: on `Receive candidate`, it assigns a unique reference to the immutable candidate packet and the delivered artifact versions that packet identifies, and persists the binding in ledger `evidence` before invoking Zen. The review request includes that same `result_ref`, which Zen must return unchanged. Steamroller persists it with the verdict in `verification` and rejects a verdict whose milestone, plan version or result reference does not match the candidate under review. Changed candidates require a new reference and review; references must not be rebound to changed contents. The physical ID/hash format and artifact storage layout remain implementation decisions for 44C/44E.

### 4.3 Steamroller → Piledriver Planning Packet

Steamroller invokes Piledriver for planning, replanning, and `NEEDS_DEEP` decisions with a bounded packet: the planning task plus a `replan_context` projection of authoritative ledger state. Piledriver never receives the raw ledger. The projection is fixed at **visibility tier B** (PO decision #114, 2026-10-10).

**Visibility tiers (policy):**

| Tier | Contents | Status |
|---|---|---|
| A | Failed artifact/lane id + failure class | Below selected floor |
| **B** | Tier A + the failed step's tool name and args / command line | **Selected (#114)** |
| C | Tier B + prompt text, role text, and contract fragments | **Not selected — must never be emitted** |

`replan_context` carries `telemetry_tier: "B"` plus the ledger fields a planner needs (`goal`, `constraints`, `plan_version`, milestone graph, active/completed milestones, `blockers`, `decision_invariants`, `next_action`) and two projections:

- `failure_telemetry[milestone_id][]` — `{ milestone_id, status, timestamp, escalation_needs?, failed_step?, transcript_ref? }` where `failed_step` is `{ tool, args, command? }` at argument granularity:
  - `runner.invoke` — `args: { role, slug?, error? }`; `command` records the agy command line with the `--print` value always `(prompt withheld)`
  - `invoke_subagent` — `args: { role, caller, slice_keys }`; delegated slice content is prompt material and never enters telemetry
  - `zen_review` — `args: { milestone_id, plan_version, result_ref }`
- `verification_summary[milestone_id]` — `{ verdict, plan_version, result_ref, is_stale, repair_needs, timestamp }`; never the raw verdict packet (`details`)

**Stays hidden (tier C):** the raw worker candidate packet (candidate records, `changes_made`, `verification_evidence`, `unresolved_unknowns`), the Zen verdict `details` blob, error message blobs (the `transcript_ref` pointer is kept; full transcript content stays in the authoritative ledger), role bodies, and composed prompts including any `--print` value.

**Redaction list** — applied at the ledger record boundary and again in the projection (`scripts/telemetry.mjs` is the single implementation):

- Secret-bearing env-var assignments (`NAME=value` where `NAME` contains TOKEN, SECRET, PASSWORD, PASSWD, CREDENTIAL, KEY, or AUTH) → `NAME=<redacted>`
- Common secret shapes — GitHub `gh[pousr]_*` / `github_pat_*`, `sk-` keys, AWS `AKIA…` access keys, Slack `xox[abprs]-`, JWTs, Bearer/Authorization values, PEM private-key blocks → `<redacted>`
- Absolute user paths (`/home/<user>/…`, `/Users/<user>/…`) → `(local path)`; the ledger keeps the exact `transcript_ref` for audit while the packet carries the marker

The list is a floor, not a guarantee: prompt text is excluded structurally by the projection, never merely pattern-matched.

---

## 5. Completion Semantics

### 5.1 Authority Rules

The following rules are deterministic authority constraints, not prose-only suggestions. Where feasible, they should be enforced as runtime/state-machine checks rather than relying on agent memory.

| Rule | Authority Level | Runtime-Enforceable? |
|---|---|---|
| Worker `READY` ≠ milestone complete | Hard | Yes — ledger state check |
| Strix `ACCEPT` ≠ milestone complete | Hard | Yes — ledger state check |
| Bulldozer `DONE` ≠ project complete | Hard | Yes — ledger state check |
| Only Steamroller may declare global completion | Hard | Yes — role-gated |
| Required current Zen `GO` must be observed before milestone is verified | Hard | Yes — ledger verification entry |
| Materially revised plan invalidates stale review authority | Hard | Yes — plan_version mismatch check |
| Stale Zen verdicts must not authorize a new plan version | Hard | Yes — plan_version mismatch check |

### 5.2 Zen Verdict Staleness

A Zen verdict is valid only for its recorded milestone and candidate result reference, with a `plan_version` matching the current ledger version. A material replan increments the version, marks all prior-version verdicts STALE (including those for completed milestones), clears `completed_milestones` and `current_milestone`, and preserves prior evidence and verdicts as history, not current authority.

Every milestone retained in the new plan must pass §5.3 again in dependency order. Bulldozer may submit existing artifacts with fresh evidence against the new acceptance criteria; unchanged implementation need not be rewritten. Zen must issue a new verdict against that current-version candidate. Steamroller must not relabel an old verdict or carry forward completion without revalidation. Milestones removed by the adopted replan remain historical records, not members of the new plan's completion set.

### 5.3 Milestone Promotion Sequence

A milestone may be promoted to `completed_milestones` only after this sequence is complete:

```text
1. Bulldozer reports DONE with result packet
2. Steamroller requests Zen review of the candidate and governing contract
3. Zen issues current GO (non-stale, matches current plan_version)
4. Steamroller observes the GO verdict
5. Steamroller updates ledger: moves milestone_id to completed_milestones,
   updates evidence, clears current_milestone, sets next_action
```

No step may be skipped. Parent confidence, elapsed time, or a prior-session Zen GO do not substitute for step 3.

### 5.4 Global Completion Preconditions

Steamroller may declare global project completion only when ALL of the following are true:

- All milestones in the plan are in `completed_milestones`
- Each completed milestone has a valid (non-stale) Zen GO on record
- No active blockers remain in the ledger
- The current `plan_version` matches the version under which all Zen verdicts were issued
- Steamroller has directly observed the evidence, not merely received a claim from a child agent

### 5.5 State-Machine Target

The completion authority rules in §5.1 should be implemented as explicit ledger state-machine transitions in implementation slice 44C. The ledger state machine must reject invalid transitions (e.g., setting global completion while `current_milestone` is non-empty, or adding a milestone to `completed_milestones` without a valid verification entry).

---

## 6. Exact-Model / Effort Invocation Boundary

### 6.1 Purpose

AGY native custom-subagent model selection (`inherit | flash | pro`) is too coarse for roles where exact model identity and reasoning effort materially affect behavior. vNext introduces a narrow invocation layer that owns the exact model/effort decision for critical roles.

This layer is NOT a general orchestration framework. It is a narrow runner for a specific set of roles.

### 6.2 Runner Responsibilities

The invocation layer must own at minimum:

| Responsibility | Description |
|---|---|
| Exact stable model slug | Resolved from the installed AGY model surface at runtime — not hard-coded |
| Reasoning effort | Per-role effort level (e.g., High) |
| cwd / target context | Working directory and relevant context file paths |
| Bounded prompt construction | Compose a deterministic, bounded prompt from the handoff packet; do not pass raw conversational state |
| Timeout | Per-invocation timeout; runner must not hang indefinitely |
| Recursion / nested invocation protection | Prevent a role from invoking itself recursively |
| Result capture | Structured capture of the role's output packet |
| Failure reporting | Structured failure report on timeout, error, or invalid output |

### 6.3 Model Policy Table

Initial target policy (subject to live validation in slice 44B):

| Role | Model Family | Effort | Invocation |
|---|---|---|---|
| Steamroller | Gemini 3.8 Flash | High | via exact-model runner |
| Piledriver | Gemini 3.1 Pro | High | via exact-model runner |
| Bulldozer | Gemini 3.8 Flash | High | via exact-model runner |
| Instinct | Claude Sonnet 5.5 (Claude Opus 5.5 only on explicit escalation) | High | via exact-model runner |
| Jaguar | Flash | native | native AGY subagent |
| Puma | Flash | native | native AGY subagent |
| Bobcat | Flash | native | native AGY subagent |
| Strix Halo | Pro | native | native AGY subagent |
| Zen | Pro | native | native AGY subagent (exact 3.1P/High only if validation shows material improvement) |

**Do NOT hard-code unverified AGY model slugs.** Resolve exact slug from the installed AGY model surface during implementation. If a slug cannot be resolved, runner must fail with a structured error rather than falling back silently.

**Do NOT turn every specialist into a separate process.** Jaguar, Puma, Bobcat, Strix Halo, and Zen remain native AGY subagents unless live validation demonstrates a concrete need to move one.

### 6.4 Instinct Runner Path

Instinct is a client of the same runner, not a special case; adding it required no redesign of the runner interface or the orchestration graph.

```text
Steamroller → NEEDS_ALT → Instinct runner → Sonnet session → alternate-perspective artifact → Steamroller
```

**RESOLVED (#20, OQ-4):** The exact-model runner validates the Sonnet invocation path (fail-closed slug resolution from the installed AGY surface). Opus 5.5 / High is selected only on explicit escalation.

---

## 7. Preserved Invariants and Activation

### 7.1 Generic Invariants That Survive Migration

The following generic invariants are preserved in vNext:

| Invariant | Source | vNext Status |
|---|---|---|
| Native-first preference | AGENTS.md design rule 1 | PRESERVE — runners and ledger must be as narrow as possible |
| Model-adaptive role design | AGENTS.md design rule 4 | PRESERVE — roles are designed for observed model behavior |
| Evidence discipline (OBSERVED / INFERRED / UNKNOWN) | harness.md | PRESERVE — applies to all roles |
| Narrow behavioral guards (NTG_EXCAVATOR=1, NTG_ZEN_VERIFY=1) | hooks | PRESERVE until a validated replacement is specified |
| Explicit verification authority (Zen as hard gate) | orchestration.md | PRESERVE — strengthened in vNext |
| Routing by kind of work, not task size | AGENTS.md routing principle | PRESERVE |
| Shallow internal graph | AGENTS.md design rule 3 | PRESERVE — vNext adds one level of hierarchy, not an unbounded graph |
| Fit roles to model behavior before adding harness weight | AGENTS.md design rule 4 | PRESERVE |
| Handoff discipline: compact, decision-relevant packets | harness.md | PRESERVE |
| Anti-bypass safeguards | harness.md | PRESERVE |
| Actual-result verification (not static config checks) | harness.md | PRESERVE |
| Mutation effect discipline (READ_ONLY / REVERSIBLE / PERSISTENT_OR_DESTRUCTIVE) | harness.md | PRESERVE |

### 7.2 Activation Record

44D–44F were stacked migration slices kept isolated from the distributed runtime. 44G validated the complete stack and activated the vNext runtime together with the updated `AGENTS.md` (#134); vNext is now the only shipped structure (#138). The generic invariants in §7.1 continue to apply.

---

## 8. Implementation Sequence

### 8.1 Slices

| Slice | Title | Scope |
|---|---|---|
| **44A** | Architecture contract (this document) | Documentation only — no runtime changes |
| **44B** | Exact-model / effort runner spike | Validate exact-model + effort invocation for Piledriver and Bulldozer; confirm model slugs; establish runner interface |
| **44C** | Authoritative ledger / state transitions | Implement ledger schema and state machine with hard completion gates |
| **44D** | Core role conversion | Convert Steamroller to long-horizon sentinel; convert Piledriver to bounded planner; update Bulldozer to milestone orchestrator |
| **44E** | Minimal spine integration | Connect Steamroller → Piledriver (when needed) → Bulldozer → Bobcat → Zen → Steamroller ledger transition |
| **44F** | Existing specialist reconnection | Reconnect Jaguar, Puma, Strix Halo, and Zen without broadening their local roles |
| **44G** | Live migration / integration validation and provenance closure | Run live AGY validation: multi-milestone work, plan revision, Zen NO-GO, fresh-context resume; update AGENTS.md; provenance closure |
| **#34** | MIT / license metadata closure | After #44 is fully validated |

### 8.2 Minimum Runtime Spine

The minimum spine that must be validated before any further expansion:

```text
Steamroller
  └─► Piledriver  [when planning or difficult decision needed]
  └─► Bulldozer
          └─► Bobcat
  └─► Zen  [milestone verification]
  └─► Steamroller ledger transition
```

Jaguar, Puma, and Strix Halo reconnect in slice 44F. Excavator reconnects as a Bulldozer worker for hard diagnosis/repair (owner decision; §2.9). Instinct is connected to the validated runner in #20.

### 8.3 Provenance Closure

Slice 44G did not establish provenance closure (`.omo/evidence/2026-10-02-44g-findings.md`). The #30/#34 re-authoring removed the four shipped high-overlap surfaces, but its first screening report incorrectly described the allowed AGENTS.md drafting source as low-overlap. The gate correction independently rewords that workspace guide, repairs behavioral parity without importing baseline implementation text, and records reproducible full-corpus measurements. The historical drafting-source exception and the limits of text comparison remain explicit in `.omo/evidence/30-provenance-closure.md`; the original run is not retroactively certified as fully isolated.

And do NOT derive from:

- Legacy NTG implementation surfaces at baseline commit `427544cc`
- Abandoned rewrite branches (`feat/clean-rewrite-issue-33`, `feat/clean-rewrite-issue-33-v2`)
- PR #41 implementation
- Any OMO/GJC/OMP external source text

`PRESERVE` means preserve behavior, not reuse provenance-uncertain implementation. The following mapping covers all 13 core rewrite targets and both runtime/config preservation surfaces in #32. Each is independently re-authored from the permitted specification in the assigned slice; 44G verifies closure for every row before #34.

| Baseline surface | Authoring slice | Closure evidence required in 44G |
|---|---|---|
| `agents/steamroller.md` | 44D | Independent authorship, schema and live supervisor authority |
| `agents/piledriver.md` | 44D | Independent authorship, schema and live planning-only boundary |
| `agents/bulldozer.md` | 44D | Independent authorship, schema and live milestone boundary |
| `agents/bobcat.md` | 44E | Independent authorship, schema and live worker/advisor restrictions |
| `agents/jaguar.md` | 44F | Independent authorship, schema and live read-only retrieval |
| `agents/puma.md` | 44F | Independent authorship, schema and live bounded mechanical work |
| `agents/strix-halo.md` | 44F | Independent authorship, schema and live Bobcat-local gate |
| `agents/zen.md` | 44E; reconnection validation in 44F | Independent authorship, schema and live independent verdict flow |
| `agents/excavator.md` | 44G | Independent authorship, schema and live separate-primary repair boundary |
| `rules/harness.md` | 44D | Independent authorship and static review of preserved generic invariants |
| `rules/orchestration.md` | 44D; integration completed in 44F | Independent authorship and static/live vNext routing and gate evidence |
| `hooks/excavator-shell-guard.py` | 44G | Independent authorship, baseline effect-level unit tests and live marker enforcement |
| `hooks/zen-shell-guard.py` | 44E | Independent authorship, baseline mutation-block unit tests and live marker enforcement |
| `hooks.json` | 44E; Excavator registration completed in 44G | Independent authorship, schema validation and live hook registration evidence |
| `plugin.json` | 44G | Independent authorship and `agy plugin validate .` |

Excavator's existing separate-primary behavior and guard effects are cleanly re-authored before #34; only its new recovery routing/final role design is deferred post-44G. This does not resolve OQ-3 by inventing a new role.

For every row, closure evidence must identify the delivered artifact, permitted drafting sources and validation result. A removed or replaced path must map to its successor artifact and preserved obligations, or an explicit authorized behavior removal; absence alone is not closure. Any unresolved provenance-uncertain distributed surface blocks #34/MIT. `package.json` and `scripts/npm-install.mjs` remain separate distribution plumbing, not additional uncertain core targets.

---

## 9. Open Questions / Spec Gaps

The following items are explicitly unresolved at the time this contract is frozen. Each must be resolved before or during its relevant implementation slice.

| ID | Item | Relevant Slice |
|---|---|---|
| OQ-1 | Exact AGY model slugs for Gemini 3.8 Flash and 3.1 Pro — must be resolved from installed AGY surface, not assumed | 44B |
| OQ-2 | Whether Zen should use exact 3.1P/High or remain on native Pro — validate with live testing | 44B / 44F |
| OQ-3 | Exact final authority, placement, and model assignment of Excavator in the vNext graph | Resolved (owner decision): Bulldozer worker for hard diagnosis/repair, native Pro, no nested delegation, never invokes Zen — §2.9 |
| OQ-4 | Exact AGY CLI invocation path for Sonnet (Instinct backend) — must be validated before Instinct is implemented | Resolved #20 |
| OQ-5 | Ledger persistence format and location (YAML file, sidecar artifact, etc.) — implementation decision for 44C | 44C |
| OQ-6 | `inheritCustomizations: true` kept on the then-native Excavator (#137); AGY 1.3.3 workspace-rule propagation verified for true/omission, suppressed for false; inheritance is not an authority grant | Resolved #137; superseded by the Excavator worker demotion (no native primary; workers carry no `inheritCustomizations`) |
| OQ-7 | Exact mechanism for enforcing state-machine completion rules at runtime (e.g., ledger validator function, pre-transition checks) | 44C |
