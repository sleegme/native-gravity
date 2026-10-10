# Status

## Track

**vNext implementation/draft reconciliation — non-activated.**

Merged #44 work and isolated validation evidence are not activation or a freeze
of unresolved decisions. The old v0.4 / AGY 1.1.21 alpha checklist describes
historical released-runtime validation, not current vNext readiness.

## Implemented #44 work

| Slice | Delivered scope |
| --- | --- |
| 44B | Narrow exact-model/effort runner, installed-model resolution, bounded packets, timeout/recursion protection and structured results/failures |
| 44C | Steamroller-owned authoritative ledger and completion state machine, candidate/result binding, current-version review gates and replan invalidation |
| 44D | Non-activated core-role/rule drafts: Steamroller supervisor, bounded Piledriver planner and Bulldozer milestone orchestrator |
| 44E | Minimum runner/ledger spine and independent Zen candidate review |
| 44F | Jaguar/Puma/Strix Halo specialist reconnection without broader authority |

Subsequent merged fixes cover runner role-body injection and strict machine
response handling, specialist packet validation, ledger ownership locking,
blocker normalization, bounded failure-prompt growth and delegation-boundary
checks. Recent role fixes keep Piledriver planning-only even for execution or
review intake (#108), and route Bulldozer discovery to Jaguar while permitting
direct inspection of known context (#109).

Steamroller alone owns ledger transitions and global completion. Worker READY,
Strix ACCEPT and Bulldozer DONE cannot replace independent candidate-matching
Zen GO before milestone promotion.

## Recorded validation

These are historical receipts, not checks newly run by this docs change:

- [44B runner spike](../../44b-runner-spike.md): installed-model resolution and
  bounded live Piledriver/Bulldozer invocation.
- [Role-contract validation](../../../../.omo/evidence/2026-10-03-44g-role-contract-findings.md):
  isolated role-body composition and machine packet parsing; no claim of
  customization isolation or activation.
- [44G integration run and solo rerun](../../../../.omo/evidence/2026-10-07-44g-e2e-validation-run4.md):
  multi-milestone execution, fresh-context resume, plan revision and advisory
  Piledriver. The initially timed-out case completed with DONE + Zen GO at a
  larger budget; its name did not make it a NO-GO test.
- [Dedicated Zen NO-GO case](../../../../.omo/evidence/2026-10-07-44g-case5-zen-no-go.md):
  a fixed candidate with a mutable artifact reference was independently
  rejected by live Zen; the production ledger refused promotion and global
  completion. Candidate generation was a fixture, not live Bulldozer work.

## Pending activation boundary

- Complete the activation/validation boundary for the intended host, including
  live authority encoding and OQ-6 customization/inheritance isolation.
  Plugin validation, agent discovery or omission of `--agent` alone is not proof.
- Resolve #56's always-on strict orchestration versus explicit `$loop`
  activation through live validation. `$loop` remains a **candidate pending
  #56 live validation**, not an implemented/final contract.
- Keep native specialist role policy unless live evidence justifies a change;
  Zen's optional exact-model choice is not settled here.
- Complete required migration/provenance closure before activation and #34
  license closure. A merged slice or historical activation claim is not a
  substitute for current boundary evidence.

Excavator remains separate outside P0; recovery reconnection/final authority
is post-44G. Instinct/Sonnet remains future work. Neither is a missing-capability
fallback for the current spine.
