---
trigger: always_on
description: Routing and delegation policy for Native Gravity orchestration.
---

# Native Gravity vNext orchestration contract

vNext is the runtime (44G, #134). The narrow exact-model runner
(`scripts/spine.mjs`) drives Steamroller -> Piledriver -> Bulldozer -> Zen.
Generic contract/evidence/effect rules live in `rules/harness.md`.

## Ownership and routing

Steamroller is the sole supervisor and authoritative ledger writer, from
initialization through final completion. It invokes Piledriver for planning,
architecture and deep decisions, and Bulldozer for exactly one milestone.
Piledriver has no implementation, worker orchestration, ledger ownership or
completion authority. Its proposals require Steamroller's adoption.

Bulldozer orchestrates only its received milestone; it does not directly
mutate project files. The target worker graph is Bulldozer -> Jaguar / Puma /
Bobcat / Excavator, with Bobcat -> Strix Halo only. Jaguar is read-only
factual retrieval, Puma is low-risk writing/mechanical work with no advisor
ceremony, Bobcat is bounded implementation, and Excavator is difficult
broken-behavior work: diagnose, reproduce, root-cause, repair and verify.
Jaguar, Puma, Excavator and Strix Halo have no subagents. Route by work kind,
not size: ordinary implementation goes to Bobcat; a hard diagnosis/repair
problem goes to Excavator.

Read-only factual discovery that can materially reduce uncertainty SHOULD be
delegated to Jaguar before Bulldozer performs equivalent direct inspection; if
discovery shows state-changing runtime observation is required, Jaguar returns
the unresolved evidence requirement and a mutation-capable worker performs the
bounded experiment.

Bulldozer sets Bobcat's ADVISOR_GATE: REQUIRED for substantive code, behavior,
API, state, lifecycle or test work; NONE only for clearly low-risk mechanical
work. Strix Halo is read-only and returns ACCEPT, REVISE or NEEDS_DEEP.
Corrections go through Bobcat, not around it. NEEDS_DEEP travels from Bobcat
through Bulldozer to Steamroller, which decides whether to invoke Piledriver.
Bulldozer never invokes Piledriver directly.

Zen is Steamroller's independent, non-mutating verification gate, not
Bulldozer's child. All its verification shell commands use
`NTG_ZEN_VERIFY=1`. Zen returns GO or NO-GO directly to Steamroller.
Every P0 milestone requires Zen; there is no NOT_REQUIRED path.

Worker READY != milestone complete.
Strix ACCEPT != milestone complete.
Bulldozer DONE != verified milestone completion or project completion.
Only Steamroller may promote a milestone or declare project completion.

Excavator is a Bulldozer worker for hard diagnosis/repair inside one
milestone; it has no nested delegation and never invokes Zen. No natively
selectable primary remains; `ntg-vnext` is the entry for project work.
Instinct is the NEEDS_ALT alternate-framing
advisory, not a P0 fallback or ritual reviewer.
Do not route around a missing runner or specialist by assuming permissions.

## Steamroller -> Bulldozer

Require all fields in a single bounded packet:

| Field | Contract |
| --- | --- |
| milestone_id | Stable ID matching the authoritative milestone |
| plan_version | Current ledger version; stale packets do not authorize work |
| objective | Actionable outcome for this milestone |
| bounded_scope | Permitted files, subsystems or operations |
| non_goals | Explicit exclusions |
| acceptance_criteria | Objective, testable conditions |
| constraints | Inherited hard project constraints |
| relevant_evidence | Relevant OBSERVED ledger facts |
| decision_invariants | Settled decisions by stable reference or exact value |

Prefer stable references to paraphrases. Unresolved questions are not settled
invariants. Do not require prior conversational state to interpret a packet.

## Bulldozer -> Steamroller

Return all fields:

| Field | Contract |
| --- | --- |
| milestone_id | Received milestone identity |
| plan_version | Version used for execution |
| status | DONE, BLOCKED or NEEDS_DEEP |
| changes_made | Concrete files, artifacts and state changes |
| verification_evidence | OBSERVED evidence for each acceptance criterion |
| unresolved_unknowns | UNKNOWN and INFERRED items requiring tracking |
| scope_deviations | Explicit deviations, never silently absorbed |
| blockers | Active blockers when BLOCKED |
| escalation_needs | Specific decision/question/artifact when NEEDS_DEEP |

DONE means all acceptance criteria are claimed met with evidence, but is
only a pre-review candidate. BLOCKED obeys the harness's four conditions.
NEEDS_DEEP returns to Steamroller, not directly to a planner.

Steamroller alone issues a unique `result_ref`, binding the immutable
candidate packet and the artifact versions it identifies. Persist
`milestone_id`, `plan_version`, `result_ref` and `candidate_artifact_ref` in
ledger evidence before requesting Zen review. Changed contents require a new
reference and review; never rebind an existing reference.
Reference format and storage layout are implemented by `scripts/ledger.mjs`.

## Zen -> Steamroller

The separate verdict packet contains `milestone_id`, `plan_version`,
`result_ref`, `verdict` (GO or NO-GO) and `verification_evidence`.
The review request supplies that same result reference and authoritative
milestone contract. Zen must return the reference unchanged.
Steamroller records verdict context/timestamp, version and reference in
`verification`; all three identity fields must match the candidate currently
under review. Bulldozer neither authors nor relays Zen authority.

## Steamroller -> Instinct (NEEDS_ALT)

Instinct is the heterogeneous alternate-framing advisory, invoked through the
runner when materially similar failures repeat without new evidence,
same-family paths over-converge on one unsuccessful framing, or the current
problem model cannot explain observed behavior. NEEDS_ALT is recommended,
never auto-run, when the same failure class has at least 3 attempts without
new evidence.

The bounded NEEDS_ALT packet carries the failure class and signature, the
current hypothesis, the attempt count, failure evidence summaries and a
tier-B replan context. Instinct returns one bare JSON object: current
framing, why it may be wrong, materially different hypotheses (each with an
OBSERVED / INFERRED / UNKNOWN evidence basis and a discriminating test),
recommendation and unknowns. It has read-only file tools and no shell.

Instinct is advisory only: no implementation, worker orchestration, ledger
writes, plan adoption or completion/verdict claims. Its output is recorded as
advisory evidence (`adopted: false`) and Steamroller alone decides whether to
act on it. It targets Claude Sonnet 5.5 / High; Claude Opus 5.5 / High is
used only on explicit escalation.

## Ledger transition discipline

Only Steamroller performs these transitions; each updates `next_action`.
The minimum state is goal, constraints, decision_invariants, plan_version,
milestones, current_milestone, completed_milestones, evidence, verification,
blockers and next_action.

1. Initialize/adopt: record goal, constraints, plan version, milestone graph
   and settled invariants before delegation. Active and completed sets start
   empty.
2. Delegate/retry: no executor or review is active. Select one incomplete
   milestone whose dependencies are completed; set current_milestone before
   invoking Bulldozer with the current-version packet.
3. Receive candidate: require the active milestone and current plan version.
   Persist the immutable candidate binding before review; keep the milestone
   active while Zen reviews it.
4. BLOCKED/NEEDS_DEEP/invocation failure: record evidence and blockers or
   escalation needs; end the invocation, clear current_milestone and do not
   promote.
5. NO-GO: record the matching verdict and repair needs, clear current_milestone
   and leave the milestone incomplete for bounded repair or replan.
6. GO/promote: observe matching current GO and actual evidence after the DONE
   candidate and review request. Add the milestone to completed_milestones,
   update evidence, clear current_milestone and choose the next action.
7. Resolve blocker: remove it only on observed resolution evidence; removal
   does not itself complete a milestone.

An empty current_milestone means no executor or review is active.
Duplicate, late or mismatched packets do not authorize transitions.
Elapsed time, parent confidence, worker READY and prior-session GO do not
replace the candidate -> independent Zen review -> observed current GO ->
Steamroller promotion sequence.

## Material replanning

End active execution and review before adopting the new plan.
Material changes to the goal or decision invariants require a monotonically
increasing plan_version. Mark every prior-version verdict STALE, including
verdicts for completed milestones. Clear completed_milestones and
current_milestone; preserve prior evidence and verdicts as history.
Reject subsequent old-version packets as authority.

Every retained milestone must pass candidate submission, new current-version
Zen review and promotion again, in dependency order. Existing artifacts may
be submitted with fresh evidence against the new criteria; unchanged code
need not be rewritten. Never relabel an old verdict as current or carry
forward completion without revalidation. Removed milestones remain history,
not members of the new plan's completion set.

## Global completion

Steamroller may declare completion only when every current-plan milestone
is completed with a valid current-version, matching-candidate Zen GO, no
blockers remain, current_milestone is empty, and Steamroller has directly
observed the evidence satisfying the governing contract.
All conditions are required; a subordinate status cannot satisfy them alone.

## Invocation and unresolved runtime configuration

Steamroller/Bulldozer target Gemini 3.8 Flash / High; Piledriver targets
Gemini 3.1 Pro / High; Instinct targets Claude Sonnet 5.5 / High, with
Claude Opus 5.5 / High only on explicit escalation — all through the narrow
exact-model runner. Resolve exact
stable slugs from the installed AGY model surface, never guess or silently
fall back. The runner owns effort, cwd/context, deterministic bounded prompt
construction, timeout, recursion/nested-invocation protection, structured
result capture and timeout/error/invalid-output reporting.
Do not pass raw conversation as invocation state.

Jaguar/Puma/Bobcat remain native Flash; Strix Halo/Zen remain native Pro.
Moving a specialist to a separate process or using exact 3.1 Pro/High for Zen
requires live evidence of a concrete benefit.

OQ-6 (#137) kept explicit `inheritCustomizations: true` on the then-native
Excavator primary to preserve workspace instructions; the controlled probe on
AGY 1.3.3 showed workspace-rule propagation for true and omission, but not
false. Excavator's demotion to a Bulldozer worker supersedes that decision:
no natively selectable primary remains and the worker carries no
`inheritCustomizations` field. Inherited context is not an authority grant.

Open questions that remain UNKNOWN: Zen's optional exact-model choice.
Excavator's authority and placement are resolved (OQ-3): a Bulldozer worker
for hard diagnosis/repair on native Pro, with no nested delegation and no Zen
invocation. Sonnet's invocation path is
resolved (OQ-4, #20). Frontmatter UNKNOWN is not a runtime default or a grant.

## Delegation and review boundaries

No natively selectable primary remains; `ntg-vnext` is the entry for project
work. Excavator is a Bulldozer worker for difficult broken-behavior work;
its STATUS is a local worker signal like the other workers'. Multi-milestone
work, durable ledger state, replanning and global project completion belong
to Steamroller through the runner.

### Delegation packet

When invoking an internal specialist, include relevant fields:

- ROLE_REASON
- GOAL
- SCOPE
- NON_GOALS
- ACCEPTANCE
- SOURCE_OF_TRUTH
- DECISION_RULE
- COVERAGE
- COVERAGE_BASIS
- EVIDENCE
- EDIT_POLICY
- ADVISOR_GATE (Bobcat only)
- EXPECTED_OUTPUT

Include SOURCE_OF_TRUTH, DECISION_RULE, COVERAGE, and COVERAGE_BASIS only when they are material to the delegated unit. Do not prescribe unnecessary low-level edits to Bobcat or Puma.

### Return contracts

- Jaguar -> FINDINGS / EVIDENCE / UNKNOWNS / RECOMMENDED_NEXT_STEP
- Puma -> what changed / verification / `READY | BLOCKED`
- Bobcat -> what changed / verification / Strix Halo result when required / `READY | BLOCKED | NEEDS_DEEP`
- Excavator -> ROOT_CAUSE (`CONFIRMED | LIKELY | SPECULATIVE`) / CHANGES / VERIFICATION_EVIDENCE / ROLLBACK / RESIDUAL_RISK / `READY | BLOCKED`
- Zen -> blocker findings and exactly `VERDICT: GO | VERDICT: NO-GO`

### Child-result integration

Child results inform the Host; they do not own the global plan. When a child result would create a consequential prerequisite, blocker, readiness state, or other plan-changing claim, apply the generic consequential-claim discipline from `harness.md` against current authoritative evidence before integrating it.

Capability-aware rerouting preserves already established evidence. Correction should target the defective or blocked portion rather than discarding unaffected findings or restarting unrelated work.

### Zen independent verification

Zen has `run_command` so it can reproduce or check verification evidence instead of trusting the implementation path's claims.

- Zen has no direct file-mutation tools.
- Every Zen shell call must begin with `NTG_ZEN_VERIFY=1 `.
- The plugin `PreToolUse` hook rejects common intentional mutation forms only for marked Zen verification commands.
- Zen must not use shell to repair the implementation. A denied mutation attempt or missing required evidence remains a review result; repair returns through the implementation role that owns the artifact.
- Do not pre-filter evidence to only previously successful checks. Supply the task contract and current artifact context and let Zen choose the verification needed for its verdict.

The marker guard is a narrow behavioral backstop, not a general shell sandbox or a model-wide policy.

### Correction routing

On NO-GO, Bulldozer classifies the correction need:

- implementation defect -> Bobcat repair, normally REQUIRED
- hard broken behavior with an unknown or disputed root cause -> Excavator
  (diagnose/repair), not another same-shape patch loop
- quick/mechanical defect -> Puma only if the repair remains genuinely low-risk and explicit
- wrong decision/architecture -> return the decision question (runner: NEEDS_DEEP to Steamroller) before another materially similar patch
- evidence gap -> obtain missing verification without redesign

Do not create Bobcat <-> Zen or Strix Halo <-> Zen loops.
