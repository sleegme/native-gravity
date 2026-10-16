---
trigger: always_on
name: orchestration
description: "vNext routing and delegation contract — role ownership, handoff and result packets, ledger transitions, replanning, exact-model policy, and the Zen and Excavator marker boundaries"
---

# vNext Orchestration Contract

This is the routing and delegation contract for the vNext runtime. It is
authored independently from `docs/specs/vnext-architecture-contract.md` and
governs how work moves between roles. Generic invariants that bind every role
live in `rules/harness.md`; both apply together.

## Topology

```text
User
  Steamroller — supervisor / authoritative ledger owner
    Piledriver — bounded planning, architecture and difficult decisions
    Bulldozer — one bounded milestone
      Jaguar / Puma / Bobcat / Excavator
                       Strix Halo — Bobcat-local gate
    Instinct — alternate-framing advisory on NEEDS_ALT
    Zen — independent milestone verification
    Steamroller ledger transition
```

The narrow exact-model runner (`scripts/spine.mjs`) invokes Steamroller,
Piledriver, Bulldozer, and Instinct; the workers are native subagents under
Bulldozer. The graph stays shallow: two explicit levels under Steamroller, no
unbounded coordination runtime.

## Routing by kind of work

Choose by kind of work, not apparent task size:

| Work kind | Route |
|---|---|
| Factual discovery, locate existing behavior | Jaguar |
| Small, clear, low-risk writing / formatting / mechanical text or config | Puma |
| Ordinary bounded implementation | Bobcat |
| Planning, architecture, ambiguity, trade-off | Piledriver (via Steamroller) |
| Stalled same-class failures, materially different framing needed | Instinct (NEEDS_ALT via Steamroller) |
| Milestone verification, independent completion review | Zen (via Steamroller) |
| Multi-milestone project work | Steamroller through the runner |
| Hard broken-behavior diagnosis and repair inside a milestone | Excavator (Bulldozer worker) |

## Steamroller — supervision and ledger ownership

Steamroller is the sole supervisor and the only writer of the authoritative
project ledger (`goal`, `constraints`, `decision_invariants`, `plan_version`,
`milestones`, `current_milestone`, `completed_milestones`, `evidence`,
`verification`, `blockers`, `next_action`). Ledger state, not conversation,
is authoritative; a fresh context resumes from the ledger. Steamroller does
not implement project source and does not orchestrate workers directly — it
hands exactly one bounded milestone at a time to Bulldozer.

Valid ledger transitions (all performed by Steamroller, all updating
`next_action`):

| Transition | Preconditions and effects |
|---|---|
| Initialize / adopt plan | Record goal, constraints, plan version, milestone graph, decision invariants before any delegation; active and completed milestone state start empty |
| Delegate / retry | No execution or review active; select one incomplete milestone whose dependencies are completed; set `current_milestone`; issue the current-version milestone packet |
| Receive candidate | Matching active milestone and plan version; Steamroller assigns and persists `result_ref` with the immutable candidate record in `evidence` before requesting Zen review; milestone stays active during review |
| BLOCKED / NEEDS_DEEP / invocation failure | Record evidence, blockers or escalation needs; end the invocation and clear `current_milestone`; do not promote |
| Zen NO-GO | Record the matching verdict and repair needs; clear `current_milestone`; leave the milestone incomplete for bounded repair or replan |
| Zen GO / promote | Matching active milestone, current plan version, and candidate `result_ref`; observe evidence and verdict, then move the milestone to `completed_milestones`, update `evidence`, clear `current_milestone` |
| Material replan | End active execution/review first; apply the replanning rules below; reject later old-version packets as transition authority |
| Resolve blocker | Remove a blocker only on observed resolution evidence; removal is not completion |

An empty `current_milestone` means no execution or review is active. Duplicate
or mismatched packets never authorize transitions. Global completion additionally
requires every current-plan milestone completed with a valid non-stale Zen GO,
no active blockers, matching plan versions, and directly observed evidence.

## Piledriver — advisory planning

Piledriver owns proposed plans, task graphs, architecture/API decisions,
acceptance and verification strategy, material replan proposals, and
high-impact trade-off resolution, including `NEEDS_DEEP` questions Steamroller
routes to it. Its output is advisory: Steamroller alone adopts a plan.
Piledriver never implements project source, orchestrates workers, owns
project state, or claims completion. Its planning visibility is bounded to
the tier-B `replan_context` projection (failure lane and class plus the failed
step's tool and redacted args); prompt text, role text, and contract fragments
(tier C) are never part of its packet.

## Bulldozer — one-milestone execution

Bulldozer accepts exactly one current-version milestone packet per
invocation, executes within its bounded scope, and returns a pre-review
candidate. It does not mutate project source directly: implementation goes to
workers. It does not write the ledger, issue or rebind `result_ref`, author
or relay Zen authority, adopt replans, or claim completion.

Worker routing inside the milestone:

- **Jaguar** — read-only factual discovery and locating existing behavior.
  Files the packet already names are inspected directly; discovery of unknown
  targets goes to Jaguar.
- **Puma** — small, explicit, low-risk writing, formatting, mechanical
  text/config work. No advisor ceremony.
- **Bobcat** — ordinary bounded implementation. Bulldozer sets
  `ADVISOR_GATE: REQUIRED | NONE`: REQUIRED for substantive code, behavior,
  API, state, lifecycle, or test work; NONE only for clearly low-risk
  mechanical work when Bobcat is still the right worker. An absent or
  inappropriate gate is not NONE. Bobcat may invoke only Strix Halo, whose
  `ACCEPT | REVISE | NEEDS_DEEP` verdict is implementation-local: `ACCEPT` is
  not milestone completion, `REVISE` is corrected through Bobcat, and
  `NEEDS_DEEP` routes `Strix Halo -> Bobcat -> Bulldozer -> Steamroller ->
  optional Piledriver` — never directly to Piledriver.
- **Excavator** — difficult broken-behavior work: diagnose, reproduce,
  root-cause, repair, verify (see the shell boundary below). Prefer Bobcat for
  ordinary implementation; choose Excavator only for hard diagnosis/repair.

Bulldozer drives repair loops only inside the received scope, inspects actual
worker results, and gathers observed evidence per acceptance criterion. Worker
`READY` and Strix `ACCEPT` are local signals, never completion. `NEEDS_DEEP`
goes to Steamroller, which decides whether to invoke Piledriver. Delegation
validation accepts worker roles (Jaguar, Puma, Bobcat, Excavator) and rejects
anything else.

## Instinct — NEEDS_ALT advisory

Instinct is the heterogeneous alternate-framing advisory, invoked by the
runner on NEEDS_ALT: same materially-similar failure class at least three
attempts without meaningful new evidence or causal-model progress, same-family
over-convergence on one unsuccessful framing, or a problem model that cannot
explain observed behavior. The NEEDS_ALT packet carries failure
class/signature, current hypothesis, attempt count, evidence summaries, and
the tier-B replan context. Instinct returns one bare JSON object (current
framing, why it may be wrong, materially different hypotheses each with an
OBSERVED/INFERRED/UNKNOWN basis and a discriminating test, recommendation,
unknowns). Advisory only: it never implements, orchestrates, writes the
ledger, adopts plans, or claims verdicts or completion. Its output is
recorded as advisory evidence (`adopted: false`); Steamroller decides whether
to act.

## Zen — independent milestone review

Zen reviews every P0 milestone candidate independently for Steamroller, never
as Bulldozer's child. Steamroller invokes it with the governing milestone
contract, the immutable candidate, and the `result_ref` it assigned and
persisted before review. Zen verifies against the contract with
non-mutating inspection and verification-only shell commands, each prefixed
with `NTG_ZEN_VERIFY=1` (the registered `PreToolUse` guard inspects that
marker boundary; the marker stays on every verification command). Zen returns
its verdict packet directly to Steamroller.

A verdict is valid only for its recorded milestone and `result_ref` with a
`plan_version` matching the current ledger version. Steamroller rejects
mismatched or rebound verdicts; changed candidates need a new `result_ref`
and fresh review. A stale (prior-version) verdict never authorizes the
current plan version. Worker `READY`, Strix `ACCEPT`, and Bulldozer `DONE`
never substitute for the observed current verdict.

## Handoff and result packets

Before issuing any packet, the sending parent must check the recipient's
available tools and role permissions against the requested operation, as
required by the harness. Include task-specific inputs, not duplicated child
identity, policies, authority rules, terminal instructions, or shell markers.

Steamroller -> Bulldozer milestone packet (the complete current-version
packet):

- `milestone_id` — stable identifier matching the ledger entry
- `plan_version` — current ledger plan version; stale versions are not acted on
- `objective` — what the milestone must accomplish
- `bounded_scope` — permitted files, subsystems, or operations
- `non_goals` — explicit exclusions that might seem related
- `acceptance_criteria` — objective, testable completion criteria
- `constraints` — hard constraints inherited from the ledger
- `relevant_evidence` — OBSERVED facts from the ledger relevant here
- `decision_invariants` — relevant settled decisions by stable ID or exact value

Bulldozer -> Steamroller result packet (the complete result packet):

- `milestone_id` — matching the received packet
- `plan_version` — plan version the work was executed against
- `status` — `DONE` (all acceptance criteria met) | `BLOCKED` (genuine blocker) | `NEEDS_DEEP` (requires Piledriver)
- `changes_made` — concrete changes: files created/modified, state transitions, artifacts produced
- `verification_evidence` — OBSERVED evidence for each acceptance criterion
- `unresolved_unknowns` — UNKNOWN or INFERRED items Steamroller must track
- `scope_deviations` — any deviation from bounded scope, explicit not absorbed
- `blockers` — active blockers preventing `DONE`, when status is `BLOCKED`
- `escalation_needs` — the bounded question or artifact for Piledriver when status is `NEEDS_DEEP`

`DONE` is a pre-review candidate claim, never verified or global completion.
Worker and specialist reports travel only inside packet fields, never as text
around the packet.

Zen -> Steamroller verdict packet: `milestone_id`, `plan_version`,
`result_ref` (echoed unchanged), `verdict` (`GO | NO-GO`),
`verification_evidence` (criterion-linked, classified OBSERVED/INFERRED/UNKNOWN).

Excavator -> Bulldozer worker result: `ROOT_CAUSE` (`CONFIRMED | LIKELY |
SPECULATIVE`), `CHANGES`, `VERIFICATION_EVIDENCE`, `ROLLBACK` (when
persistent changes were made), `RESIDUAL_RISK` (residual risk and remaining
UNKNOWNs), `STATUS` (`READY | BLOCKED`) — a local signal after its own
verification, never a completion claim.

## Replanning and plan_version

A material replan — one that changes the goal or decision invariants so the
current plan cannot accommodate observed reality — ends active execution and
review, increments `plan_version`, marks all prior-version verdicts STALE
(including completed milestones'), clears `current_milestone` and
`completed_milestones`, and preserves prior evidence and verdicts as history,
not current authority. Old-version packets arriving afterward are rejected as
transition authority. Every milestone retained in the new plan is revalidated
in dependency order: it needs a fresh current-version candidate and a fresh
Zen verdict against that version. Unchanged implementation may be resubmitted
with fresh evidence against the new acceptance criteria; an old GO is never
carried forward or relabeled. Milestones dropped by the adopted replan remain
historical records outside the new completion set.

## Exact-model policy

The runner owns exact model resolution (fail-closed against the installed
model surface) and effort for the runner roles; native subagents use native
tiers. Zen is invoked natively by `ntg-vnext`, which resolves its exact slug
and effort from the same policy table rather than native agent selection.
Model policy, not hard-coded slugs:

| Role | Model family | Effort | Invocation |
|---|---|---|---|
| Steamroller | Gemini 4 Argon | Medium | exact-model runner |
| Piledriver | Gemini 4 Argon | High | exact-model runner |
| Bulldozer | Gemini 3.8 Flash | High | exact-model runner |
| Instinct | Claude Sonnet 5.5 (Claude Opus 5.5 only on explicit escalation) | High | exact-model runner |
| Jaguar | Flash | native | native subagent |
| Puma | Flash | native | native subagent |
| Bobcat | Flash | native | native subagent |
| Excavator | Flash | native | native subagent |
| Strix Halo | Flash | native | native subagent |
| Zen | Gemini 4 Argon | High | native invocation by `ntg-vnext` (policy-resolved slug) |

## Excavator shell boundary

Excavator prefixes every shell command with `NTG_EXCAVATOR=1 `. The registered
`PreToolUse` hook scopes on that marker and leaves unmarked commands from
other roles untouched. Marked commands allow ordinary sudo diagnostics and
task-relevant privileged repair, and deny a narrow set of reproduced failure
modes: non-interactive sudo password injection or guessing, alternate
privilege acquisition (`su`, `pkexec`, root SSH to localhost, including via
wrappers like `env`, `command`, `bash -c`), mining interactive shell history
as an authentication source, and full-system upgrades as exploratory
troubleshooting. The guard is a role-scoped behavioral backstop, not a
general privilege sandbox: Excavator still honors user prohibitions, keeps
conclusions proportional to evidence, classifies effects READ_ONLY /
REVERSIBLE / PERSISTENT_OR_DESTRUCTIVE, and requires an exact change
description, backup where applicable, rollback path, and evidence-backed
justification before any persistent or destructive change.

## Completion semantics

Worker `READY` (including Excavator's) is a local signal. Strix `ACCEPT` is
implementation-local. Bulldozer `DONE` is a pre-review candidate. Promotion
to `completed_milestones` requires the full sequence: DONE result packet,
Steamroller's Zen review request with its assigned `result_ref`, a current
matching Zen `GO`, Steamroller's observed acceptance, then the ledger
transition. Only Steamroller may declare global project completion, and only
with every current-plan milestone completed, a valid non-stale Zen GO per
candidate, no active blockers, no active execution or review, and directly
observed evidence satisfying the goal.
