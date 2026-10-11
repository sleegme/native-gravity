# NTG/AGY Prompt Cache Design

**Status:** final — 2026-10-11 (two review rounds: `prompt-cache-design-review.md` REVISE → fixed, `prompt-cache-design-final-review.md` REVISE → fixed; reviewer stated "after the five edits the design can be approved")
**Requester:** PO (`sleeg`) via Discord `#native-gravity`
**Scope:** cache-hit strategy for NTG/AGY turns (rules, ledger, agent context)

## Findings

### 1. OMO runtime uses Anthropic prompt caching — but NTG does not run it

`anthropic-subscription` lane pins `CLAUDE_CODE_PROMPT_CACHE_TTL=1h` via
`prompt-cache-ttl.js` and stamps `cache_control: {type:"ephemeral", ttl:"1h"}`
on the replayed-history breakpoint (`prompt-bridge.js:markCacheBreakpoint`).
However **`scripts/ntg-run.mjs:86-87` launches `agy` directly**, not OMO's
Anthropic bridge — OMO behaviour is comparative evidence, not a guarantee
for NTG.

### 2. AGY's own caching is confirmed by live measurement (2026-10-11)

`agy --print --output-format json` exposes `usage.cache_read_tokens`.
**Caution: the CLI `usage` field is conversation-cumulative**, not per-turn.
Per-call values below come from the per-step transcripts
(`~/.gemini/antigravity-cli/brain/<session>/.system_generated/logs/transcript.jsonl`).
Sessions `60dafc66`, `5183dd39` (Claude Opus 5.5 Low), `caf582c2` (Pro),
`54d12f66` (Flash), all on the AGY default agent, cwd `native-gravity`:

| Session | Call | input | cache_read | prompt (in+cr) |
|---|---|---|---|---|
| `60dafc66` Claude | turn 1 cold | 9,434 | 13,083 | 22,517 |
| `60dafc66` Claude | turn 2 warm | **556** | **22,247** | 22,803 |
| `5183dd39` Claude | turn 1 cold | 9,433 | 13,083 | 22,516 |
| `caf582c2` Pro | turn 1 / turn 2 | 14,554 / 14,940 | 0 / 0 | - |
| `54d12f66` Flash | turn 1 / turn 2 | 14,300 / 14,504 | 0 / 0 | - |
| `0ffb7c58` Claude **bulldozer** | turn 1 cold | 8,144 | 7,700 | 15,844 |
| `0ffb7c58` Claude **bulldozer** | turn 2 warm | 586 | 15,559 | 16,145 |
| `94dd6723` Pro | calls 1-2 cold | 14,564 / 17,069 | 0 / 0 | - |
| `94dd6723` Pro | calls 7-31 warm | ~2-4k each | **17,081→34,855** | ~90-95% hit |

- **Claude lane**: a ~13k-token prefix was already cached before these
  conversations started — both fresh conversations read exactly 13,083.
  The warm turn paid **556 new tokens + 22,247 cache reads = 97.6% hit**.
  Turn 1's conversation-specific block (22,247 − 13,083 = 9,164 tokens)
  was written by turn 1 itself.
- **`input_tokens` includes cache writes** — the usage schema has no write
  field, so the ≥9,164 write tokens of turn 1 are inside its 9,434
  "input". Under API pricing writes cost 1.25x/2x, not 1x.
- **Gemini lanes DO cache — after a warm-up.** My 2-call probes only ever
  saw the warm-up. The #113 live-probe transcripts show Flash subagents
  reading 70–95% of each prompt from cache once a session passes several
  calls: e.g. `B1a-bulldozer-jaguar-e5a8b5be` reads 21,013→47,652 from
  step 13 on; `68a9cb5b` reads 11,688 at step 9.
- **Gemini Pro caches too — OBSERVED** (`94dd6723`, 2026-10-11): first
  two calls miss (14,564 + 17,069 input, 0 cached), then steps 7–31 read
  17,081→34,855 tokens from cache (~90-95% of each prompt). Pro warm-up
  is ~2 calls, Flash's is ~6.

### 3. What NTG puts in the prompt

- The measurements above used AGY's **default agent**. Custom NTG agents
  get different prompts: in #113, Bulldozer's first Flash call was 9,883
  tokens vs 14,302 for the default agent.
- `agents/*.md` + `rules/*.md` — 1068 lines total. `rules/*.md` are
  `trigger: always_on` so they plausibly load.
- **OBSERVED via `ntg-run --agent bulldozer --model claude-opus-5-5-low`
  (`0ffb7c58`)**: bulldozer's cold turn reads only 7,700 cached tokens
  (vs 13,083 for the default agent) — the NTG agent prompt replaces part
  of the default prefix, and the shared portion shrinks to ~7.7k.
  Warm turn: 586 new + 15,559 cached. NTG agent content is written
  fresh per conversation, not shared globally.
- Since #113, AGY loads the **installed plugin snapshot**
  (`~/.gemini/config/plugins/native-gravity`, imported 2026-09-30) —
  repo edits to `agents/`/`rules/` don't reach the prompt until
  re-import.
- Ledger state is **not** in the prefix — it is read via tool/file calls
  and lands in conversation history, cached within the conversation.

### 4. Other harnesses

- **Anthropic Claude Code**: `cache_control` breakpoints, 5m default / 1h on
  subscription. Writes cost 1.25x (5m) / 2x (1h) input rate, reads ~0.1x.
- **Oh My Pi (can1357/oh-my-pi)**: `append-only-context.ts` — `StablePrefix`
  (system prompt + tools snapshotted once, **rebuilt when its fingerprint
  changes**, line 95) + `AppendOnlyLog` (messages only grow).
  Per-message digests let rewrites preserve the longest stable prefix.
  Compaction uses Anthropic's `compact-2026-09-04` beta (`anthropic-wire.ts:172`)
  — the summarization request resends the identical bytes so the provider
  cache still hits. Comparative only: agy builds NTG's requests; NTG can't
  set compaction flags.
- **OpenAI Codex CLI / OpenCode / Aider**: not yet researched.

## Corrections applied after review (prompt-cache-design-review.md)

- OMO cache behaviour moved to comparative evidence; NTG's `agy` path
  verified separately.
- `ledger-status`/`read_state` digest claim removed — no such bounded
  reader exists; `toJSON()` returns full state.
- Prefix-cache semantics fixed: appending volatile content at the end
  does NOT break the prefix; rewriting earlier content does. Stable
  ordering matters only for what comes *before* the volatile part.
- Pricing corrected: cache write 1.25x/2x, read ~0.1x (not 12.5x).
- `rules-size` guard suggestion dropped — needs an actual `npm run check`
  target to exist first.
- Second review (`prompt-cache-design-final-review.md`, REVISE→fixed):
  warm rows were conversation-cumulative, not per-turn; Gemini DOES
  cache after warm-up (#113 transcripts); "prefer Claude lanes" removed
  (unimplementable + false premise); claims scoped to default agent;
  `input_tokens` includes cache writes.

## Design

### A. What is already true (measured)

- On AGY's **default agent**, Claude reads a ~13k globally-cached prefix
  even on cold turns, and 97.6% of the warm-turn prompt from cache.
- On **custom agents** (bulldozer measured), the shared prefix shrinks
  to ~7.7k — agent content is per-conversation, cached only within a
  session. Warm turn still hits ~96%.
- Gemini lanes cache ~70-95% of each prompt after warm-up — Flash
  ~6 calls (#113 transcripts), Pro ~2 calls (`94dd6723` measured).
- Nothing to build for basic cache hits — it already works.

### B. What we can still improve

1. **Keep volatile data out of AGENTS.md / rules.** Ledger state,
   current milestone, and blockers must stay in conversation/tool calls,
   not in prefix files. (Already true — no dates/template markers found;
   codify as a review-checklist line.)
2. **Batch rule edits** — minor: an edit forces one re-write from the
   edit point onward per cache scope, then hits again; and repo edits
   don't reach AGY's prompt until the plugin is re-imported anyway.
3. **Fewer, longer sessions cache better** — every new conversation pays
   a cold start (~9.4k new tokens on Claude; several uncached calls on
   Gemini). This is an orchestration trade-off already governed by
   AGENTS.md routing — noted, not filed.

### C. What is NOT needed

- A new NTG-side digest tool for cache correctness — tool results already
  live in history and cache within a conversation. A bounded ledger read
  is still worth doing for *context size*, but that is a separate goal.
- Re-pinning `CLAUDE_CODE_PROMPT_CACHE_TTL` — AGY manages its own
  breakpoints; there is no demonstrated env-var consumer on the `agy` path.

## Recommended next step

None — the mechanism already works on both lanes. No code change, no
lane-preference rule (unimplementable: `model:` accepts only
`inherit|flash|pro`), no prefix-stability CI check (the failure mode
has never been observed, and the files are hand-edited through reviewed
commits).

Measured: `ntg-run --agent bulldozer` cold turn reads 7,700 cached
(vs 13,083 default) — NTG agent content replaces part of the shared
prefix and is written per-conversation.

## Open questions

- Does NTG agent/rules content sit inside the shared prefix?
  (OBSERVED: no — bulldozer's cold read is 7,700 vs 13,083, so agent
  content shrinks the shared portion.)
- Does Gemini Pro cache after warm-up like Flash? (OBSERVED: yes —
  `94dd6723` steps 7-31 read ~90-95% from cache after 2 cold calls.)
- Does AGY expose `PromptCacheOptions`/`ContextCacheConfig` to users?
- Is a bounded `ledger digest` worth building for context size
  (independent of cache hits)?
- Does `compact-2026-09-04` exist on AGY's Anthropic lane?
