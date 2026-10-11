# Prompt-cache design review

**Verdict: REVISE.** Native-first caching and stable prompts are sound principles; the evidence does not yet support this implementation proposal.

## Findings

- **High: OMO behavior is not evidence of NTG/AGY behavior** (design Findings 1-2, A, D). `scripts/ntg-run.mjs:86-87` launches `agy`, not OMO's Anthropic bridge. Keep OMO as comparative evidence, not an inherited cache guarantee. The reported protobuf strings establish compiled schema presence, not an active Vertex cache, its defaults, or which backend serves NTG. `CLAUDE_CODE_PROMPT_CACHE_TTL` has no demonstrated AGY consumer.
- **High: the existing digest is fictional** (C). `scripts/ledger.mjs:1596-1622` returns full state, including candidate maps and verification history; `getState()` aliases it. Repository search found no `ledger-status` or `read_state` implementation. The few-hundred-token claim is unmeasured. Tool output also enters conversation history and can subsequently be cached; moving state to a tool does not remove it from all cached prefixes.
- **Medium: prefix semantics need correction** (B). Appending a changing suffix does not itself invalidate an unchanged, eligible cached prefix; rewriting earlier content does. Anthropic orders tools before system before messages, so tool schemas/order matter too. Demoted file reads can become cacheable history. The claimed AGY prompt order, hook-config inclusion, deduplication, and dominant system-prefix cost need actual payload/usage evidence. TTL alone does not establish hits: model minimums and breakpoint placement/lookback also matter ([cache semantics](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
- **Medium: the budget guard is not yet grounded** (B.1, next step). Cite the AGY loader's exact budget, token accounting, and contributing inputs first. A `rules/`-only check cannot establish an aggregate per-session bound including other applicable instructions. File bytes/lines are not tokens. This checkout also has no `npm run check` script (`package.json`).
- **Low: pricing and lane statements are too broad.** Anthropic writes cost **1.25x for 5m, 2x for 1h**, not 12.5x; reads are model-dependent ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)). OMO's `prompt-cache-ttl.js:19-28` honors explicit TTL/5m overrides; even ambient can return a TTL when explicitly configured.

## Better first step

Correct these claims, then measure the **actual NTG/AGY route**: record version/model, compare cold and repeated warm turns with fixed tools/instructions, then append a ledger update. Capture cache-read/write counters where exposed, input size, latency, and available serialized-prefix hashes. Include a fresh child/session boundary; do not assume parent cache reuse. If AGY exposes no cache telemetry, retain UNKNOWN rather than treating latency as proof. Only then choose a loader-grounded size guard or a specific prompt-instability fix. Re-pinning an existing OMO default is not the first NTG feature.

## Open questions

1. **AGY user controls:** unresolved. Reported strings and missing help flags prove neither a supported control nor “internal-only.” `agy` was not on this review environment's PATH; no live cache behavior was verified.
2. **Oh My Pi compaction:** borrow stable tool/system serialization and preservation of unchanged history, not a new NTG compactor. In `oh-my-pi: packages/agent/src/append-only-context.ts:347-376`, shorter history clears/replays the log; other rewrites preserve the longest matching prefix. Compaction is not cache-transparent. `StablePrefix.build():139-160` also rebuilds when the fingerprint changes, rather than freezing configuration forever.
3. **Ledger digest tool:** potentially useful for context size, not required for cache correctness. First measure existing bounded milestone packets (`scripts/spine.mjs:150,221`). If needed, expose a bounded, versioned read-only summary with references to authoritative details; do not truncate authoritative persistence or claim a tool guarantees agents never inline state.

Review only: source inspection and primary documentation; no implementation changes or runtime tests.
