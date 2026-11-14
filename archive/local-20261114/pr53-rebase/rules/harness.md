# Harness invariants

44D NON-ACTIVATED DRAFT for the isolated vNext migration context.
Independently authored only from
`docs/specs/pre-vnext-v0.4-behavior-baseline.md` and
`docs/specs/vnext-architecture-contract.md`.
This document neither activates vNext nor changes runtime registrations.

## Governing work contract

Establish and enforce every field before relying on a work contract:

| Field | Required meaning |
| --- | --- |
| GOAL | Intended observable outcome |
| SCOPE | Permitted files, subsystems and operations |
| NON_GOALS | Explicit exclusions that cannot be silently absorbed |
| ACCEPTANCE | Objective conditions for accepting the result |
| SOURCE_OF_TRUTH | Permitted authoritative sources for the work |
| DECISION_RULE | Authorized procedure for deriving decisions |
| COVERAGE | Complete set required by an exhaustive contract |
| COVERAGE_BASIS | Independent evidence that this set is complete |
| EVIDENCE | Facts and artifacts supporting claims |
| EDIT_POLICY | Mutation permissions and restrictions |
| EXPECTED_OUTPUT | Required result and handoff shape |

Missing material information remains UNKNOWN; it is not an invitation to
invent authority. Keep decisions traceable to the source of truth and decision
rule. Do not replace them with lower-authority sources, heuristics or model
judgment. Explicit read-only boundaries and non-goals are hard constraints.

## Evidence and closure

- OBSERVED: directly inspected in the current artifact, tool output or supplied
  authoritative context.
- INFERRED: a conclusion needing independent verification before consequential
  action.
- UNKNOWN: material information not established.

Inspect actual results before claiming pass. Static configuration compliance
does not establish runtime behavior. Distinguish a child's claim from observed
evidence. Exhaustive completion requires both COVERAGE and independently
supported COVERAGE_BASIS; a list derived solely from the work performed does
not prove completeness.

Keep handoffs compact and decision-relevant: result, evidence, unknowns,
material risk and next action. Preserve governing constraints and stable
references rather than losing them through successive paraphrases.
Completion authority is defined in `rules/orchestration.md`, not inferred
from a local handoff or readiness signal.

## Authority and effects

Act only within the current role's authority and exposed tools.
Unavailable authority must not be exercised indirectly.
UNKNOWN frontmatter or inheritance semantics do not grant default tools,
delegation, primary status or mutation permissions. These drafts cannot be
activated until runtime authority encoding is explicitly resolved and
validated.

Classify effects, not just command names:
- READ_ONLY: inspection and evidence gathering.
- REVERSIBLE: a mutation with a clear practical undo path.
- PERSISTENT_OR_DESTRUCTIVE: requires exact identification, evidence-backed
  justification and rollback path.

A denied effect stays denied through equivalent mechanisms. Do not bypass
guards using tee, temporary patches, wrapper shells, scripts or another actor.
Read-only verification never becomes implementation through a tool wrapper.
Preserve narrow guard effects until a validated replacement is specified.
Zen verification commands use `NTG_ZEN_VERIFY=1`; this marker alone is not proof
of enforcement. Excavator's separate migration behavior retains
`NTG_EXCAVATOR=1`, privilege-drift prevention and broad-upgrade prevention;
44D does not reconnect it to the normal spine or rewrite its guards.

## Failure and human boundaries

Report BLOCKED only when all four conditions hold:
1. The blocker has been verified.
2. It prevents the goal.
3. No safe remediation remains.
4. It crosses a hard capability or safety boundary.

Supply evidence, affected scope and the necessary next action. Do not hand
work back merely because a later human step may be needed; continue safe
authorized work. Do not expand scope, invent capabilities or bypass a denial
to avoid reporting a genuine blocker.

## Migration constraints

Preserve generic invariants while replacing the old peer-primary topology
with the specified vNext authority boundaries. Prefer native specialists,
shallow delegation, routing by work kind and roles matched to observed model
behavior. Keep the exact-model runner and ledger narrow, not a general
workflow platform.

Pending-only baseline proposals are not accepted behavior. PRESERVE means
preserve the specified behavior, not reuse legacy implementation text.
Runtime/frontmatter schema compliance, live authority enforcement and
inheritance semantics remain unverified by this prose-only slice.
