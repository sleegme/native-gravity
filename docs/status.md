# Status

Native Gravity is currently **v0.2.1 / experimental**.

## Implemented in v0.2.1

- Antigravity Default agent retained as the host/coordinator
- former Main behavior moved into `rules/orchestration.md`
- three specialized subagents: Worker / Deep / Reviewer
- recommended Sonnet 4.6 host model
- native `flash` Worker tier
- native `pro` Deep and Reviewer tiers
- named delegation envelope for subagent calls
- Worker terminal signals: `DONE` / `BLOCKED` / `NEEDS_DEEP`
- Deep returns a concrete implementation contract rather than editing source
- Reviewer keeps deterministic `VERDICT: GO` / `VERDICT: NO-GO`
- shell wrapper CLI, review-packet plumbing, and persistent coordination state remain absent
- risk-gated review policy

## Why v0.2.1 changed the host architecture

The v0.2 bootstrap reproduced the same `invoke_subagent` failure from the custom `gravity-main` primary agent against plugin agents, a workspace custom agent, and built-in `research`:

`subagent "<name>" not found or not allowed to be invoked`

The Antigravity Default agent successfully invoked built-in `research` in the same environment. v0.2.1 therefore keeps the native Default agent as host and treats the former Main contract as policy/rules.

This is a compatibility workaround based on observed runtime behavior, not a declaration that custom-primary delegation is intentionally unsupported.

## Validation still required

Issue #3 remains the runtime gate. Before v0.2.1 is considered validated, test from the Default agent:

1. invoke `gravity-worker` on a bounded read-only task
2. invoke `gravity-deep` on a diagnostic task
3. invoke `gravity-reviewer` on a supplied task contract
4. exercise Worker `NEEDS_DEEP` escalation
5. exercise Reviewer GO/NO-GO and correction routing
6. repeat the Native Gravity bootstrap using the native host path

## v0.3

Issue #2 tracks a direct Google AI Studio execution path. It should remain an additional execution lane rather than replacing Antigravity's native runtime.

## Design rule going forward

Do not add orchestration machinery merely because it is possible. Add code only when repeated real AGY failures demonstrate that prompts, roles, rules, native subagents, or MCP cannot solve the problem cleanly.
