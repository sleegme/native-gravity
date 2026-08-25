# AGENTS.md

## Project intent

Native Gravity is a thin Antigravity-native orchestration plugin. Use Antigravity's own primary agent, subagent lifecycle, session management, model tiers, delegation primitives, and rule system instead of recreating OMO/OpenCode runtime machinery.

## v0.3 development topology

The Antigravity **Default agent** remains the Host/coordinator until custom-Main delegation is revalidated. Native Gravity v0.3 develops five specialized roles with a deliberately shallow graph:

```text
Host
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
- Worker: Antigravity `flash` tier.
- Explorer: Antigravity `flash` tier.
- Deep: Antigravity `pro` tier.
- Reviewer: Antigravity `pro` tier.

Role contracts remain conceptually separate from model identity. Model-family corrections and role x model overlays are tracked in issue #9.

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

## Why no custom Main agent yet

Runtime validation for v0.2 showed that a selected custom primary agent could declare `invoke_subagent` yet fail to invoke even the built-in `research` subagent, while the Default agent could invoke `research` successfully. Keep the Default-host compatibility path until issue #9 re-tests current Antigravity behavior under a minimal controlled configuration.

Treat this as a compatibility decision based on observed runtime behavior, not as a claim that Antigravity intentionally forbids custom-primary delegation.

## Design rules

1. Native-first: if Antigravity already owns a lifecycle/runtime capability, do not rebuild it.
2. Keep orchestration depth bounded: Host -> Advisor -> Worker is the only nested implementation path.
3. Keep role and model separate so future model replacement does not require redesigning the graph.
4. Advisor plans/delegates bounded execution but does not edit project source or perform final review.
5. Worker executes; it does not redesign the task, spawn agents, or self-certify overall completion.
6. Explorer gathers evidence directly for the Host and remains read-only.
7. Deep is triggered by uncertainty, diagnosis, ambiguity, or trade-offs — not merely by task size.
8. Reviewer is independent and blocker-focused. It does not modify files.
9. Prefer prompt/rule/configuration changes over new runtime code when AGY-native primitives are sufficient.
10. Do not add persistent coordination state, custom packet builders, shell runtime wrappers, or quota routing in v0.3.

## Validation

Issue #9 owns v0.3 behavioral validation. In addition to model-specific harness behavior, explicitly verify:

- Host -> Advisor invocation
- Advisor -> Worker nested invocation
- that Advisor does not route to non-Worker children
- that Worker / Explorer / Deep / Reviewer remain leaves
- that the Host does not bypass Advisor for ordinary implementation
- Explorer usefulness without Advisor mediation
- bounded parallel Worker delegation without overlapping write scopes
- completion only after Host-owned evidence inspection and required Reviewer GO
