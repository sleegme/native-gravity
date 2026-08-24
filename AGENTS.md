# AGENTS.md

## Project intent

Native Gravity is a thin Antigravity-native orchestration plugin. Use Antigravity's own agent runtime, subagent lifecycle, session management, model tiers, and delegation primitives instead of recreating OMO/OpenCode runtime machinery.

## v0.2 design

- **Main** — owns the task and coordinates execution.
- **Worker** — executes clear, bounded subtasks.
- **Deep** — resolves ambiguity, diagnosis, and technical trade-offs before execution.
- **Reviewer** — independently verifies correctness and requirements.

Recommended model mapping:

- Main: Claude Sonnet 4.6 as the host/session model (`gravity-main` uses `model: inherit`).
- Worker: Antigravity `flash` tier.
- Deep: Antigravity `pro` tier.
- Reviewer: Antigravity `pro` tier.

## Design rules

1. Native-first: if Antigravity already owns a lifecycle/runtime capability, do not rebuild it.
2. Keep the agent set at four unless real failures justify another role.
3. Keep role and model separate. Agent contracts should survive future model changes.
4. Main may do trivial or integration-sensitive edits; ordinary bounded implementation goes to Worker.
5. Deep is triggered by uncertainty, diagnosis, ambiguity, or trade-offs — not merely by task size.
6. Reviewer is independent and blocker-focused. It does not modify files.
7. Focused research/discovery is a mode of Main/Worker/Deep, not a dedicated agent in v0.2.
8. Do not add persistent coordination state, custom packet builders, shell runtime wrappers, or quota routing in v0.2.
9. Prefer prompt/configuration changes over new code when AGY-native primitives are sufficient.

## Validation

Runtime validation is tracked separately in issue #3. Keep v0.2 implementation itself plugin-only and cross-shell/platform neutral.
