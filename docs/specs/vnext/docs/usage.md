# Usage

> vNext draft — non-activated; isolated validation only.

Normal npm/repository installation loads the released root-level agents,
rules and hooks, not this draft tree. Do not copy these drafts into active
paths as part of documentation reconciliation. See the
[installation boundary](../README.md#installation-boundary).

## Isolated vNext workflow

1. Steamroller establishes or resumes the authoritative ledger: goal,
   constraints, adopted plan version, milestones, evidence and next action.
2. When planning, architecture or a difficult decision is needed, Steamroller
   requests bounded Piledriver advice and decides whether to adopt it.
   Piledriver does not execute, delegate, review delivered work or claim readiness.
3. Steamroller sends Bulldozer exactly one current-version milestone packet:
   identity/version, objective, bounded scope, non-goals, acceptance criteria,
   constraints, relevant evidence and settled decision invariants.
4. Bulldozer directly inspects known context and packet-named files; Jaguar
   handles discovery/unknown targets. Puma handles low-risk mechanical work;
   Bobcat handles implementation. Bulldozer has no shell or direct source-edit
   authority.
5. Bulldozer returns the complete `DONE | BLOCKED | NEEDS_DEEP` result packet
   with changes, criterion-linked evidence, unknowns, deviations, blockers and
   escalation needs. NEEDS_DEEP goes to Steamroller for optional Piledriver
   routing, not directly to Piledriver.
6. For DONE, Steamroller persists the immutable candidate/result reference,
   requests independent Zen review and observes GO matching milestone, current
   plan version and result reference before promotion. NO-GO leaves the
   milestone incomplete for bounded repair or replan.

Machine runner invocations require one bare JSON object; no `READY`,
`PLAN READY`, verdict prose or trailing summary replaces the requested packet.
Bulldozer's first response byte must be `{`. Interactive released-agent
terminal protocols do not authorize completion in this isolated workflow.

## Bobcat vs Puma

Bulldozer selects `ADVISOR_GATE: REQUIRED | NONE` for Bobcat. REQUIRED applies
to substantive code/behavior/API/state/lifecycle/test work; NONE only to clearly
low-risk mechanical work.

With REQUIRED, Bobcat invokes only **Strix Halo** (`strix-halo`) for its
read-only local CHECK gate: ACCEPT permits local READY, REVISE requires repair
and a fresh check, NEEDS_DEEP returns through Bulldozer to Steamroller.
Strix ACCEPT and worker READY are not milestone completion.

Puma handles explicit low-risk writing, formatting and mechanical text/config
changes without delegation or advisor ceremony. Work kind, not line count,
determines the route.

## Validation before activation

Use an isolated context and inspect actual results, not launch acknowledgements:

- Verify runner exact-model/effort resolution, injected vNext role bodies,
  bounded JSON packets, timeout/failure behavior and customization isolation.
- Exercise Steamroller -> Piledriver/Bulldozer, Bulldozer -> Jaguar/Puma/Bobcat,
  Bobcat -> Strix Halo and independent Steamroller -> Zen paths.
- Confirm current candidate binding, NO-GO repair, stale/mismatched verdict
  rejection, material replanning and fresh-context ledger resume.
- Verify live tool/authority boundaries and registered marker-scoped guards.
  Static frontmatter or plugin validation alone is insufficient.
- Confirm global completion only after all current milestones are verified,
  no blockers or active execution/review remain and Steamroller observes evidence.

See [status](./status.md) for recorded receipts and remaining boundaries.
Issue #56 still decides always-on strict orchestration versus explicit `$loop`;
`$loop` is a **candidate pending #56 live validation**, not an activation
instruction to use today.

Excavator remains a separate troubleshooting primary outside P0, not
Bulldozer's child or an automatic recovery route. Instinct/Sonnet is future work.
