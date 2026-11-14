# Issue #18: hybrid DAG execution with bounded convergence

Date: 2026-10-07

Status: design exploration; no runtime, role, model, or policy changes.

## Evidence basis

Fetched `origin` and read the committed precursor documents before designing:

- #16: `origin/docs/16-ralph-loop` at
  `dd40ef0023fea4d077a9653ef2be897028d52a08`,
  `.omo/evidence/16-ralph-loop-exploration.md`.
- #17: `origin/docs/17-task-graph` at
  `1b33034494a6dbb34bba01ff745c7bcd643c8532`,
  `.omo/evidence/17-task-graph-exploration.md`.
- Default role/rule baseline: `origin/main` at
  `28f70c9d50c63fa3357c78d3c3ad50a599d85efb`; read `AGENTS.md`,
  `agents/piledriver.md`, `agents/bulldozer.md`, `agents/zen.md`,
  `rules/orchestration.md`, and `rules/harness.md`.

**OBSERVED:** #16 recommends a Bulldozer-internal driver with iteration, token,
and time bounds. #17 recommends versioned DAG nodes in Piledriver's planning
packet, static verification first, and execution machinery alongside rather
than inside Piledriver. Both are recommendations, not implemented capabilities.

The role contracts independently establish that Piledriver plans, Bulldozer
owns orchestrated execution and global completion, and Zen independently
reviews without mutation or ledger promotion. The runtime limitations below
are reported by the precursor evidence, not newly reproduced in this exploration.

## Recommendation

Pilot opt-in convergence at selected, independently reviewable DAG nodes,
serially under Bulldozer, after static graph validation.
Bulldozer owns node counters and an aggregate run budget; Piledriver owns plan
versions, and Zen gates node promotion plus final integrated completion.
Keep graph-wide automatic repair, concurrency, review-cadence changes, and model
policy changes outside the first pilot until separately approved and validated.

## 1. What the hybrid adds

**INFERRED DESIGN:** the hybrid combines dependency eligibility with bounded
local recovery. Neither scheduling alone nor a whole-task convergence loop
provides that combined contract:

| Model | Provides | Missing without the hybrid |
| --- | --- | --- |
| #17 DAG alone | Explicit dependencies, stable node identity, candidate-bound verification, downstream gating | A bounded continuation policy after a node fails review |
| #16 loop alone | Authorized repair, verification, fresh review, enforceable termination | A defined dependency frontier and localized retry/evidence accounting across a decomposed task |
| Hybrid | Retry only a selected node while its descendants remain ineligible; promote only current reviewed outputs | Still needs semantic planning, authority checks, integration review, and validated runtime enforcement |

The useful unit is an acceptance-linked output with a bounded scope, stable
inputs, and independently meaningful verification, not every edit or tool call.
Piledriver proposes such boundaries and loop eligibility in the versioned plan.
Explicit execution adoption chooses the eligible nodes and approved budgets.
Loop eligibility never grants implementation or external-action authority.

For example, `A: discovery -> B: implementation -> D: integration`, with
`C: documentation -> D`, can repair B without repeating unchanged A or C.
D cannot start while B has NO-GO or a pending review. Retaining A/C evidence
requires an unchanged plan, acceptance, artifacts, and verification basis.
A repair that changes a consumed output invalidates affected dependent
candidates and verdicts; an omitted dependency is a planning defect, not
permission to repair outside B's scope. A material replan requires explicit
adoption and fresh verification; #17 reports that the existing isolated ledger
invalidates all prior verification on material replans, so selective retention
across plan versions is not promised here.

## 2. Node-level versus graph-wide convergence

| Placement | Benefit | Pilot risk |
| --- | --- | --- |
| Selected reviewable nodes | Small repair scope, attributable cost, explicit prerequisite gate, inspectable candidate history | Requires sound node boundaries and final composition review |
| Entire graph | Can address cross-node integration defects in one recovery pass | Ambiguous repair scope, expensive replay, stale downstream evidence, repeated effects, and hidden replanning |

**RECOMMEND node-level first**, with one active node and a run-wide budget
ceiling. Serial dispatch avoids introducing concurrent milestone semantics or
resource isolation at the same time as convergence. The graph still supplies
dependency validation and readiness ordering at a concurrency cap of one.
Static verification precedes any autonomous dispatch, as #17 recommends.

A run-wide ceiling is not a graph-wide semantic repair loop. It limits total
expenditure across the graph without authorizing replay of the graph. The first
pilot should perform final integrated verification and Zen review once; a
cross-node NO-GO returns a concrete diagnosis/decision handoff rather than
automatically launching another graph pass. A defect wholly covered by an
already authorized integration node can use that node's remaining allowance,
but any changed node still needs fresh applicable review.

On node exhaustion or stall, propose stopping new graph dispatch for the first
pilot, retaining completed evidence and marking descendants ineligible. Do not
claim unrelated branches may always continue: #17 identifies global versus
affected-branch blocker handling as unresolved issue #93 policy. This
conservative pilot setting needs PO approval and does not settle #93 generally.

## 3. Termination, counters, and authority

### Ownership

**Bulldozer owns both per-node counters and aggregate run accounting**, through
one serialized execution-state writer. Piledriver may propose limits but cannot
dispatch repairs, increment execution allowances, or promote execution results.
It retains plan-readiness review and material replanning responsibility.
Zen returns verdicts; Bulldozer observes them and records promotion. A future
explicitly activated vNext supervisor would need its own contract mapping;
this proposal does not activate that topology.

Freeze the original goal, scope, non-goals, acceptance, source authority,
coverage basis, graph version, and node contract before dispatch. Define a
repair cycle as one authorized post-NO-GO correction packet, including relevant
verification and fresh review. Charge it before dispatch. Initial work and
review spend time/tokens but do not count as a repair cycle. Evidence-only
corrections count; duplicate events and transport retries never replenish
allowances. Compaction, restart, child replacement, or replan cannot silently
reset the run budget.

Apply the earliest of node repair, node token/time, aggregate repair/token,
and whole-run deadline limits. Node allocations are subdivisions, not extra
allowances: three cycles at each of ten nodes must not silently authorize
thirty cycles. Reserve final node review and final integration review capacity
before authorizing a repair. #16's three cycles, 60,000 tokens, and 20 minutes
are illustrative whole-execution proposals, not approved defaults to multiply
per node; the PO must choose allocations and aggregate limits.

### Zen's final say without reviewing every edit

Review at the independently meaningful node boundary, not during diagnosis or
after each worker edit. Bulldozer can route one concrete correction packet,
allow authorized worker/advisor work inside it, and complete local verification
before submitting its resulting candidate to Zen. Such internal edits are not
node promotions and do not unblock dependents.

For the first pilot, retain #16's fresh Zen review after each completed
post-NO-GO repair cycle. Zen need not re-review unaffected nodes or every
internal repair step, but skipping candidate reviews after formal NO-GO would
change the precursor cadence and needs a separate PO decision. A proposed
batched-repair cadence must not masquerade as the existing contract.

Each review carries the lossless governing contract plus the bounded node
contract, graph version, node/attempt ID, prerequisite artifact references,
candidate/evidence revision, unresolved findings, and actual verification
results. Only an observed matching current Zen GO permits promotion. A newer
review request, material mutation, or changed inputs invalidates prior GO.
Worker READY, Strix ACCEPT, process exit, and exhausted retries cannot replace it.
All nodes promoted still require coverage and composition verification and
current Zen GO for the final integrated artifact before Bulldozer reports READY.

### Terminal behavior and enforcement

- `CONVERGED`: current acceptance evidence and matching Zen GO; node promotion
  is not global completion.
- `BUDGET_EXHAUSTED`: report the first limiting dimension, spent/limit,
  unfinished criteria, last findings, and candidate reference; no further repair.
- `STALLED`: repeated materially unchanged failure without relevant progress;
  propose #16's two similar unsuccessful cycles as a PO-approved threshold.
- `NEEDS_DECISION`: contradictory acceptance, material replan, or policy choice;
  do not weaken the contract to produce GO.
- `BLOCKED`, `CANCELLED`, or `RUNTIME_ERROR`: preserve actual evidence and
  distinguish verified generic blockers, human cancellation, and runtime faults.

These are proposed driver outcomes, not new parsed role sentinel lines.
Exhaustion/stall is incomplete work, not automatically generic BLOCKED. On any
terminal stop, prohibit new dispatch and cancel/quiesce active children before
closing the run. Human cancellation has priority. Additional allowance or
changed acceptance requires explicit authorization and recorded history.

#16 reports that current `ntg-run` has no usage accountant or whole-run watchdog,
and headless AGY 1.2/1.3 does not fire Stop events. A Stop counter alone therefore
cannot enforce this pilot. Require a validated native lifecycle path, trusted
aggregate input/output token accounting with in-flight reservations, a deadline
watchdog, and descendant cancellation. Refuse a requested hard-cap mode if its
enforcement is unavailable; any iteration/time-only variant is a separately
labeled PO choice, not token-bounded convergence.

## 4. Pilot instrumentation and ledger evidence

**PROPOSED:** keep execution facts separate from Piledriver's immutable plan.
Log a compact append-only transition history into an approved pilot ledger,
with raw evidence by reference. Do not silently add fields or concurrent states
to the isolated vNext ledger. If a runtime sidecar is needed for atomic
enforcement, it is the single authoritative counter state; ledger records are
correlated audit events, not a competing writable counter.

| Record | Minimum fields |
| --- | --- |
| Run contract | Run/session ID, adopted graph version and digest, original contract reference, authorized owner, selected loop nodes, configured node/run caps, deadline and enforcement mode |
| Node attempt | Node ID, attempt/dispatch ID, prerequisite candidate references, bounded contract digest, worker/Advisor gate, resource claims, candidate/evidence revision, state transition and timestamp |
| Retry accounting | Charged repair-cycle number and reason, per-node and run totals, blocker fingerprints, observed artifact/evidence progress, duplicate-event cursor |
| Cost accounting | Actual input/output tokens across primary, children, advisors and Zen; usage-source provenance; in-flight reservations; node elapsed time and whole-run elapsed time; remaining/spent limits |
| Verification | Criterion-to-check mapping, actual result/exit status where applicable, evidence references, unknowns, and coverage basis |
| Review/promotion | Zen child/request identity, reviewed graph/node/attempt/candidate, actual GO/NO-GO and findings, freshness/invalidation reason, execution-owner promotion event |
| Closure | Outcome and limiting dimension, active-child cancellation/quiescence evidence, unresolved criteria, final integrated candidate and Zen verdict, human decisions or overrides |

Measure repair counts and cost to the first applicable GO, unresolved finding
trends, stale-verdict rejections, downstream launches denied, cancellation
completion, and final composition failures. Counts measure expense, not quality.
Compare localized work retained versus repeated under unchanged inputs; do not
claim a performance improvement without measured baseline evidence.

Before enabling a pilot, demonstrate static cycle/dangling-edge rejection,
node NO-GO -> authorized repair -> verification -> fresh GO, blocked descendants,
stale/wrong-sender/pending review rejection, changed-prerequisite invalidation,
and final integration NO-GO despite green nodes. Exercise each node/run cap,
in-flight cancellation, duplicate events, interrupted-state reconciliation
without mutating replay, missing telemetry, stalls, and changed contracts.
Validate these through the real native lifecycle as well as deterministic
state-transition tests. No such hybrid execution was run for this document.

## 5. Exclusions and explicit PO-decision surface

The hybrid does not replace:

- Piledriver's requirement interpretation, source grounding, uncertainty,
  acceptance, dependencies, or reviewed material replanning.
- Bulldozer's routing, integration, coverage closure, and global completion.
- Zen's independent non-mutating review or current artifact-bound GO.
- Worker verification, mandatory Bobcat Advisor gates, or current role tools.
- Human authorization, external-action gates, cancellation, and native lifecycle.
- Static graph validation or semantic review of missing work/dependencies.

It also does not introduce Ralph as a role, nest peer primaries, repeat primary
process launches, activate vNext, create concurrent milestones, change models,
or claim a graph parser/scheduler already exists in the default workflow.

| Surface | Pure design deliverable here | Needs owner/PO approval before adoption |
| --- | --- | --- |
| Hybrid scope | Comparison and node-local recommendation | Which nodes opt in; autonomous continuation authority; serial-first pilot scope |
| Budgets and termination | Counter semantics, no-reset rules, outcome distinctions | Numerical node/run caps, review reserves, stall threshold, exhaustion handoff policy |
| Review cadence | Node-boundary review plus final integration, preserving #16 cadence | Any batching across formal repair cycles, reduced review scope, or alternate completion gate |
| Partial failure | Descendant gating and conservative stop recommendation | Global stop versus independent-branch continuation, including relationship to #93 |
| Runtime/state | Required identity, freshness, accounting and cancellation evidence | New hook/runner behavior, persistent sidecar exception, approved ledger/schema and telemetry retention |
| Unsupported enforcement | Explicitly distinguish hard bounds from unsupported modes | Whether a labeled iteration/time-only pilot is acceptable |
| Planning and adoption | Versioned graph and explicit execution handoff | Structured contract adoption and rules for budget carryover/material replans |
| Model/policy boundary | Preserve present roles, models and tool authority | Any model assignment, role permission, topology, vNext activation, or concurrency change |

Publishing this evidence is not approval of these policy-adjacent decisions.
The next implementation increment should remain #17's static validation;
an owner-approved node convergence pilot follows only after #16's lifecycle and
budget-enforcement prerequisites are demonstrated.

## Evidence limits

This is documentation-only exploration based on the two fetched precursor
documents and inspected default role/rule contracts. Runtime scripts referenced
by the precursors were not independently re-audited here. No new runtime tests,
AGY sessions, scheduler benchmarks, or hybrid pilot were run. All proposed
schemas, counters, outcomes, and enforcement behavior remain design, not shipped
capabilities; unvalidated host behavior remains UNKNOWN.
