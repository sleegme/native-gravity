# Architecture

> vNext draft — non-activated; activation remains validation-gated.

Native Gravity keeps Antigravity's native lifecycle, sessions, workspaces,
model and tool systems. vNext adds a narrow exact-model runner and authoritative
ledger, not a replacement runtime.

This overview follows the [architecture contract](../../vnext-architecture-contract.md)
and current [agent](../agents/) / [rule](../rules/) drafts. The released v0.4
peer-primary topology is not the isolated vNext topology.

## Supervisor and milestone execution

```text
User
  Steamroller — supervisor / authoritative ledger owner
    Piledriver — bounded planning, architecture and difficult decisions
    Bulldozer — one bounded milestone
      Jaguar / Puma / Bobcat
                       Strix Halo — Bobcat-local advisor gate
    Zen — independent milestone verification
    Steamroller ledger transition
```

- **Steamroller** owns the goal, constraints, adopted plan version, milestone
  graph, evidence, blockers, next action and global completion. It alone writes
  authoritative ledger state. It neither implements project source nor directly
  orchestrates workers.
- **Piledriver** proposes plans, architecture/API decisions, verification
  strategy and material replans for Steamroller. It has no implementation,
  delegation, ledger or completion authority. Steamroller decides adoption.
  Execution/review requests remain planning requests; Piledriver does not use
  Zen as a shell runner or claim `READY`, `PLAN READY` or a verdict.
- **Bulldozer** accepts one current-version milestone packet, delegates bounded
  work and returns `DONE | BLOCKED | NEEDS_DEEP`. It does not directly edit
  project source, run shell commands, invoke Piledriver/Zen or write the ledger.
  It directly inspects known context and packet-named files; discovery and
  locating unknown targets go to Jaguar.

## Specialist routing

- **Jaguar** — read-only factual discovery; native Flash role; no delegation.
- **Puma** — explicit low-risk writing/formatting/mechanical work; native Flash
  role; no delegation or advisor ceremony.
- **Bobcat** — bounded implementation; native Flash role; may invoke only
  Strix Halo. Bulldozer sets `ADVISOR_GATE: REQUIRED | NONE`: REQUIRED for
  substantive code/behavior/API/state/lifecycle/test work, NONE only for clearly
  low-risk mechanical work.
- **Strix Halo** — Bobcat-only read-only local gate; native Pro role;
  `ACCEPT | REVISE | NEEDS_DEEP`. Corrections go through Bobcat.
- **Zen** — independent non-mutating milestone verification for Steamroller,
  not Bulldozer's child; native Pro role; `GO | NO-GO`. Verification shell
  commands use `NTG_ZEN_VERIFY=1`.

Route by work kind, not size. Difficult decisions follow
`Strix Halo -> Bobcat -> Bulldozer -> Steamroller -> optional Piledriver`;
no worker or Bulldozer invokes Piledriver directly.

## Ledger and completion

The ledger, not conversational memory, is authoritative. Steamroller records
the goal, constraints, decision invariants, plan version, milestone graph,
active/completed milestones, evidence, verification, blockers and next action.
Only one milestone executes or undergoes review at a time.

Worker `READY` and Strix `ACCEPT` are local signals. Bulldozer `DONE` is a
pre-review candidate, not verified milestone or project completion.
Steamroller persists an immutable candidate and unique `result_ref` before
requesting Zen review. Every P0 milestone requires independent Zen GO matching
`milestone_id`, current `plan_version` and `result_ref`. Only after observing
that GO and the actual evidence may Steamroller promote the milestone.
Changed candidates require a new reference and review.

Material replanning ends active execution/review, increments `plan_version`,
marks prior verdicts STALE and clears active/completed milestone state.
Retained milestones need fresh current-version review in dependency order;
old evidence remains history, not completion authority.
Global completion requires every current milestone verified, no blockers,
no active execution/review and Steamroller's direct observation of evidence.

## Invocation and migration boundaries

Steamroller/Bulldozer target Gemini 3.8 Flash / High; Piledriver targets
Gemini 3.1 Pro / High. The runner resolves installed model slugs without silent
fallback and owns effort, cwd/context, bounded prompt construction, timeout,
recursion protection, structured result capture and failure reporting.
Machine invocations request one bare JSON object, not interactive terminal
prose; Bulldozer's response must start with `{`. Packet parsing does not replace
ledger validation or independent review.

Specialists retain native Flash/Pro role policy. Draft disabled frontmatter
does not itself prove live tool/delegation authority or customization isolation.
Exact-model Zen requires comparative live evidence, not a policy assumption.

Excavator remains a separate troubleshooting primary outside P0; its recovery
reconnection/final placement is post-44G. Preserve `NTG_EXCAVATOR=1` guard
effects. Instinct/Sonnet is future work.

Merged implementation and recorded live checks do not activate this tree.
Authority encoding and OQ-6 inheritance isolation remain activation gates.
Issue #56 is still deciding always-on strict orchestration versus `$loop`;
`$loop` is a **candidate pending #56 live validation**, not settled architecture.
