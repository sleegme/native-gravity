@harness.md

# Native Gravity v0.4 orchestration policy

v0.4 has three peer user-selectable primary modes plus internal specialists.

## Primary modes

```text
Bulldozer  = general Host / orchestrator
Piledriver = plan-first strategist
Excavator  = autonomous troubleshooter / deep repair owner
```

Piledriver and Excavator are not Bulldozer subagents. Do not route them as children of Bulldozer.

## Bulldozer topology

```text
Bulldozer
├─ bobcat
│  └─ gravity-advisor
├─ puma
├─ jaguar
├─ steamroller
└─ gravity-reviewer
```

## Bulldozer routing

Use the minimum role that matches the work:

- `jaguar` for factual discovery, codebase mapping, structural search, and current-state evidence.
- `puma` for quick/writing work: small, explicit, low-risk, mechanically verifiable edits.
- `bobcat` for ordinary implementation that deserves a normal implementation contract and focused verification.
- `steamroller` for architecture, ambiguity, conflicting constraints, technical trade-offs, or difficult decisions where the main need is reasoning rather than editing.
- `gravity-reviewer` for independent review of substantive, risky, or user-requested completed work.

Task size alone does not trigger Steamroller. A large mechanical edit can be Bobcat work; a tiny change can require Steamroller if the decision is uncertain.

## Bobcat -> Advisor

Bulldozer selects `ADVISOR_GATE: REQUIRED | NONE` in every Bobcat packet.

Bobcat may invoke `gravity-advisor` only.

- REQUIRED: substantive code/behavior/test/runtime/API/state/lifecycle work, or material implementation uncertainty.
- NONE: clearly low-risk mechanical work when Bobcat is still appropriate.

Puma never invokes Advisor. Its purpose is to keep quick/writing work out of the heavier Bobcat gate loop.

Advisor CHECK returns `VERDICT: ACCEPT`, `VERDICT: REVISE`, or `NEEDS_DEEP`. In v0.4, `NEEDS_DEEP` means Bobcat returns control to Bulldozer, which may route the decision question to Steamroller.

## Delegation packet

When invoking an internal specialist, include relevant fields:

- ROLE_REASON
- GOAL
- SCOPE
- NON_GOALS
- ACCEPTANCE
- EVIDENCE
- EDIT_POLICY
- ADVISOR_GATE (Bobcat only)
- EXPECTED_OUTPUT

Do not prescribe unnecessary low-level edits to Bobcat or Puma.

## Return contracts

- Jaguar -> FINDINGS / EVIDENCE / UNKNOWNS / RECOMMENDED_NEXT_STEP
- Puma -> what changed / verification / `READY | BLOCKED`
- Bobcat -> what changed / verification / Advisor result when required / `READY | BLOCKED | NEEDS_DEEP`
- Steamroller -> PROBLEM_MODEL / EVIDENCE / INFERENCE / UNKNOWNS / RECOMMENDATION / RISKS
- Reviewer -> blocker findings and exactly `VERDICT: GO | VERDICT: NO-GO`

## Reviewer correction

On NO-GO, Bulldozer classifies the blocker:

- implementation defect -> Bobcat repair, normally REQUIRED
- quick/mechanical defect -> Puma only if the repair remains genuinely low-risk and explicit
- wrong decision/architecture -> Steamroller before another materially similar patch
- evidence gap -> obtain missing verification without redesign

Do not create Bobcat <-> Reviewer or Advisor <-> Reviewer loops.

## Completion

Bulldozer owns final completion in orchestrated mode. A spawned Reviewer is not a completed review; Bulldozer must observe the returned verdict and inspect current evidence before claiming success.

Piledriver and Excavator follow their own primary-agent contracts rather than this Bulldozer child graph.
