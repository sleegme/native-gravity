# Gate Review — PR #199 (fix/zen-quota-fallback; reviewed at 97832d7; base main @ 87bfa17)

Reviewer: omo-native-gate-reviewer (st_01a19b68), 2026-11-02. Read-only worktree `/tmp/ntg-zen-fallback`; this file is the only write.
Report path fallback used (no `.omo/evidence/ulw/<session>/<goalId>/a<attempt>` exists — checked under `~/.omo`, the main repo, and the worktree; no ulw-loop plan), per repo convention `pr-NN-gate-review.md` (same fallback as PR #197 and #198 gate reviews).
`remove-ai-slops` and `programming` skills were not available in this session (available skills: gpt-image-gen, bun-1-4); their documented criteria were applied directly from the gate instructions (results below). No executor-supplied code-review report or manual QA matrix artifact exists for PR #199 (searched repo `.omo/evidence/`, worktree, and senpi-task records); every success claim was therefore reproduced from primary artifacts (git, code, test runs, session transcripts) rather than trusted from prose.

## recommendation: APPROVE

## blockers

None.

## originalIntent

Zen review calls gain a one-shot quota fallback: when the primary policy model (Claude Opus 5.5 High) fails with a genuine exhausted-quota error, `nativeZen` retries exactly once on the policy's `quotaFallback` model (Gemini 4 Argon High); a pinned `NTG_ZEN_MODEL` never falls back; the frozen policy table gains an explicit `quotaFallback` entry with `resolveSlug` support; AGENTS.md documents it; deterministic fake-agy tests cover it.

## desiredOutcome

Zen reviews stop dying for hours when the Opus quota is exhausted (observed 61h+ resets in the wild), by transparently completing the same independent review on the policy-declared Argon High fallback — without weakening any other guarantee: no retry on non-quota failures, no retry loop, no fallback for pinned slugs, escalation-only `resolveSlug` semantics untouched, frozen policy table still frozen, happy path byte-identical.

## userOutcomeReview

**Correctness — PASS.**
- Trigger is genuine-quota only: `scripts/ntg-vnext.mjs:201` gates on `!r.error && r.status !== 0 && !process.env.NTG_ZEN_MODEL && ZEN_QUOTA_ERROR.test(\`${r.stderr}\n${r.stdout}\`)`. Both streams scanned; spawn errors/timeouts excluded; success exits excluded. `ZEN_QUOTA_ERROR = /RESOURCE_EXHAUSTED|Individual quota reached/` (line 46) matches the real observed AGY error, reproduced in session transcripts (2026-10-22, 2026-10-23, and 2026-11-02 in the parent session): `AGY_ERROR: {"short_error":"RESOURCE_EXHAUSTED (code 429): Individual quota reached. ...","status":"RESOURCE_EXHAUSTED",...}`. It is deliberately narrower than `excavator-agy.mjs:387`'s generic 429/rate-limit regex — fallback fires only on subscription-quota exhaustion, not transient rate limits.
- Exactly one retry: a single `if` with one re-`spawnZen()`; no loop (`ntg-vnext.mjs:201-208`).
- Pinned slug never falls back: the `!process.env.NTG_ZEN_MODEL` guard; `resolveZenModel` returns the env pin directly (`ntg-vnext.mjs:166-168`), so a pinned run cannot reach the fallback branch. Proven by test `a pinned NTG_ZEN_MODEL does not fall back on quota`: exactly one call (`calls()` deepEqual `['pinned-slug']`) and the quota error propagates.
- Happy path unchanged: no quota error → one spawn, same args, same parsing. The pre-existing `native Zen is model-pinned by policy and never by --agent` test passes unmodified.
- Args mutation safe: `args` is the literal `['--model', slug, '--output-format', ...]` so `--model` is always index 0; `args[args.indexOf('--model') + 1] = slug` (line 207) overwrites index 1 only; `spawnSync` is synchronous and `args` has no other holder.
- Result attribution: `packet.slug = slug` after the fallback reassignment, so the returned packet names the model actually used (`ntg-vnext.mjs:211`), asserted by test (`result.slug === 'gemini-4-argon-high'`).
- Ledger telemetry does not misreport: `wrappedInvokeZen` prefers the verdict's slug on success (`ntg-vnext.mjs:544` `if (verdict?.slug) slug = verdict.slug;`), so usage rows record the fallback slug. (NOTE on the error path below.)

**Policy integrity — PASS.**
- `resolveSlug` (`runner.mjs:317-327`): `const override = (opts?.escalate && basePolicy?.escalated) || (opts?.quotaFallback && basePolicy?.quotaFallback);` — only instinct defines `escalated`, only zen defines `quotaFallback`, so neither option can move any other role and the two paths cannot combine into a policy neither declares. `escalate: true` on zen stays zen-Opus; `quotaFallback: true` on any other role is a no-op returning the base policy.
- Frozen table stays frozen: `quotaFallback` is `Object.freeze`d (`runner.mjs:45-48`); the override builds a *new* frozen object via spread and never writes `basePolicy` or `ROLE_POLICY_TABLE`.
- Other roles unaffected: `git diff 87bfa17..97832d7` touches no policy entries other than adding zen's `quotaFallback`; the only `resolveSlug` caller passing `quotaFallback` is `nativeZen`.
- Fail-closed preserved: fallback resolution goes through the same `UnresolvedModelSlugError` path (0 or ambiguous matches throw).

**Test quality — PASS.**
- Deterministic: the fake `agy` (`quotaZen`, `tests/test_ntg_vnext.mjs:610-632`) is a plain Node script keyed on argv, recording calls via `appendFileSync`; no sleeps, timers, or timing assumptions anywhere in the new tests.
- Exact sequence asserted: `assert.deepEqual(calls(), ['claude-opus-5-5-high', 'gemini-4-argon-high'])` — primary then fallback slug, in order, exactly two calls (a missing retry throws; a double retry or wrong slug breaks the deepEqual).
- Machine values only: asserts slugs, verdict, call log — no prose/prompt-text pinning.
- Pinned negative case covered (one call, error propagates).
- Not overfit: two tests for one behavior branch each; no test deleted or weakened (32 base tests intact; +2 new).

**Docs — PASS.** `AGENTS.md:104`: "Zen uses Claude Opus 5.5 at High (Gemini 4 Argon High only after an Opus quota error) and has no mutation authority..." — accurate (fallback family/effort resolve to `gemini-4-argon-high`), scoped (fallback is conditional, not a model switch), and consistent with the unchanged "resolving Claude Opus 5.5 at High" policy sentence below it.

**Hygiene — PASS.** `git diff 87bfa17..97832d7` contains exactly the four declared files (`AGENTS.md`, `scripts/ntg-vnext.mjs`, `scripts/runner.mjs`, `tests/test_ntg_vnext.mjs`), one commit, no `/home/`, worktree-path, or `.ntg/` strings; tests use `mkdtemp(tmpdir())`.

**Run — PASS.** `node --check` on both scripts: exit 0. `node --test tests/test_ntg_command.mjs`: **14/14 pass, exit 0** (unchanged from base). `node --test tests/test_ntg_vnext.mjs`: full-suite run reproduced via scoped runs — the full file was exercised in disjoint name-pattern groups, every group exit 0 with pass == tests and fail 0, zero `✖` lines anywhere this session: zen/quota/pinned block **3/3**, `usage telemetry` block **6/6**, all zen-named tests **17/17**, recover/lock **2/2**, timeout/plan/alt/status/bin **7/7**, and the e2e run flows **6/6** (`run --all` 11.5s, `Zen NO-GO stops the run` 12.7s, `fresh-context resume` 10.2s, `material replan` 18.1s, both `disabled repair capability` tests — every name observed `✔`). Total top-level tests in the file is 34 (32 at base + 2 new, counted by `grep -c '^test('` on both commits; the group counts overlap by name and union to the 34); the brief's "expect 36/36" does not match the file on either base or head (see evidence gaps).

**Slop/overfit pass (remove-ai-slops + programming criteria, applied directly).** No deletion-only or removal-verifying tests; no tautologies (the fake transport records real argv, so the assertions can fail); no implementation-mirroring beyond the call-sequence contract, which *is* the user-visible behavior; no prose-pinning. Production side adds no new abstraction — one frozen policy entry, one `resolveSlug` option, one retry branch; no unnecessary parsing/normalization (the regex is a gate, not a parser); scope stays inside the four files. No maintenance burden or false confidence identified. The prior-gate requirement that the code-review report show the same check could not be applied literally (no such artifact exists for PR #199); this section is the direct check performed by the gate itself.

## NOTES (not blockers)

1. No test covers the fallback *not* firing on a non-quota failure (e.g. exit 3 with unrelated stderr). The implementation gates correctly on `ZEN_QUOTA_ERROR`, but a future regression widening the trigger to any non-zero exit would pass the current suite. Not tied to a stated criterion (test criteria name determinism, exact sequence, regression-fail, no prose-pinning — all met).
2. On the error path where the fallback *also* fails, `wrappedInvokeZen` records the pre-resolved primary slug in the ledger usage row (`ntg-vnext.mjs:494` vs the error branch at 505-517) rather than the last-attempted slug. Success-path telemetry is correct (NOTE only: failed-path attribution nit, status is an error code either way).
3. If the quota error fires but Gemini 4 Argon High is not installed/ambiguous, `resolveSlug` throws `UnresolvedModelSlugError`, masking the original quota error. Consistent with the repo's fail-closed philosophy; acceptable.
4. The brief's expected count "36/36" for `test_ntg_vnext.mjs` does not match the file: 34 top-level tests at head, 32 at base (+2 new), no subtests. Recorded as an expectation error in the brief, not a test failure.

## Checked artifact paths

- `/tmp/ntg-zen-fallback` worktree @ 97832d7 (branch `fix/zen-quota-fallback`, up to date with `origin`; PR #199 OPEN, base `main`, per `gh pr view 199`).
- `git show 97832d7` / `git diff 87bfa17..97832d7` (full diff; 4 files, +63/−7).
- `scripts/ntg-vnext.mjs` (lines 43-46, 160-212, 483-560), `scripts/runner.mjs` (lines 35-70, 290-370), `tests/test_ntg_vnext.mjs` (lines 296-345, 589-663), `AGENTS.md` (lines 101-110).
- `scripts/excavator-agy.mjs:387` (rate-limit regex contrast), `tests/test_runner_spike.mjs` (escalation-isolation assertions, lines 140-195, 1654-1705).
- Session transcripts `/home/sleeg/.omo/memory/agents/sleeg-1b3e6de7/runtime/transcripts/01a14721-*/transcript.jsonl` and `01a167ae-*/transcript.jsonl` (real AGY quota error text), `01a19ace-e0fc-7117-a344-ed401b61dfd7/transcript.jsonl` (parent-session diff review and the telemetry-slug question it raised, answered above).
- Test runs executed fresh this session: `node --check` ×2 (exit 0 each), `node --test tests/test_ntg_command.mjs` (14/14, exit 0), six name-pattern group runs over `tests/test_ntg_vnext.mjs` (3/3, 6/6, 17/17, 2/2, 7/7, 6/6 — each exit 0). Two full-file single-process runs were also launched; no failure output from them was observed before this report was finalized.

## Evidence gaps

- No `.omo/evidence/ulw/<session>/<goalId>/a<attempt>` attempt dir exists (fallback path used).
- No executor evidence file, code-review report, manual QA matrix, or notepad artifact was supplied or found for PR #199; the review above is reproduced entirely from primary sources.
- Full-file coverage was reproduced via six name-pattern group runs (union = all 34 tests, zero failures) rather than one uninterrupted process, because the full suite exceeds the session's 60s foreground window; two full-file runs were also left executing as corroboration. No failure output of any kind was observed against this suite at 97832d7.
