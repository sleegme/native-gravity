# AGENTS.md

## Project intent

Native Gravity is a thin Antigravity-native orchestration plugin. Use Antigravity's own primary agent, subagent lifecycle, session management, model tiers, delegation primitives, and rule system instead of recreating OMO/OpenCode runtime machinery.

## v0.3 development topology

The Antigravity **Default agent** is the Host/coordinator for v0.3. Native Gravity does not define a separate `gravity-main` agent; Main behavior is expressed as policy applied to the native Host.

```text
Host (Antigravity Default agent + Native Gravity rules)
├─ Advisor
│  └─ Worker(s)
├─ Explorer
├─ Deep
└─ Reviewer
```

- **Advisor** — bounded local orchestrator for implementation work. It decomposes Host contracts, delegates only to Worker, and integrates compact Worker results.
- **Worker** — execution leaf. It edits and verifies only the bounded implementation packet received from Advisor.
- **Explorer** — read-only discovery leaf. It gathers codebase structure, current-state evidence, and candidate locations directly for the Host.
- **Deep** — read-only reasoning leaf for ambiguity, diagnosis, and technical trade-offs.
- **Reviewer** — read-only independent quality gate for delivered artifacts and evidence.

Recommended v0.3 model mapping:

- Host: Claude Sonnet 4.6 as the active Antigravity session model.
- Advisor: Antigravity `pro` tier (Gemini 3.1 Pro in the current v0.3 mapping).
- Worker: Antigravity `flash` tier (Gemini 3.7 Flash in the current v0.3 mapping).
- Explorer: Antigravity `flash` tier (Gemini 3.7 Flash in the current v0.3 mapping).
- Deep: Antigravity `pro` tier (Gemini 3.1 Pro in the current v0.3 mapping).
- Reviewer: Antigravity `pro` tier (Gemini 3.1 Pro in the current v0.3 mapping).

Role contracts remain conceptually separate from model identity. Model-family corrections and role x model overlays are tracked in issue #9.

## Harness layering

Keep the behavioral harness layered and small:

1. **Native runtime / tool surface** — Antigravity owns lifecycle, sessions, workspaces, tool permissions, and subagent execution.
2. **Generic behavioral harness** — `rules/harness.md` defines model-agnostic contract, authority, evidence, verification, escalation, handoff, and completion discipline for the Host. Equivalent core rules are repeated compactly inside each custom subagent because subagent rule inheritance must not be assumed.
3. **Role contract** — `rules/orchestration.md` and each `agents/gravity-*.md` define topology and role-specific responsibilities.
4. **Model-family correction** — small behavioral deltas for a model family, such as the planned Gemini corrections.
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
4. **Model-specific Host correction** — add a small model-family rule only when a fallback Host needs behavioral correction. The planned Gemini fallback layer belongs in `rules/models/gemini-host.md`; it must remain a correction delta rather than a duplicated Main prompt.

Do not create a custom `gravity-main.md` merely to apply model-specific prompting. A custom Main should only be reconsidered in a future version if a concrete capability or isolation requirement cannot be expressed through Antigravity's native Host plus rules.

## Spawn authority

Keep the graph shallow and explicit:

1. The Host may invoke Advisor, Explorer, Deep, and Reviewer.
2. Ordinary implementation must go through Advisor. The Host should not invoke Worker directly.
3. Advisor is the only Native Gravity subagent with nested delegation authority.
4. Advisor may invoke **gravity-worker only**. It must not invoke Explorer, Deep, Reviewer, Advisor, `self`, `research`, or arbitrary dynamic subagents.
5. Worker, Explorer, Deep, and Reviewer are leaf agents and must not invoke subagents.
6. Advisor cannot certify final task completion. Final review and completion remain Host-owned.

This is a bounded two-level orchestration design, not a recursive swarm.

## Why Explorer bypasses Advisor

Explorer does not execute implementation work. It returns information the Host needs to decide what to do, so an intermediate execution coordinator adds cost without adding useful authority.

Use Explorer for questions such as where behavior lives, what files participate in a path, what patterns already exist, and what current implementation evidence is available. Use Deep instead when the problem is not merely locating facts but deciding what those facts mean or how an uncertain problem should be solved.

## Why Main stays native

The Host role is fundamentally coordination policy over capabilities Antigravity already owns: the primary session, subagent invocation, lifecycle, workspaces, and model selection. Duplicating the Default agent as `gravity-main` would add another compatibility and maintenance surface without adding a required v0.3 capability.

Runtime validation from v0.2 also showed that custom-primary delegation could behave differently from the Default agent. v0.3 therefore avoids making custom-Main behavior a release dependency at all: Native Gravity controls Main behavior through rules and keeps the primary agent native.

## Design rules

1. Native-first: if Antigravity already owns a lifecycle/runtime capability, do not rebuild it.
2. Keep orchestration depth bounded: Host -> Advisor -> Worker is the only nested implementation path.
3. Keep role and model separate so future model replacement does not require redesigning the graph.
4. Main is a Host policy layer, not a custom Native Gravity agent.
5. Generic behavioral rules must remain model-agnostic; model-specific weaknesses belong in correction overlays.
6. Advisor plans/delegates bounded execution but does not edit project source or perform final review.
7. Worker executes; it does not redesign the task, spawn agents, or self-certify overall completion.
8. Explorer gathers evidence directly for the Host and remains read-only.
9. Deep is triggered by uncertainty, diagnosis, ambiguity, or trade-offs — not merely by task size.
10. Reviewer is independent and blocker-focused. It does not modify files.
11. Prefer prompt/rule/configuration changes over new runtime code when AGY-native primitives are sufficient.
12. Do not add persistent coordination state, custom packet builders, shell runtime wrappers, or quota routing in v0.3.

## Validation

Issue #9 owns v0.3 behavioral validation. In addition to model-specific harness behavior, explicitly verify:

- generic contract/scope adherence across every role
- OBSERVED / INFERRED / UNKNOWN separation on ambiguous tasks
- unsupported success-claim rate and evidence grounding
- Default Host -> Advisor invocation
- Advisor -> Worker nested invocation
- that Advisor does not route to non-Worker children
- that Worker / Explorer / Deep / Reviewer remain leaves
- that the Host does not bypass Advisor for ordinary implementation
- Explorer usefulness without Advisor mediation
- bounded parallel Worker delegation without overlapping write scopes
- repeated-failure escalation instead of materially similar looping
- compact handoffs without unnecessary transcript replay
- Host behavior under the generic harness and orchestration rule
- Gemini fallback Host behavior once the model-specific correction layer exists
- completion only after Host-owned current evidence inspection and required Reviewer GO
