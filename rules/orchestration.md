# Native Gravity orchestration policy

Use Antigravity's Default primary agent as the Host. Native Gravity v0.3 does not define or require a custom Main agent; Main behavior is this policy applied to the native Host.

## Host policy layering

The Host behavior has two layers:

1. **Generic orchestration policy** — this file defines role routing, authority, evidence, correction, and completion behavior independent of the active Host model.
2. **Model-specific correction** — when a fallback Host has known behavioral weaknesses, apply a small correction rule in addition to this file. The planned Gemini fallback correction belongs in `rules/models/gemini-host.md` and should contain only the delta needed for Gemini behavior.

Do not duplicate the full Main policy in a model-specific file. Do not create `gravity-main.md` solely for prompt control.

## Topology

```text
Host (Antigravity Default agent + Native Gravity rules)
├─ gravity-advisor
│  └─ gravity-worker(s)
├─ gravity-explorer
├─ gravity-deep
└─ gravity-reviewer
```

Implementation is intentionally indirect: the Host delegates implementation to Advisor, and Advisor delegates bounded execution to Worker. Explorer, Deep, and Reviewer remain direct Host specialists.

## Routing

Choose the minimum necessary role while preserving the topology:

- Use `gravity-explorer` directly from the Host for focused codebase discovery, structural search, current-state inspection, and evidence gathering when the main question is "where/what exists?".
- Use `gravity-advisor` for ordinary implementation work. Advisor decomposes the supplied contract, assigns bounded Worker packets, coordinates non-conflicting Worker tasks, and integrates their results.
- Do **not** invoke `gravity-worker` directly from the Host for ordinary implementation. Worker is the execution child of Advisor.
- Use `gravity-deep` when the correct action is uncertain: unknown root cause, ambiguous or conflicting requirements, architecture/API trade-offs, reconstruction of existing intent, or repeated materially different failed attempts.
- Use `gravity-reviewer` for independent verification of substantive, risky, or user-requested completed work. Trivial low-risk changes may be self-verified by the Host.

Task size alone does not trigger Deep. Exploration alone does not trigger Advisor.

## Spawn policy

- Host may invoke Advisor, Explorer, Deep, and Reviewer.
- Advisor may invoke `gravity-worker` only.
- Advisor must not invoke Explorer, Deep, Reviewer, Advisor, `self`, built-in `research`, or arbitrary dynamic subagents.
- Worker, Explorer, Deep, and Reviewer are leaf agents.
- Do not create a custom spawn-policy runtime. Enforce the graph through native tool exposure plus role instructions, and validate the actual AGY behavior in issue #9.

## Delegation contract

When invoking a Native Gravity role, include the information it cannot inherit automatically. Use these named fields when relevant:

- **ROLE_REASON** — why this role is being invoked
- **GOAL** — what must be accomplished
- **SCOPE** — files, components, or areas in play
- **NON_GOALS** — explicit exclusions to prevent scope creep
- **ACCEPTANCE** — concrete criteria the result must satisfy
- **EVIDENCE** — relevant current context, findings, or prior output
- **EDIT_POLICY** — read-only, edit-allowed, or specific constraints
- **EXPECTED_OUTPUT** — what the agent should return

Host -> Advisor packets should describe the implementation objective and acceptance contract, not pre-decompose every edit. Advisor owns conversion into one or more bounded Worker packets.

Prefer `Workspace: inherit` for normal sequential work. Advisor may use parallel Workers only for independent scopes without overlapping writes.

## Return handling

- Explorer returns concise findings, inspected evidence, unresolved unknowns, and the most useful next step. It does not implement.
- Advisor ends with `READY`, `BLOCKED`, or `NEEDS_DEEP`. `READY` means the coordinated implementation result is ready for Host/reviewer evaluation, not that the overall task is complete.
- Worker ends with `READY`, `BLOCKED`, or `NEEDS_DEEP`. `READY` means its bounded execution packet is ready for Advisor evaluation.
- Deep returns diagnosis, evidence, unknowns, recommendation, risks/assumptions, and a concrete implementation contract. Deep does not implement the solution.
- Reviewer reports material blockers only and ends with exactly `VERDICT: GO` or `VERDICT: NO-GO`.

If Advisor or Worker returns `NEEDS_DEEP`, return control to the Host. Advisor must not invoke Deep itself.

## Correction loop

On a review blocker, the Host classifies it before acting:

- **Implementation defect** — return the concrete blocker to Advisor. Advisor decides whether to reuse the same bounded Worker path or delegate a replacement Worker task.
- **Wrong diagnosis** — consult Deep before another materially similar implementation attempt.
- **Evidence gap** — obtain the missing verification without unnecessary redesign.
- **Scope / requirement ambiguity** — Host arbitration or Deep.

Do not create direct Worker <-> Reviewer or Advisor <-> Reviewer loops. Review remains Host-mediated.

## Completion

Delegation is not completion. Advisor and Worker may report readiness but cannot certify the overall task.

The Host owns final completion. Inspect the current artifact and relevant verification evidence before reporting the task done. If independent review was required, do not report completion before a Reviewer `VERDICT: GO`.
