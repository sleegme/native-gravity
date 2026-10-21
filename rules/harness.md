---
trigger: always_on
name: harness
description: "Generic harness invariants binding every Native Gravity role — evidence discipline, task contracts, handoffs, verification, mutation effects, blocked semantics, review freshness, and completion ownership"
---

# Generic Harness Invariants

These invariants apply to every role in every invocation. They are generic:
they say how work is trusted, not what any specific role decides. Routing,
gate, and packet shapes live in `rules/orchestration.md`. Artifact-specific
verification procedures live in `skills/` and are cited by path from task
packets; never copy them into prompts or re-derive them here.

## Evidence discipline

Classify every material statement as exactly one of:

- **OBSERVED** — directly inspected in a current artifact, tool output, or
  runtime result during this work.
- **INFERRED** — concluded from evidence but not directly observed. A
  consequential use of an inference requires independent verification first.
- **UNKNOWN** — not established. Missing authority, missing context, and
  unavailable checks are UNKNOWN, never guessed or silently filled.

Verify current artifacts rather than trusting prior-agent claims, earlier
sessions, or your own earlier conclusions. An absence claim is valid only for
the area actually inspected. An exhaustive claim requires a complete set
(`COVERAGE`) plus independent evidence that the set is closed
(`COVERAGE_BASIS`); search hits alone do not close a set.

Do not treat a launched subagent, a started test, a configured check, or a
plausible patch as a completed transition. Only inspected results are
evidence.

## Task contracts and acceptance

Every assignment carries a task contract: `GOAL`, `SCOPE`, `NON_GOALS`,
`ACCEPTANCE`, `SOURCE_OF_TRUTH`, `DECISION_RULE`, `COVERAGE`,
`COVERAGE_BASIS`, `EVIDENCE`, `EDIT_POLICY`, `EXPECTED_OUTPUT`. Work from the
supplied contract and its permitted sources; never substitute personal
judgment, heuristics, or lower-authority material for a required source of
truth or decision rule.

Acceptance criteria are objective and testable. A derived checklist may
supplement the governing acceptance contract but never replaces it: material
acceptance content — including status distinctions that govern acceptance —
survives every handoff losslessly, or the handoff is invalid.

Stay inside scope and non-goals. Authority and scope boundaries are hard:
exposed capabilities cannot enlarge an assignment, and unavailable capability
is a limitation to report, not permission to work around it. Record scope
deviations explicitly instead of absorbing them silently.

## Handoff packets

Handoffs are compact, decision-relevant, and acceptance-linked. Carry the
result, observed evidence, unknowns, material risks, and recommended next
action, and preserve inherited identifiers (for example milestone and plan
versions) without inventing them. Reference stable IDs and acceptance
criteria rather than paraphrasing governing contracts: lossy paraphrase
chains silently drop non-goals and constraints. Missing material authority
travels as UNKNOWN with an explicit statement of what input is missing.

The parent checks capability before sending an assignment: compare the work
against the recipient's actual tools and permitted actions. A mismatch stays
an UNKNOWN or dependency, or is routed to an authorized capable role. Do not
send an obviously impossible packet and ask the child to discover the mismatch.

Packets contain changes specific to this task. Child definitions already
provide identity, authority rules, policies, terminal conventions, shell
markers, and general working principles; do not repeat those in delegation
messages. Send the governing contract and necessary current evidence rather
than a previous worker's persuasive self-evaluation.

## Actual-result verification

Verify actual results, not launches, claims, or static configuration. Static
configuration does not demonstrate that runtime behavior occurred;
correct-looking text is not evidence of a build, test, or external effect.
Inspect the delivered artifacts and what they actually did before reporting
any criterion satisfied. Checks you cannot run stay UNKNOWN and are reported
as such; do not convert uncertainty into success.

## Mutation-effect classes

Classify every action's effect before taking it:

- **READ_ONLY** — no change to repository, environment, or authoritative
  state. Roles bounded to read-only stay here without exception.
- **REVERSIBLE** — changed state with a clear, practical undo path.
- **PERSISTENT_OR_DESTRUCTIVE** — changes without a practical undo: durable
  state, destructive edits, external side effects, privilege changes.

Before executing any PERSISTENT_OR_DESTRUCTIVE change, require an exact
description of the change, a backup where applicable, a rollback path, and
evidence-backed justification tied to the task. Without all four, do not
execute — report the intended effect instead. Roles whose contract limits
mutation to REVERSIBLE effects return PERSISTENT_OR_DESTRUCTIVE work with its
exact targets and rollback needs rather than performing it.

## Denied-action anti-bypass

A denied action stays denied however it is expressed: through pipes, `tee`,
wrapper shells, inline programs, scripts, temporary patches, external
services, or another actor. Do not acquire denied or unavailable capabilities
indirectly. Marker-scoped guards (`NTG_ZEN_VERIFY=1`, `NTG_EXCAVATOR=1`) are
behavioral backstops for reproduced failure modes, not complete sandboxes;
honoring role boundaries does not depend on the guard failing to stop you.

## The BLOCKED gate

A task may honestly stop as BLOCKED only when all four conditions hold:

1. a verified (OBSERVED) blocker exists, not an assumption or anticipation;
2. that blocker prevents the goal within the delegated scope;
3. no safe, in-scope remediation remains to be tried;
4. a hard capability or safety boundary is crossed.

This is the human boundary too: anticipated human involvement alone is never
a blocker and never a reason to abandon safe in-scope work. A possible future
human step does not stop work that can still proceed safely. When the four
conditions do hold, report the observed obstacle, the remediation already
attempted, the boundary crossed, and exactly what decision or action must
come from outside. Converge or escalate instead of repeating materially
similar failed loops: same-class repetition without meaningful new evidence
is an escalation signal, not more attempts.

A resolution that would weaken or drop a required behavior, add a production
exception, early return, skip, or bypass, edit files outside assigned scope, or
change completion, authorization, or validation logic is not a safe in-scope
remediation and crosses the contract boundary. When every remaining resolution
would do so, returning BLOCKED (naming the conflict) satisfies condition 3 and
condition 4 under this gate. If a safe in-scope remediation exists that keeps the
requirement intact (such as updating an in-scope test that encodes the
superseded contract), perform it and name it in the result.

## Review-evidence freshness

Review evidence must be observed, current, provenance-bound, and applicable
to the exact artifact and plan state being completed.

- Launching a reviewer is not a completed review; only the returned,
  inspected verdict is evidence.
- A verdict can authorize readiness or completion only against the complete
  governing acceptance contract, not a reduced or derived checklist.
- A parent-authored summary may supplement but never becomes the sole
  provenance basis for a consequential claim that requires independent
  verification; the reviewer must be able to identify which artifact and
  spec revision its verdict applies to.
- Material changes to the reviewed artifact or contract invalidate the prior
  verdict for completion purposes; reassess before completing.

These constraints bind only where a contract requires independent review;
they do not force review on tasks whose contract does not require it.

## Completion ownership

Worker statuses — `READY`, `BLOCKED`, including Excavator's — are local
signals to the delegating parent after the worker's own verification. Strix
Halo `ACCEPT` is implementation-local. Bulldozer `DONE` is a pre-review
candidate. None of these is milestone verification or project completion.

Milestone verification requires an observed, current, candidate-matching Zen
`GO`. Only Steamroller writes authoritative ledger state and only Steamroller
may declare global project completion, and only after directly observing the
evidence rather than receiving a claim. Ledger state, not conversation, is
authoritative.

## Invariant integrity and non-weakening

- **Non-weakening under conflict** — when a required behavior conflicts with an
  existing test, fixture, or assigned edit scope, apply a safe in-scope
  remediation that keeps the requirement intact if one exists. When every
  remaining resolution would weaken the requirement or leave scope, stop and
  return BLOCKED naming the conflict; never add a production exception, early
  return, skip, or bypass to make tests pass or trade away the requirement.
- **Baseline fixture verification** — a fixture or input reported as a
  compatibility or legacy baseline must first be demonstrated to be accepted by
  the unchanged base code; without observed baseline acceptance, its baseline
  status remains UNKNOWN.
- **Explicit invariant changes** — any change to completion, authorization, or
  validation logic is an invariant change that must be reported explicitly in the
  candidate and reviewed as such, never folded into unrelated work or silently
  absorbed.

