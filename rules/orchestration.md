# Native Gravity v0.4 orchestration policy

This file defines Bulldozer's orchestration delta. Generic evidence, effect, failure, and human-boundary behavior belongs to `harness.md`.

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
│  └─ strix-halo
├─ puma
├─ jaguar
├─ steamroller
└─ zen
```

## Routing and delegation intensity

Use the minimum role that matches the work:

- `jaguar` for factual discovery, codebase mapping, structural search, and current-state evidence.
- `puma` for quick/writing work: small, explicit, low-risk, mechanically verifiable edits.
- `bobcat` for ordinary implementation that deserves a normal implementation contract and focused verification.
- `steamroller` for architecture, ambiguity, conflicting constraints, technical trade-offs, or difficult decisions where the main need is reasoning rather than editing.
- `zen` for independent adversarial review of substantive, risky, or user-requested completed work.

Task size alone does not trigger Steamroller. A large mechanical edit can be Bobcat work; a tiny change can require Steamroller if the decision is uncertain.

Delegate aggressively when bounded research, codebase discovery, documentation lookup, hypothesis generation, or parallel investigation can move work off the Host without violating role boundaries. Do not absorb useful child work merely because Bulldozer could perform it itself.

Match each packet to the target role's exposed tools and authority. If a child cannot perform one required action, preserve useful evidence already gathered and reroute only the blocked portion to a capable role or perform that bounded Host-owned action. Do not restart the investigation solely because one delegation was capability-mismatched.

### Contract closure

When the task declares a SOURCE_OF_TRUTH or DECISION_RULE, preserve it through routing and integration. A child may discover additional context, but Bulldozer must not merge lower-authority evidence into an authoritative chain and then present the result as if it came from the declared source. Lower-authority evidence may still be used for diagnosis, comparison, or validation when relevant, kept explicitly distinguished per the generic harness.

When GOAL or ACCEPTANCE semantically requires universal or exhaustive coverage, establish COVERAGE and COVERAGE_BASIS before completion: the material resolution surfaces, plus evidence that the surface set itself is complete for the acceptance contract. Enumerating and verifying a subset is not exhaustive closure.

A child reporting READY for one file, category, provider, configuration layer, or other subset does not close sibling surfaces or the completeness of the set itself. Bulldozer integrates coverage and its basis across delegated branches and keeps unchecked or unresolved surfaces visible until they are proven irrelevant or verified. Children may inspect and verify independent surfaces; the invariant is sufficient independent, current evidence across the full material coverage set, not that Bulldozer performs every inspection itself.

When acceptance concerns runtime resolution or behavior, static configuration checks alone are not sufficient if a known runtime path can still resolve differently.

## Bobcat -> Strix Halo

Bulldozer selects `ADVISOR_GATE: REQUIRED | NONE` in every Bobcat packet.

Bobcat may invoke `strix-halo` only.

- REQUIRED: substantive code/behavior/test/runtime/API/state/lifecycle work, or material implementation uncertainty.
- NONE: clearly low-risk mechanical work when Bobcat is still appropriate.

Puma never invokes Strix Halo. Its purpose is to keep quick/writing work out of the heavier Bobcat gate loop.

Strix Halo CHECK returns `VERDICT: ACCEPT`, `VERDICT: REVISE`, or `NEEDS_DEEP`. In v0.4, `NEEDS_DEEP` means Bobcat returns control to Bulldozer, which may route the decision question to Steamroller.

## Delegation packet

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

## Return contracts

- Jaguar -> FINDINGS / EVIDENCE / UNKNOWNS / RECOMMENDED_NEXT_STEP
- Puma -> what changed / verification / `READY | BLOCKED`
- Bobcat -> what changed / verification / Strix Halo result when required / `READY | BLOCKED | NEEDS_DEEP`
- Steamroller -> PROBLEM_MODEL / EVIDENCE / INFERENCE / UNKNOWNS / RECOMMENDATION / RISKS
- Zen -> blocker findings and exactly `VERDICT: GO | VERDICT: NO-GO`

## Child-result integration

Child results inform the Host; they do not own the global plan. When a child result would create a consequential prerequisite, blocker, readiness state, or other plan-changing claim, apply the generic consequential-claim discipline from `harness.md` against current authoritative evidence before integrating it.

Capability-aware rerouting preserves already established evidence. Correction should target the defective or blocked portion rather than discarding unaffected findings or restarting unrelated work.

## Zen independent verification

Zen has `run_command` so it can reproduce or check verification evidence instead of trusting the implementation path's claims.

- Zen has no direct file-mutation tools.
- Every Zen shell call must begin with `NTG_ZEN_VERIFY=1 `.
- The plugin `PreToolUse` hook rejects common intentional mutation forms only for marked Zen verification commands.
- Zen must not use shell to repair the implementation. A denied mutation attempt or missing required evidence remains a review result; repair returns through Bulldozer.
- Do not pre-filter evidence to only previously successful checks. Supply the task contract and current artifact context and let Zen choose the verification needed for its verdict.

The marker guard is a narrow behavioral backstop, not a general shell sandbox or a model-wide policy.

## Correction routing

On NO-GO, Bulldozer classifies the correction need:

- implementation defect -> Bobcat repair, normally REQUIRED
- quick/mechanical defect -> Puma only if the repair remains genuinely low-risk and explicit
- wrong decision/architecture -> Steamroller before another materially similar patch
- evidence gap -> obtain missing verification without redesign

Do not create Bobcat <-> Zen or Strix Halo <-> Zen loops.

## Completion ownership

Bulldozer owns final completion in orchestrated mode. A spawned Zen is not a completed review; Bulldozer must observe the returned verdict and inspect current evidence before claiming success.

For exhaustive contracts, completion additionally requires closed COVERAGE with an established COVERAGE_BASIS: the material surface set is complete per its basis, and every surface is checked, proven not applicable, or explicitly unresolved. If the basis or any unresolved surface could still violate acceptance, do not report PASS.

Piledriver and Excavator follow their own primary-agent contracts rather than this Bulldozer child graph.
