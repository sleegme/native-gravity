# AGENTS.md

## Project intent

Native Gravity is a thin Antigravity-native orchestration plugin. Use Antigravity's own primary agent, subagent lifecycle, session management, model tiers, delegation primitives, and rule system instead of recreating OMO/OpenCode runtime machinery.

## v0.2.1 design

The Antigravity **Default agent** is the host/coordinator. Native Gravity adds orchestration policy through a plugin rule and exposes three specialized subagents:

- **Worker** — executes clear, bounded subtasks.
- **Deep** — resolves ambiguity, diagnosis, and technical trade-offs before execution.
- **Reviewer** — independently verifies correctness and requirements.

Recommended model mapping:

- Host: Claude Sonnet 4.6 as the active Antigravity session model.
- Worker: Antigravity `flash` tier.
- Deep: Antigravity `pro` tier.
- Reviewer: Antigravity `pro` tier.

## Why no custom Main agent

Runtime validation for v0.2 showed that a selected custom primary agent could declare `invoke_subagent` yet fail to invoke even the built-in `research` subagent, while the Default agent could invoke `research` successfully. v0.2.1 therefore keeps orchestration on the native Default agent and moves the former Main behavior into rules.

Treat this as a compatibility decision based on observed runtime behavior, not as a claim that Antigravity intentionally forbids custom-primary delegation.

## Design rules

1. Native-first: if Antigravity already owns a lifecycle/runtime capability, do not rebuild it.
2. Keep the specialized subagent set at three unless real failures justify another role.
3. Keep role and model separate. Agent contracts should survive future model changes.
4. The host may do trivial or integration-sensitive edits; ordinary bounded implementation goes to Worker.
5. Deep is triggered by uncertainty, diagnosis, ambiguity, or trade-offs — not merely by task size.
6. Reviewer is independent and blocker-focused. It does not modify files.
7. Focused research/discovery is a mode of the host/Worker/Deep, not a dedicated Native Gravity agent.
8. Do not add persistent coordination state, custom packet builders, shell runtime wrappers, or quota routing in v0.2.1.
9. Prefer prompt/rule/configuration changes over new code when AGY-native primitives are sufficient.
10. Do not reintroduce a custom Main agent unless runtime evidence shows a concrete benefit and reliable delegation.

## Validation

Runtime validation is tracked in issue #3. v0.2.1 must specifically verify Default-agent invocation of `gravity-worker`, `gravity-deep`, and `gravity-reviewer` before the architecture is considered validated.
