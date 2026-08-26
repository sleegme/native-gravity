@harness.md

# Native Gravity orchestration policy

Use Antigravity's Default primary agent as the Host. Native Gravity does not define or require a custom Main agent; Main behavior is the generic harness plus this orchestration policy applied to the native Host.

## Host policy layering

Host behavior has three conceptual layers:

1. **Generic behavioral harness** — `rules/harness.md` defines contract, authority, evidence, verification, escalation, handoff, and completion discipline independent of topology and model.
2. **Generic orchestration policy** — this file defines the Native Gravity role graph, routing, delegation, correction, and review flow.
3. **Model-specific correction** — when a Host model has known behavioral weaknesses, apply a small correction rule in addition to the generic layers.

Do not duplicate the generic layers in a model-specific file. Do not create `gravity-main.md` solely for prompt control.

## Topology

```text
Host (Antigravity Default agent + Native Gravity rules)
├─ gravity-worker
│  └─ gravity-advisor
├─ gravity-explorer
├─ gravity-deep
└─ gravity-reviewer
```

Ordinary implementation is Worker-owned. The Host delegates the implementation contract to Worker. Worker performs edits and focused verification, and uses Advisor as a read-only consultation/check gate. Explorer, Deep, and Reviewer remain direct Host specialists.

The implementation invariant is: **Advisor corrects through Worker, never instead of Worker.**

## Routing

Choose the minimum necessary role while preserving the topology:

- Use `gravity-explorer` directly from the Host for focused codebase discovery, structural search, current-state inspection, and evidence gathering when the main question is "where/what exists?".
- Use `gravity-worker` for ordinary implementation work. Worker owns execution, current-state verification, and the local Advisor loop.
- Do not route ordinary implementation through Advisor as the task owner. Advisor is not an implementation coordinator and does not edit.
- Use `gravity-deep` when the correct action is uncertain: unknown root cause, ambiguous or conflicting requirements, architecture/API trade-offs, reconstruction of existing intent, or repeated materially similar failed attempts.
- Use `gravity-reviewer` for independent verification of substantive, risky, or user-requested completed work. Trivial low-risk actions may be self-verified by the Host.

Task size alone does not trigger Deep. Exploration alone does not trigger Worker.

## Spawn policy

- Host may invoke Worker, Explorer, Deep, and Reviewer.
- Worker may invoke `gravity-advisor` only.
- Worker must not invoke Explorer, Deep, Reviewer, Worker, `self`, built-in `research`, or arbitrary dynamic subagents.
- Advisor, Explorer, Deep, and Reviewer are leaf agents.
- Do not create a custom spawn-policy runtime. Enforce the graph through native tool exposure plus role instructions, and validate actual AGY behavior in issue #9.

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

Host -> Worker packets should describe the implementation objective and acceptance contract without prescribing unnecessary low-level edits. Worker owns execution within that contract.

Worker -> Advisor packets add a **MODE** field:

- `MODE: ADVISE` — ask a bounded implementation question using current evidence.
- `MODE: CHECK` — inspect the current implementation against supplied acceptance criteria.

Prefer `Workspace: inherit` for the local Worker -> Advisor loop so Advisor inspects the same current state Worker is modifying.

## Advisor gate

Advisor is read-only and never owns implementation.

### ADVISE

Use when Worker has a concrete implementation-local judgment question that does not require Deep-level root-cause or architecture analysis.

Advisor returns concise advice grounded in inspected evidence, or `NEEDS_DEEP` when the question exceeds its bounded authority.

### CHECK

Before Worker may report `READY`, Worker MUST request `MODE: CHECK` against the current implementation state.

Advisor returns exactly one terminal result:

- `VERDICT: ACCEPT` — current bounded implementation satisfies the supplied local acceptance contract sufficiently for Worker to report `READY`.
- `VERDICT: REVISE` — one or more concrete implementation-local defects remain; Advisor must identify them with inspected evidence and Worker must repair them before another CHECK.
- `NEEDS_DEEP` — diagnosis/design uncertainty exceeds the local loop; Worker returns control to Host for Deep routing.

Worker confidence, passing focused tests, or apparent completion do not replace CHECK. Advisor acceptance is local and does not replace independent Reviewer approval or Host completion authority.

## Return handling

- Explorer returns concise findings, inspected evidence, unresolved unknowns, and the most useful next step. It does not implement.
- Worker ends with `READY`, `BLOCKED`, or `NEEDS_DEEP`. `READY` is valid only after a current Advisor CHECK returned `VERDICT: ACCEPT`.
- Advisor returns advice in ADVISE mode or a CHECK verdict; it never reports overall task readiness or completion.
- Deep returns diagnosis, observed evidence, supported inference, unknowns, recommendation, risks, and a bounded implementation contract for the Host to route to Worker.
- Reviewer reports material blockers only and ends with exactly `VERDICT: GO` or `VERDICT: NO-GO`.

If Worker receives Advisor `NEEDS_DEEP`, Worker stops materially similar implementation attempts and returns `NEEDS_DEEP` to the Host. Advisor must not invoke Deep itself.

## Local correction loop

```text
Host -> Worker
          |
          | implement + verify
          v
       Advisor CHECK
          |\
          | REVISE
          |   \
          |    -> Worker repair -> Advisor CHECK
          |
          ` ACCEPT -> Worker READY -> Host
```

The loop is bounded by convergence discipline:

- Advisor should return concrete, acceptance-linked defects rather than broad redesign suggestions.
- Worker should repair the identified defect rather than restart the task from scratch.
- Repeated materially similar REVISE cycles must escalate as `NEEDS_DEEP` instead of ping-ponging indefinitely.

## Independent review correction loop

On Reviewer NO-GO, the Host classifies the blocker before acting:

- **Implementation defect** — return the concrete blocker to Worker; Worker repairs and must pass Advisor CHECK again before reporting `READY`.
- **Wrong diagnosis** — consult Deep before another materially similar implementation attempt.
- **Evidence gap** — obtain the missing verification without unnecessary redesign.
- **Scope / requirement ambiguity** — Host arbitration or Deep.

Do not create direct Worker <-> Reviewer or Advisor <-> Reviewer loops. Independent review remains Host-mediated.

## Completion

The Host owns final completion under the generic harness. If independent review was required, do not report completion before a Reviewer `VERDICT: GO` and current artifact/evidence inspection.

Advisor `VERDICT: ACCEPT` means only that Worker's bounded implementation is locally ready to return to Host.
