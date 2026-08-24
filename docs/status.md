# Status

Native Gravity is currently **v0.2 / experimental**.

## Implemented in v0.2

- plugin-only Antigravity architecture
- four-role agent set: Main / Worker / Deep / Reviewer
- recommended Sonnet 4.6 host model for Main
- native `flash` Worker tier
- native `pro` Deep and Reviewer tiers
- Deep defined by uncertainty/diagnosis rather than task size
- read-only blocker-focused Reviewer
- focused research folded into existing roles instead of dedicated Explore/Librarian agents
- shell wrapper CLI and review-packet plumbing removed
- persistent `.oma/` coordination state removed
- risk-gated review policy

## Validation split

The structural v0.2 work is complete. Real Antigravity runtime validation is tracked in issue #3, including discovery, native delegation, correction/session reuse, and representative coding tasks.

## v0.3

Issue #2 tracks a direct Google AI Studio execution path. It should remain an additional execution lane rather than replacing Antigravity's native runtime.

## Design rule going forward

Do not add orchestration machinery merely because it is possible. Add code only when repeated real AGY failures demonstrate that prompts, roles, rules, native subagents, or MCP cannot solve the problem cleanly.
