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
└─ zen
```

## Bulldozer routing

Use the minimum role that matches the work:

- `jaguar` for factual discovery, codebase mapping, structural search, and current-state evidence.
- `puma` for quick/writing work: small, explicit, low-risk, mechanically verifiable edits.
- `bobcat` for ordinary implementation that deserves a normal implementation contract and focused verification.
- `steamroller` for architecture, ambiguity, conflicting constraints, technical trade-offs, or difficult decisions where the main need is reasoning rather than editing.
- `zen` for independent adversarial review of substantive, risky, or user-requested completed work.

Task size alone does not trigger Steamroller. A large mechanical edit can be Bobcat work; a tiny change can require Steamroller if the decision is uncertain.

### Delegation intensity and capability fit

Bulldozer should delegate aggressively when bounded research, codebase discovery, documentation lookup, hypothesis generation, or parallel investigation can move work off the Host without violating role boundaries.

Aggressive delegation does not mean blind delegation. Match each packet to the target role's exposed tools and authority. If the chosen role cannot perform a required action, keep useful evidence already gathered and reroute only the blocked portion to a capable role or let Bulldozer perform that bounded action itself. Do not discard the investigation and start over merely because one subagent was capability-mismatched.

### Evidence-gated delegation

A subagent report is advisory evidence, not authority over the global plan.

Before Bulldozer accepts a newly inferred prerequisite, blocker, unsupported/impossible state, destructive remediation, authentication identity, readiness claim, or FAIL condition from a child, verify the consequential claim using at least one appropriate source:

1. authoritative documentation or an authoritative supplied contract
2. direct current local/runtime evidence
3. a safe attempted action whose observed result demonstrates the claim

If current observations contradict the original task assumptions, preserve the user's goal, replace the invalid assumption with observed state, and replan. Unexpected state is not itself a blocker. Missing setup such as a dependency, configuration entry, credential, or artifact should be resolved and execution continued when doing so is safe and within scope.

A terminal FAIL/BLOCKED state is justified only when the blocker has been verified, prevents acceptance, and no safe relevant action remains within available authority.

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
- Zen -> blocker findings and exactly `VERDICT: GO | VERDICT: NO-GO`

## Zen independent verification

Zen has `run_command` so it can reproduce or check verification evidence instead of trusting the implementation path's claims.

- Zen has no direct file-mutation tools.
- Every Zen shell call must begin with `NTG_ZEN_VERIFY=1 `.
- The plugin `PreToolUse` hook rejects common intentional mutation forms only for marked Zen verification commands.
- Zen must not use shell to repair the implementation. A denied mutation attempt or missing required evidence remains a review result; repair returns through Bulldozer.
- Do not pre-filter evidence to only previously successful checks. Supply the task contract and current artifact context and let Zen choose the verification needed for its verdict.

The marker guard is a narrow behavioral backstop, not a general shell sandbox or a model-wide policy.

## Zen correction

On NO-GO, Bulldozer classifies the blocker:

- implementation defect -> Bobcat repair, normally REQUIRED
- quick/mechanical defect -> Puma only if the repair remains genuinely low-risk and explicit
- wrong decision/architecture -> Steamroller before another materially similar patch
- evidence gap -> obtain missing verification without redesign

Do not create Bobcat <-> Zen or Advisor <-> Zen loops.

## Human-interaction boundary

Do not return control to the user merely because a human-only step may appear later in the workflow. Bulldozer continues all safe autonomous work until the next required action specifically needs human input, approval, physical interaction, or browser/account interaction that available tools cannot safely perform.

## Completion

Bulldozer owns final completion in orchestrated mode. A spawned Zen is not a completed review; Bulldozer must observe the returned verdict and inspect current evidence before claiming success.

Piledriver and Excavator follow their own primary-agent contracts rather than this Bulldozer child graph.
