# Architecture

> vNext is the runtime (44G, [#134](https://github.com/sleegme/native-gravity/issues/134)).

Native Gravity keeps Antigravity's native lifecycle, sessions, workspaces,
model and tool systems. vNext adds a narrow exact-model runner and authoritative
ledger, not a replacement runtime.

This overview follows the [architecture contract](specs/vnext-architecture-contract.md)
and the released [agents](../agents/) / [rules](../rules/). `ntg-vnext` is the
entry for multi-milestone work; no natively selectable primary remains.
Excavator is a Bulldozer worker for difficult broken-behavior diagnosis and
repair inside one milestone.

## Supervisor and milestone execution

```text
User
  Steamroller — supervisor / authoritative ledger owner
    Piledriver — bounded planning, architecture and difficult decisions
    Bulldozer — one bounded milestone
      Jaguar / Puma / Bobcat / Excavator
                       Strix Halo — Bobcat-local advisor gate
    Instinct — alternate-framing advisory on NEEDS_ALT
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
  Execution/review requests remain planning requests. It is runner-only and
  returns advisory JSON.
- **Bulldozer** accepts one current-version milestone packet, delegates bounded
  work and returns `DONE | BLOCKED | NEEDS_DEEP`. It does not directly edit
  project source, run shell commands, invoke Piledriver/Zen or write the ledger.
  It directly inspects known context and packet-named files; discovery and
  locating unknown targets go to Jaguar.
- **Instinct** is the heterogeneous alternate-framing advisory for NEEDS_ALT,
  when materially similar failures repeat without new evidence or same-family
  paths over-converge. It is runner-only and advisory: no implementation,
  orchestration, ledger writes, plan adoption or completion/verdict claims.
  It targets Claude Sonnet 5.5 / High, with Claude Opus 5.5 / High only on an
  explicit escalation. Its advice is recorded as advisory evidence and never
  promotes or adopts anything.

## Specialist routing

- **Jaguar** — read-only factual discovery; native Flash role; no delegation.
- **Puma** — explicit low-risk writing/formatting/mechanical work; native Flash
  role; no delegation or advisor ceremony.
- **Bobcat** — bounded implementation; native Flash role; may invoke only
  Strix Halo. Bulldozer sets `ADVISOR_GATE: REQUIRED | NONE`: REQUIRED for
  substantive code/behavior/API/state/lifecycle/test work, NONE only for clearly
  low-risk mechanical work.
- **Excavator** — difficult broken-behavior worker under Bulldozer: diagnose,
  reproduce, root-cause, repair and verify inside one milestone; native Pro
  role; no nested delegation and no Zen invocation. Its STATUS is a local
  worker signal like the other workers'.
- **Strix Halo** — Bobcat-only read-only local gate; native Pro role;
  `ACCEPT | REVISE | NEEDS_DEEP`. Corrections go through Bobcat.
- **Zen** — independent non-mutating milestone verification for Steamroller,
  not Bulldozer's child; native Pro
  role; `GO | NO-GO`. Verification shell commands use `NTG_ZEN_VERIFY=1`.

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

Piledriver's replanning view is a bounded tier-B projection, not the raw
ledger: it records which artifact/lane failed plus the failed step's
redacted tool args or command line (NTG #114). Prompt text, role text and
contract fragments stay out of planning packets.

## Invocation and migration boundaries

Steamroller/Bulldozer target Gemini 3.8 Flash / High; Piledriver targets
Gemini 3.1 Pro / High; Instinct targets Claude Sonnet 5.5 / High, with Claude
Opus 5.5 / High only on explicit escalation. The runner resolves installed
model slugs without silent
fallback and owns effort, cwd/context, bounded prompt construction, timeout,
recursion protection, structured result capture and failure reporting.
Machine invocations request one bare JSON object, not interactive terminal
prose; Bulldozer's response must start with `{`. Packet parsing does not replace
ledger validation or independent review.

Specialists retain native Flash/Pro role policy. Exact-model Zen requires
comparative live evidence, not a policy assumption.

Excavator is a Bulldozer worker for hard diagnosis/repair inside one
milestone, with no nested delegation and no Zen invocation; the native-primary
Zen completion gate is removed with the primary. Preserve `NTG_EXCAVATOR=1` guard
effects. Instinct is implemented (#20): the same exact-model runner resolves
its Sonnet/Opus slugs fail-closed (OQ-4 resolved), and its NEEDS_ALT packet
carries the tier-B failure context (failure class/signature, current hypothesis,
attempt count, evidence).

OQ-3 is resolved (owner decision): Excavator's authority and placement are a
Bulldozer worker for hard diagnosis/repair on native Pro. OQ-6 (#137) kept
explicit `inheritCustomizations: true` for the then-native Excavator; the
demotion supersedes it — no native primary remains and the worker carries no
`inheritCustomizations` field. The
AGY 1.3.3 controlled probe propagated a workspace rule for true and
omission, but not false. Inherited context is not an authority grant.
Evidence: `.omo/evidence/137-excavator-validation.md`.
