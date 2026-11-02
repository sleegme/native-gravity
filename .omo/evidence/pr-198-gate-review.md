# Gate Review — PR #198 (docs/readme-initial-call-scope; reviewed at b32a12e; base main @ 87bfa17)

Reviewer: omo-native-gate-reviewer (st_01a19b61), 2026-11-02. Read-only; this file is the only write.
Report path fallback used (no `.omo/evidence/ulw/<session>/<goalId>/a<attempt>` exists — checked under both the repo and `~/.omo`; no ulw-loop plan), per repo convention `pr-NN-gate-review.md` (same fallback as PR #197's gate review).
`remove-ai-slops` and `programming` skills were not available in this session (available skills: gpt-image-gen, bun-1-4; filesystem search over `~/.omo` found neither); their documented criteria were applied directly from the gate instructions (results below). The prior PR #197 gate review recorded the same unavailability and applied the same direct-criteria approach.

## recommendation: APPROVE

## blockers

None.

## originalIntent

Owner-directed content decision on the README token bullet: return to the observed initial-call sample statement only — EN `README.md:18` and KO `docs/ko/README.md:18` both reading "in an observed initial Flash call sample, NTG Bulldozer used 9,883 input tokens compared to 14,302 for the AGY default agent (~31% fewer)" (KO equivalent) — dropping the whole-task one-shot comparison sentence, and remove the now-orphaned evidence file `.omo/evidence/2026-11-02-oneshot-token-measurement.md`. Removal of that file is intentional; raw records remain outside the repo (benchmark cache dir `ntg-oneshot-20261102`, stated in the deleted file's own final line). Explicit check scope: (1) EN/KO bullet mutual consistency and factual accuracy as scoped, per `.omo/evidence/prompt-cache-design-final-review.md`; (2) no other files changed and no dangling references to the removed evidence file; (3) `docs/usage.md` / `docs/ko/usage.md` untouched and consistent.

## desiredOutcome

A merged docs-only PR whose only visible change is the scoped-down token bullet in both languages, with no orphaned evidence file and no stale references, leaving all other documentation exactly as it was on main.

## userOutcomeReview

The shipped artifact delivers exactly that outcome; every claim in the PR was reproduced from primary artifacts rather than trusted from prose.

**Scope (criterion 2, clause 1) — PASS.** `git diff --name-status 87bfa17...HEAD` shows exactly three entries: `M README.md`, `M docs/ko/README.md`, `D .omo/evidence/2026-11-02-oneshot-token-measurement.md`. One commit (`b32a12e`); worktree clean; branch up to date with `origin/docs/readme-initial-call-scope`. `gh pr view 198` confirms OPEN, head `docs/readme-initial-call-scope`, base `main`, title matching the commit. `git diff 87bfa17...HEAD -- docs/usage.md docs/ko/usage.md` is empty (criterion 3, clause 1).

**EN/KO consistency and factual accuracy (criterion 1) — PASS.**
- `README.md:18`: "Separates context by role; in an observed initial Flash call sample, NTG Bulldozer used 9,883 input tokens compared to 14,302 for the AGY default agent (~31% fewer)."
- `docs/ko/README.md:18`: "역할별로 컨텍스트를 분리하며, 관찰된 초기 Flash 호출 샘플에서 입력 토큰이 AGY 기본 에이전트 14,302개 대비 NTG Bulldozer 9,883개(약 31% 감소)로 측정되었습니다."
- Same scope (observed initial Flash call sample), same attribution (NTG Bulldozer vs AGY default agent), same numbers (9,883 / 14,302), same direction and magnitude (~31% fewer). No divergence between the two bullets.
- Source artifact: `.omo/evidence/prompt-cache-design-final-review.md:44` — "in #113, Bulldozer's first Flash call was 9,883 tokens against 14,302 for the default agent." Corroborated by raw transcripts: `.omo/evidence/113-live-probe/A0-simple-print-5808a39f-transcript.jsonl` step 1 `input_tokens: 14302` (AGY default agent, no `--agent`) and the B1 bulldozer transcripts (e.g. `B1a-bulldozer-jaguar-23aa7f34-transcript.jsonl`) step 1 `input_tokens: 9883`. Attribution to Bulldozer (not "the supervisor") matches the repo role model in `AGENTS.md`: Steamroller runs Gemini 4 Argon at Medium and never Flash; Bulldozer is the Flash-tier milestone coordinator.
- Arithmetic: (14,302 − 9,883) / 14,302 = 30.90% → "~31% fewer" / "약 31% 감소" accurate. The bullet makes no whole-task, same-model-tier, or same-task claim, so it does not overstate what the sample shows.

**Dangling references (criterion 2, clause 2) — PASS, with one NOTE.** Repo-wide grep (case-insensitive, hidden files included) for `oneshot-token-measurement` finds 4 hits, all in `.omo/evidence/pr-197-gate-review.md` (lines 11, 15, 95, 100). That file is a dated historical gate-review record describing PR #197 at specific commits (`6d95878`, `0e526ea`); every mention is anchored to those commits ("new `.omo/evidence/2026-11-02-oneshot-token-measurement.md`" in the 0e526ea fix commit list; "added at 0e526ea"; "closed at 0e526ea with ..."), and the file remains retrievable at those commits. No live document (READMEs, usage docs, skills, scripts, code) references the removed file. A literal zero-hits reading of the criterion is self-contradictory here: the only mentions live in a file the same criterion's first clause forbids the PR from touching, and rewriting a dated review record would falsify history. Treated as a NOTE, not a blocker. Related check: the whole-task totals (16,284,488 / 3,995,749) and their "about 4x" framing appear in no user-facing doc after this PR — the claim and its evidence file were removed together, so nothing current lost its backing. Remaining repo-wide "one-shot" matches are unrelated (dag-viewer one-shot mode, `/tmp/ntg-oneshot*` workflow artifacts).

**usage docs (criterion 3) — PASS.** `docs/usage.md` and `docs/ko/usage.md` have an empty diff against base and contain no token-number or token-claim text at all (grep for `token|토큰` over both: zero hits), so nothing in them can contradict the re-scoped README bullet.

**Slop/overfit pass (remove-ai-slops + programming criteria, applied directly).** Docs-only diff of two one-line edits plus a whole-file deletion. No tests added, deleted, or weakened; nothing to be tautological, implementation-mirroring, or removal-verifying. No production extraction, parsing, or normalization introduced; no scope drift — the evidence-file deletion is inseparable from the owner-directed sentence removal (keeping it would leave an orphaned artifact whose only subject was the removed sentence). Nothing to flag; no maintenance burden or false confidence added.

**Prior review cross-check.** No separate executor code-review report or manual QA matrix was supplied for PR #198; the checks above were reproduced directly from the repo (verification-by-substitution: every success claim re-derived from `git`, `gh`, grep, and the evidence artifacts). The PR #197 gate record's Bulldozer-attribution finding (its original B1 blocker) remains satisfied by this PR's wording.

## Checked artifact paths

- `git diff --name-status` / full diff `87bfa17...HEAD`; `git log --oneline 87bfa17..HEAD`; `git status --porcelain`; `gh pr view 198` (state, head, base, title)
- `README.md:18`, `docs/ko/README.md:18` (post-change bullets, read in full context)
- `docs/usage.md`, `docs/ko/usage.md` (diff-empty; token grep zero hits)
- `.omo/evidence/prompt-cache-design-final-review.md:44` (attribution source), `.omo/evidence/prompt-cache-design.md:60-61` (same numbers, secondary)
- `.omo/evidence/113-live-probe/A0-simple-print-5808a39f-transcript.jsonl`, `B1a/B1b/B1c-*-transcript.jsonl`, `results.jsonl` (raw 14,302 / 9,883 first-call rows)
- Deleted `.omo/evidence/2026-11-02-oneshot-token-measurement.md` (read in full from the diff; its caveat line names the out-of-repo records location)
- `.omo/evidence/pr-197-gate-review.md` (all four mentions of the removed file, read in context)
- Repo-wide greps: `oneshot-token-measurement` (4 hits, one file), `9,?883|14,?302|16,?284,?488|3,?995,?749|initial (Flash )?call|초기 Flash 호출`, `one-shot|oneshot|원샷|whole-task`

## Exact evidence gaps

- No executor code-review report, manual QA matrix, or notepad was provided for PR #198. Mitigated: all three gate checks were reproduced independently from the artifacts above, so nothing rests on unverified executor prose.
- The whole-task one-shot raw data (per-arm transcripts, accounting JSON) now lives only outside the repo in `ntg-oneshot-20261102`; not re-verifiable from the repo. Immaterial to this gate: no in-repo claim depends on it after this PR.
- Skills `remove-ai-slops` and `programming` were unavailable; their criteria were applied from the gate instructions directly, as recorded above (and as the PR #197 gate review did under the same conditions).

## Notes (non-blocking)

1. `.omo/evidence/pr-197-gate-review.md:11,15,95,100` mention the deleted file as PR #197-era in-repo evidence. Historical record, commit-anchored; left untouched per criterion 2's "no other files changed" clause.
2. This PR reverses the whole-task disclosure PR #197's review originally required as an honesty restatement. The gate brief explicitly declares this an owner-directed content decision, and the surviving initial-call claim is accurately hedged with no whole-task-saving implication remaining anywhere in user-facing docs; noted for traceability only.
