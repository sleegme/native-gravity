# AGENTS.md

## Project intent

Native Gravity is a thin Antigravity-native orchestration plugin. Use Antigravity's own primary agent, subagent lifecycle, session management, model tiers, delegation primitives, and rule system instead of recreating OMO/OpenCode runtime machinery.

## v0.3.1 development topology

The Antigravity **Default agent** is the Host/coordinator. Native Gravity does not define a separate `gravity-main` agent; Main behavior is expressed as policy applied to the native Host.

```text
Host (Antigravity Default agent + Native Gravity rules)
├─ Worker
│  └─ Advisor
├─ Explorer
├─ Deep
└─ Reviewer
```

- **Worker** — implementation owner. It executes the Host contract, may consult Advisor during implementation, and MUST obtain Advisor acceptance before reporting local readiness.
- **Advisor** — read-only implementation consultant and local quality gate. It advises or returns ACCEPT/REVISE; it never edits project source and never owns execution.
- **Explorer** — read-only discovery leaf. It gathers codebase structure, current-state evidence, and candidate locations directly for the Host.
- **Deep** — read-only reasoning leaf for ambiguity, diagnosis, and technical trade-offs.
- **Reviewer** — read-only independent quality gate for delivered artifacts and evidence.

Recommended v0.3.1 model mapping:

- Host: Claude Sonnet 4.6 as the active Antigravity session model.
- Worker: Antigravity `flash` tier (Gemini 3.7 Flash in the current mapping).
- Advisor: Antigravity `pro` tier (Gemini 3.1 Pro in the current mapping).
- Explorer: Antigravity `flash` tier (Gemini 3.7 Flash in the current mapping).
- Deep: Antigravity `pro` tier (Gemini 3.1 Pro in the current mapping).
- Reviewer: Antigravity `pro` tier (Gemini 3.1 Pro in the current mapping).

Role contracts remain conceptually separate from model identity. Model-family corrections and role x model overlays are tracked in issue #9.

## Why v0.3.1 reverses Advisor -> Worker

The first real v0.3 behavioral-harness exercise exposed a topology failure: the Pro-tier Advisor correctly identified the implementation path, but while its delegated work was pending it began executing the implementation itself. The prompt contract already said Advisor must not edit, so this was not primarily a missing prose rule; the graph gave the higher-reasoning role ownership of the implementation loop and then asked it not to complete the work it had already modeled.

v0.3.1 moves implementation ownership to Worker and makes Advisor an on-demand, read-only gate:

```text
Host -> Worker -> Advisor(CHECK)
                   ├─ REVISE -> Worker repairs -> CHECK again
                   └─ ACCEPT -> Worker may report READY
```

Worker may also call Advisor in `ADVISE` mode when a bounded implementation judgment is useful. Architecture/root-cause uncertainty still escalates to Host -> Deep rather than turning Advisor into a second Main.

The invariant is: **Advisor corrects through Worker, never instead of Worker.**

## Harness layering

Keep the behavioral harness layered and small:

1. **Native runtime / tool surface** — Antigravity owns lifecycle, sessions, workspaces, tool permissions, and subagent execution.
2. **Generic behavioral harness** — `rules/harness.md` defines model-agnostic contract, authority, evidence, verification, escalation, handoff, and completion discipline for the Host. Equivalent core rules are repeated compactly inside each custom subagent because subagent rule inheritance must not be assumed.
3. **Role contract** — `rules/orchestration.md` and each `agents/gravity-*.md` define topology and role-specific responsibilities.
4. **Model-family correction** — small behavioral deltas for a model family.
5. **Role x model overlay** — only where a concrete role/model pairing demonstrates an additional failure mode.

Do not duplicate a complete role prompt in a model-specific overlay merely to change a few behavioral rules.

The generic behavioral baseline is model-agnostic and should enforce:

- contract-first behavior
- hard role/scope/authority boundaries
- OBSERVED / INFERRED / UNKNOWN separation
- current-evidence grounding
- acceptance-linked verification
- explicit escalation instead of guessing
- convergence instead of repeated materially similar loops
- compact handoffs instead of transcript replay
- Host-only global completion authority

## Host policy layering

Treat Main as policy, not as another agent definition:

1. **Native Host** — Antigravity Default agent owns the primary session and platform lifecycle.
2. **Generic behavioral harness** — `rules/harness.md` supplies the model-agnostic operating discipline.
3. **Generic orchestration policy** — `rules/orchestration.md` defines routing, spawn authority, delegation, correction, and review flow.
4. **Model-specific Host correction** — add a small model-family rule only when a fallback Host needs behavioral correction.

Do not create a custom `gravity-main.md` merely to apply model-specific prompting.

## Spawn authority

Keep the graph shallow and explicit:

1. The Host may invoke Worker, Explorer, Deep, and Reviewer.
2. Ordinary implementation goes from Host directly to Worker.
3. Worker is the only Native Gravity subagent with nested delegation authority.
4. Worker may invoke **gravity-advisor only**.
5. Advisor, Explorer, Deep, and Reviewer are leaf agents and must not invoke subagents.
6. Advisor cannot edit project source or certify final task completion.
7. Worker cannot report `READY` until an Advisor `CHECK` returns `VERDICT: ACCEPT` for the current implementation state.
8. Final review and completion remain Host-owned; Advisor acceptance is not Reviewer approval.

This is a bounded two-level implementation loop, not a recursive swarm.

## Advisor gate

Worker uses Advisor in two modes:

- **ADVISE** — bounded implementation judgment when Worker has a concrete question but no Deep-level uncertainty.
- **CHECK** — mandatory local acceptance gate before Worker may report `READY`.

For `CHECK`:

- `VERDICT: REVISE` returns concrete implementation-local defects to Worker.
- Worker repairs them and requests CHECK again.
- `VERDICT: ACCEPT` allows Worker to report local `READY`.
- `NEEDS_DEEP` stops the local loop and returns control through Worker to Host for Deep routing.

Repeated materially similar REVISE cycles must converge or escalate; do not ping-pong indefinitely.

## Why Explorer bypasses Worker

Explorer does not execute implementation work. It returns information the Host needs to decide what to do, so an intermediate execution owner adds cost without useful authority.

Use Explorer for questions such as where behavior lives, what files participate in a path, what patterns already exist, and what current implementation evidence is available. Use Deep instead when the problem is not merely locating facts but deciding what those facts mean or how an uncertain problem should be solved.

## Why Main stays native

The Host role is fundamentally coordination policy over capabilities Antigravity already owns: the primary session, subagent invocation, lifecycle, workspaces, and model selection. Duplicating the Default agent as `gravity-main` would add another compatibility and maintenance surface without adding a required capability.

## Design rules

1. Native-first: if Antigravity already owns a lifecycle/runtime capability, do not rebuild it.
2. Keep orchestration depth bounded: Host -> Worker -> Advisor is the only nested implementation path.
3. Keep role and model separate so future model replacement does not require redesigning the graph.
4. Main is a Host policy layer, not a custom Native Gravity agent.
5. Generic behavioral rules must remain model-agnostic; model-specific weaknesses belong in correction overlays.
6. Worker owns implementation and all project-source edits for its bounded contract.
7. Advisor is read-only; it advises, checks, and returns defects to Worker rather than fixing them itself.
8. Worker cannot self-certify local readiness; current-state Advisor acceptance is required.
9. Explorer gathers evidence directly for the Host and remains read-only.
10. Deep is triggered by uncertainty, diagnosis, ambiguity, or trade-offs — not merely by task size.
11. Reviewer is independent and blocker-focused. It does not modify files.
12. Prefer prompt/rule/configuration changes over new runtime code when AGY-native primitives are sufficient.
13. Do not add persistent coordination state, custom packet builders, shell runtime wrappers, or quota routing in v0.3.1.

## Validation

Issue #9 owns behavioral validation. v0.3.1 must explicitly verify:

- generic contract/scope adherence across every role
- Default Host -> Worker invocation for ordinary implementation
- Worker -> Advisor nested invocation
- that Worker can invoke Advisor but no other child
- that Advisor / Explorer / Deep / Reviewer remain leaves
- mandatory Advisor CHECK before Worker `READY`
- REVISE -> Worker repair -> CHECK convergence
- Advisor source-edit prohibition
- Advisor acceptance does not bypass Host-owned Reviewer/final completion
- Explorer usefulness without Worker mediation
- repeated-failure escalation instead of materially similar looping
- compact handoffs without unnecessary transcript replay
- Host behavior under the generic harness and orchestration rule
- completion only after Host-owned current evidence inspection and required Reviewer GO
