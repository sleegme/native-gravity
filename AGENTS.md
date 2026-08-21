# AGENTS.md

## Project intent

oh-my-agy is a small Antigravity-native harness. Prefer native Antigravity agents, subagent lifecycle, model tiers, and headless CLI features over recreating OpenCode/OMO runtime machinery.

## Design rules

1. Keep the curated agent set small. Do not add a persona when a category or prompt mode is enough.
2. Keep role, category, model, and reasoning as separate concepts.
3. Main coordinates; implementation workers edit; review judges.
4. Completion requires evidence: relevant diff plus tests/build/run output where applicable.
5. Review is blocker-focused, read-only, and ends with `VERDICT: GO` or `VERDICT: NO-GO`.
6. Reuse an idle subagent session for correction/re-review when Antigravity can re-awaken it; avoid throwing away useful context.
7. Do not introduce automatic quota routing until real usage data demonstrates a need.
8. Do not copy upstream OMO prompts verbatim. Adapt behavioral ideas to Antigravity-native tools and constraints.
9. `writing` is Flash-only. If a writing task needs expensive reasoning, run that reasoning separately and pass the resulting facts/decisions back to Flash for prose generation.

## Current routing assumption

- Flash: quick, unspecified-low, ordinary implementation, **all writing**, Explore, Librarian.
- Pro: deep, ultrabrain, visual-engineering, artistry, unspecified-high, architect, complex non-writing implementation.
- Sonnet 4.6: main/orchestration.
- Opus 4.6: final review and exceptional escalation; Pro is review fallback.

## Validation

Before changing agent frontmatter, verify tool names and model-tier support against current Antigravity documentation. Unknown tool names can hang custom subagents.

Run `oma smoke` after agent/plugin changes. Use `oma smoke --live` only when intentionally spending a small amount of quota for an end-to-end probe.
