# Prompt-cache design - final review

**Verdict: REVISE (doc-only).** The bottom line - NTG needs no new caching machinery - holds, and today's raw data make it stronger. But the measurement table is misread, the Gemini conclusion is contradicted by this repo's own evidence, and the one behavioral recommendation ("prefer Claude lanes for multi-turn work") is unsupported and conflicts with the v0.4 model map. Five edits make it final; no new tooling or research is needed.

Reviewed: the revised design, `prompt-cache-design-review.md`, the per-step transcripts behind today's measurements (`~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl`), the #113 live-probe transcripts and `results.jsonl`, `agents/*.md` frontmatter, `rules/*.md`, `scripts/runner.mjs`, `agy-1-3-1/side-probe.md`, and the Oh My Pi source.

## 1. Are the measured numbers interpreted correctly? Partly.

The design's numbers trace to four sessions from today. Per-call records:

| Session | Lane | Call | input | cache_read | out | prompt (input + cache_read) |
|---|---|---|---|---|---|---|
| `60dafc66` | Claude Opus 5.5 Low | turn 1, 11:51:41Z | 9,434 | 13,083 | 4 | 22,517 |
| `60dafc66` | same conversation | turn 2, 11:51:54Z | **556** | **22,247** | 4 | 22,803 |
| `5183dd39` | Claude, fresh conversation | turn 1, 11:52:06Z | 9,433 | 13,083 | 5 | 22,516 |
| `caf582c2` | Gemini Pro (matches design row) | turn 1 / turn 2 | 14,554 / **14,940** | 0 / 0 | 172 / 166 | - |
| `54d12f66` | Gemini Flash (matches design row) | turn 1 / turn 2 | 14,300 / **14,504** | 0 / 0 | 1 / 1 | - |

- **The "warm" rows are conversation totals, not per-turn values.** The CLI's `--output-format json` `usage` adds up every step in the conversation: 9,434 + 556 = 9,990; 13,083 + 22,247 = 35,330; 4 + 4 = 8, giving a total of 9,998. For Flash, 14,300 + 14,504 = 28,804. The table mixes single-call cold rows with cumulative warm rows. The "total" column is input + output and excludes cache_read, so it isn't prompt size either.
- **The warm Claude turn paid 556 new tokens and read 22,247 from cache (97.6% of its prompt).** "Warm turns add conversation history to the cache (~22k more tokens)" is wrong. Turn 1's conversation-specific content is 22,247 - 13,083 = 9,164 tokens; the ~22k figure is simply turn 2's total read.
- **Cold turn, cache_read 13,083 > input 9,434: the design's reading is right.** The first 13,083 tokens matched a cache entry that existed before this conversation started. The fresh conversation reading exactly 13,083 again confirms it.
- **The cache_read counter does not include cache-write bytes.** AGY's usage schema has no write field (`input_tokens, output_tokens, thinking_tokens, cache_read_tokens, total_tokens`; see `113-live-probe/results.jsonl`), so writes are folded into `input_tokens`.
  - Proof: turn 2 read 9,164 tokens beyond the shared prefix, and only turn 1 could have written them.
  - Turn 2's prompt (22,803) is all of turn 1 plus 286 tokens, so turn 1 can't have had thousands of unreported write tokens.
  - Therefore at least 9,164 of turn 1's 9,434 "input" tokens were cache writes. Under API pricing those cost 1.25x or 2x, not 1x.
- **Qualifiers on the cold-turn reading:**
  - "Globally" can only mean the provider cache scope of the account AGY's backend uses. Whether this user or another AGY user wrote the prefix is UNKNOWN.
  - In these runs nothing after the 13,083-token prefix was shared across conversations. `5183dd39` started 12 s after `60dafc66` had written its ~9.2k block and still read only 13,083. The first user message carries a per-conversation timestamp and model-selection notice, and AGY decides where cache breakpoints go. NTG can change neither.
- **The Pro row "(any turn)" hides a different warm value:** the warm call was 14,940 tokens.

## 2. Is hygiene-only correct? Yes on the outcome, but the reasons are wrong and one recommendation should go

- **Drop "prefer Claude lanes for anything multi-turn"** (B.3 and the recommended next step). Do not file a lane-preference rule.
  - Its Gemini premise is false (see section 3).
  - Cache-hit rate is something to improve within one model; it can't decide between models. Per-model price, quota and capability dominate. The Claude 2-turn session processed 45,320 prompt tokens (at least 9,164 of them write-priced) against Flash's 28,804. AGY also meters plan quota rather than API-priced tokens (INFERRED).
  - It contradicts the AGENTS.md role/model map ("fit roles to model behavior").
  - It can't be implemented for subagents. `model:` accepts only `inherit | flash | pro` (`agy-1-3-1/side-probe.md`), 8 of 9 agents pin `flash` or `pro`, and only `bulldozer.md` uses `inherit`. A lane-preference rule would be a model-map change presented as cache hygiene.
- **B.1 overstates the cost of editing rules.**
  - An edit does not invalidate the prefix "for every subsequent turn in every session". It forces one re-write from the edit point onward, per cache scope, per TTL window; later turns hit the cache again.
  - As of #113, AGY loaded the installed plugin snapshot (`~/.gemini/config/plugins/native-gravity`, imported 2026-09-30). Edits to `agents/` and `rules/` in the repo don't reach the prompt until the plugin is re-imported.
  - Everything after the 13,083-token prefix is re-processed on every new conversation anyway.
  - "Batch rule edits" is therefore worth almost nothing: keep it as one line or drop it.
- **Sections 3 and A are not established for NTG agents.**
  - The runs used AGY's default agent (no `--agent`). Custom agents get different prompts: in #113, Bulldozer's first Flash call was 9,883 tokens against 14,302 for the default agent.
  - `rules/*.md` are `trigger: always_on`, so they plausibly load. Whether they sit inside the 13,083-token shared prefix is UNKNOWN, and there is no evidence that all nine agent bodies are injected.
  - NTG's default lanes are Gemini (flash and pro tiers). "Claude-backed NTG lanes" only exist when Bulldozer runs with `--model claude-*`.
  - Fix: scope section A to "AGY default agent on Claude" and mark the claim that NTG content sits in the prefix as UNKNOWN. Optionally, one cold+warm pair with `ntg-run --agent bulldozer --model claude-opus-5-5-low` would make it OBSERVED.
- **B.2 (keep volatile data out of AGENTS.md and rules) is correct and already true.** A grep of `rules/*.md`, `agents/*.md` and `AGENTS.md` finds no dates or template markers. AGY itself puts volatile data (local time, settings notices, resume notices) in the newest message, which doesn't break the cache. Keep it as a review-checklist line.
- **Don't file a prefix-stability CI check.**
  - The failure it guards against has never been observed.
  - The files are hand-edited and change only through reviewed commits.
  - A violation costs one re-write.
  - A check couldn't see how AGY actually serializes the prompt.
- **No NTG code change is warranted.**
  - `runner.mjs:433` passes `parsed.usage` through without adding it up and never resumes a conversation, so the cumulative semantics cause no bug today.
  - The one lever the data reveal is the number of sessions. Every new conversation pays a cold start: about 9.4k new tokens on Claude, and several uncached calls on Gemini. Fewer, longer sessions cache better.
  - That is an orchestration trade-off already governed by AGENTS.md routing. Note it; don't file it.
- **The "~18k demotion threshold" is still unsourced.** The previous review raised this too.

## 3. Gemini cache_read = 0: a real miss or an empty counter? Neither, as the design states it

- **The counter is populated on Gemini lanes.** The #113 transcripts (2026-10-10) contain non-zero Gemini values.
  - Jaguar child `e5a8b5be`: its parent ran `--model gemini-3.8-flash-medium` and `jaguar.md` is `model: flash`. Its first six calls (steps 1-11, 56 s) read 0. From step 13 on, each call read almost the whole previous prompt: 21,013 (exactly step 11's prompt), 23,181 (exactly step 13's), and so on up to 48,394. That is 70-95% of each call's prompt, mostly above 90%.
  - Bobcat child `68a9cb5b` (`model: flash`) missed four calls, then read 11,688.
  - `13d2490b`, `2dcc4bf6` and `24509e77` also show non-zero reads; I didn't re-verify their models.
- **Flash on AGY does cache, but only after a warm-up of several calls.** A 2-call probe only ever sees the warm-up. So "Gemini lanes get no cache benefit at all" and "confirmed by measurement, not just unpopulated counter" are both wrong: the counter is real, the conclusion isn't. Gemini Pro is UNKNOWN, because only sessions of 2 calls or fewer were observed.
- **How NTG can tell the cases apart:**
  - (a) Whether the counter is populated: any non-zero `cache_read_tokens` in a lane's per-step records. Flash already passes.
  - (b) Whether caching is absent or just warming up: run one session of 8 or more sequential tool calls per lane, or mine the existing per-step transcripts on this host (joined to the launch argv for the model). No new tooling is needed.
  - Always use the per-step `transcript.jsonl` records, never the cumulative CLI `usage`. Latency is supporting evidence only.
  - A direct-API control isn't needed. If anyone wants one, note that `studio-runner.mjs` currently drops `usageMetadata.cachedContentTokenCount`.

## 4. Verdict: REVISE - what still fails

1. **Measurement table and section 2 text.** Replace the warm rows with per-call values and label the CLI `usage` as conversation-cumulative. Fix "history adds ~22k" and "28.8k vs 10k". State that `input_tokens` includes cache writes. Relabel or drop "total".
2. **Gemini claims** (section 2 bullet, B.3, open question 1). Replace with: the counter is populated, Flash caches after a multi-call warm-up, and Pro is UNKNOWN. Cite the #113 sessions.
3. **Remove "prefer Claude lanes"** from B.3 and from the recommended next step.
4. **Scope section A and section 3 to the default agent.** Mark NTG-content-in-prefix as UNKNOWN, and correct B.1's invalidation claim, including the installed-snapshot caveat.
5. **Cite the raw evidence:** session IDs `60dafc66`, `5183dd39`, `caf582c2`, `54d12f66` and the transcript path. Or copy them into `.omo/evidence/`, per the OBSERVED/INFERRED/UNKNOWN rule.

Minor fixes:
- The doc still calls Oh My Pi's `StablePrefix` "frozen". It is rebuilt when its fingerprint changes (`append-only-context.ts:95`); the previous review already pointed this out.
- `compact-2026-09-04` exists in Oh My Pi's source (`packages/ai/src/providers/anthropic-wire.ts:172`). It is comparative only, because agy builds the requests and NTG can't set it.

Unchanged and sound:
- Section 1 (OMO is not NTG's path).
- The ledger-digest and pricing corrections.
- The prefix-append semantics.
- Section C.
- "Nothing to build".

After the five edits the design can be approved without further measurement.
