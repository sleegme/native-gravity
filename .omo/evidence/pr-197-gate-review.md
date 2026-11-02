# Gate Review — PR #197 (feat/191-ntg-entry-point; reviewed at 6d95878, re-reviewed at 0e526ea; base main @ 12b5fb8)

Reviewer: omo-native-gate-reviewer (st_01a19b35), 2026-11-02. Read-only; no repo files modified.
Report path fallback used (`ULW_LOOP_PLAN_MISSING`: no plan at `.omo/ulw-loop/.../goals.json`), per repo convention `pr-NN-gate-review.md`.
`remove-ai-slops` and `programming` skills were not available in this session; their criteria were applied directly from the gate instructions (results below).

## recommendation: APPROVE (re-review at 0e526ea; original review at 6d95878 was REJECT with one blocker, resolved)

## Re-review at 0e526ea (2026-11-02) — all three claimed fixes reproduced

Fix commit touches exactly 5 files (`README.md`, `docs/ko/README.md`, `scripts/ntg-command.mjs`, `tests/test_ntg_command.mjs`, new `.omo/evidence/2026-11-02-oneshot-token-measurement.md`); the original 8-file scope is otherwise unchanged.

1. **B1 resolved — attribution restored to Bulldozer.** `README.md:18` now reads "in one observed sample NTG Bulldozer's initial Flash call used 9,883 input tokens versus 14,302 for the AGY default agent (~31% fewer)"; `docs/ko/README.md:18` reads "NTG Bulldozer의 초기 Flash 호출". This matches the measurement artifact `.omo/evidence/prompt-cache-design-final-review.md:44` ("Bulldozer's first Flash call was 9,883 tokens against 14,302 for the default agent") and the repo role model (Bulldozer is the Flash-tier coordinator). KO mirrors EN; the whole-task sentence is untouched and remains internally consistent EN↔KO.
2. **Signal-exit gap resolved.** `scripts/ntg-command.mjs:50` now returns `res.status ?? (res.error || res.signal ? 1 : 0)` — a signal-killed child (status `null`, signal set) exits 1 instead of 0. New test `signal-killed runner exits nonzero instead of 0` drives a real child process whose stub self-SIGKILLs (`process.kill(process.pid, 'SIGKILL')`) — deterministic (no sleep/timing), asserts the contract (`notEqual(code, 0)`), and would have failed on the pre-fix expression (`res.status ?? (res.error ? 1 : 0)` yields 0 for a signal kill). Suite is now 14/14 pass.
3. **Evidence gap closed.** `.omo/evidence/2026-11-02-oneshot-token-measurement.md` is committed in-repo and backs the README totals. Reviewer-verified arithmetic: per-session NTG table sums exactly to the arm total (12,588,483 + 1,357,751 + 1,888,409 + 162,070 + 287,775 = 16,284,488); every row's input+cache+output columns sum to its total; AGY arm columns sum to 3,995,749; ratio 16,284,488/3,995,749 = 4.075 → artifact "4.08x" and README "about 4x more"; Bulldozer share 12,588,483/16,284,488 = 77.3% as stated. Method, conditions, and the single-sample qualifier are explicit; the Zen-on-Argon quota substitution is disclosed as a caveat and the README makes no claim it contradicts. Hygiene: no `/home/` paths in the artifact (grep clean; raw transcripts stated to live outside the repo under a relative cache-dir name).

### Re-review verification runs (all reproduced at 0e526ea)

| Command | Result |
|---|---|
| `node --test tests/test_ntg_command.mjs` | 14/14 pass, 0 fail, exit 0 |
| `node tests/test_dag_view.mjs` | 9 pass, 1 pre-existing skip, 0 fail, exit 0 |
| `agy plugin validate .` | passed, same single pre-existing warning (AGENTS.md placement + logo; files untouched) |
| `npm pack --dry-run` | `skills/ntg/SKILL.md`, `scripts/ntg-command.mjs`, `scripts/ntg-vnext.mjs` all in tarball; 57 files |

### Slop/overfit check of the fix delta

One new test; deterministic; asserts externally observable behavior (exit code after real child signal death); no prose-pinning; no new production extraction or normalization beyond the one-line ternary. Nothing to flag.

### Remaining notes (non-blocking, unchanged from first review)

- Helper tests stub the far end; real-runner wiring is covered by this reviewer's live smoke (first review) and unchanged files since 6d95878.
- `resume` composite command remains unused by SKILL.md (documented, tested — note-level).
- Packaging `skills/` also ships inert `qa-*.md` + `skills/README.md` (not registered as skills by `agy plugin validate`).

---

# Original review at 6d95878 (superseded recommendation: REJECT)

## blockers (original)

### B1 — README misattributes the measured 9,883-token sample to "the supervisor", contradicting the repo's own measurement artifact — RESOLVED at 0e526ea

- **violatedCriterion:** docs-accuracy — "no unverified claims".
- **evidencePointer:** `README.md:18` / `docs/ko/README.md:18` (then: "the supervisor's initial Flash call") vs `.omo/evidence/prompt-cache-design-final-review.md:44` and `.omo/evidence/prompt-cache-design.md:60` ("Bulldozer's first Flash call was 9,883 tokens against 14,302 for the default agent"); `AGENTS.md` role model (Steamroller supervises, runs Argon Medium — never Flash).

## originalIntent

Issue #191: give users a `/ntg <task>` entry point inside an agy session — a packaged, plugin-relative launcher (`scripts/ntg-command.mjs`) plus a skill (`skills/ntg/SKILL.md`) that drafts a milestone plan, gets explicit user confirmation, initializes `.ntg/ledger.json`, and runs/resumes through the real `ntg-vnext.mjs` runner without env vars or checkout paths. Separately, restate the README token claim honestly: keep the small initial-call sample but add the measured one-shot whole-task comparison (NTG 16,284,488 tokens vs matched AGY baseline 3,995,749, single sample, ~4x more, "not a net token saver"). Exactly 8 files in scope.

## desiredOutcome

A user can invoke `/ntg` in an agy session; on a fresh task they see a plan and must confirm before anything runs; with an existing ledger they see status and execution resumes without overwriting; all execution goes through the real runner and Zen verifier with no model-policy bypass; the npm package ships the skill and helper; both READMEs state token costs truthfully.

## userOutcomeReview

The shipped artifact delivers the outcome. Verified from the user's perspective:

- Launcher works for real, not just under test: `node scripts/ntg-command.mjs status --ledger /tmp/.../missing.json` spawned the real `ntg-vnext.mjs` (resolved relative to installation, no env vars), surfaced its missing-ledger error, and exited 1; `--help` exits 0; unknown command exits 1. Forwarded argv (`init --ledger X --plan Y`, `status --ledger X`, `run --ledger X --all`) all parse in ntg-vnext's own `parseArgs` (`scripts/ntg-vnext.mjs:51-70`).
- Paths with spaces survive: spawnSync with argv arrays, no shell; covered by a real-process test.
- No direct ledger writes: helper never opens the ledger for writing; negative test confirms.
- Guardrails hold: SKILL.md forbids ledger writes by the skill, requires explicit plan confirmation before init/run, mandates resume-not-overwrite for an existing ledger, pins `mainAgent: false`, and forbids runner/model bypass. No `agents/`, `hooks.json`, or `plugin.json` changes in the PR diff.
- Packaging: `npm pack --dry-run` includes skill, helper, and resolved dependency `scripts/ntg-vnext.mjs`; `agy plugin validate .` passes, `skills 1` (the qa-*.md root files are correctly not counted).
- Docs: EN/KO usage docs match actual helper behavior; stale "not available yet" line removed from `docs/usage.md` (never present in KO); README documents `/ntg <task>` at README.md:37.

## Verification runs at 6d95878

| Command | Result |
|---|---|
| `node --test tests/test_ntg_command.mjs` | 13/13 pass, exit 0 |
| `node tests/test_dag_view.mjs` | 9 pass, 1 pre-existing skip, 0 fail, exit 0 |
| `agy plugin validate .` | passed, 1 pre-existing warning |
| `npm pack --dry-run` | exit 0; skill + helper + ntg-vnext.mjs in tarball, 57 files |
| End-to-end smoke (real helper→real runner, /tmp) | status on missing ledger → runner error, exit 1; --help → 0; bogus → 1 |

## Slop / overfit pass at 6d95878 (remove-ai-slops criteria, applied directly)

- No excessive/useless tests; all drive the real spawn path against a logging stub (only the far end stubbed).
- No deletion-only or removal-verifying tests; "no ledger writing" is a genuine negative test that can fail.
- No tautological tests; assertions on forwarded argv, exit codes, invocation counts. One trivial redundancy: `argv[2]`/`argv[4]` duplicate the preceding `deepEqual` in the spaces test.
- No implementation-mirroring beyond the forwarding contract, which is the helper's user-facing behavior; one machine-facing error-message regex acceptable.
- No unnecessary production extraction; `resume` composite command unused by SKILL.md — note-level.

## programming-criteria findings at 6d95878

- False-confidence gap (note): helper tests never exercise the real ntg-vnext CLI; mitigated by reviewer's live smoke and manual parseArgs confirmation. (Signal-exit note was fixed at 0e526ea; see re-review.)
- Scope: exactly the 8 stated files; no home paths, no secrets in the diff.
- Convention note: `skills/README.md` required-sections contract governs QA-discipline skills; the ntg entry-point skill is a different category and `agy plugin validate` accepts it.

## checkedArtifacts

- Original diff `12b5fb8..6d95878` (all 8 files) and fix diff `6d95878..0e526ea` (all 5 files), read in full
- `scripts/ntg-vnext.mjs` (parseArgs/dispatch), `plugin.json`, `skills/README.md`, `AGENTS.md` (unchanged; role-model evidence)
- `.omo/evidence/prompt-cache-design-final-review.md`, `.omo/evidence/prompt-cache-design.md`, `.omo/evidence/113-live-probe/*-transcript*.jsonl` (9,883/14,302 attribution)
- `.omo/evidence/2026-11-02-oneshot-token-measurement.md` (added at 0e526ea; arithmetic re-summed by reviewer)
- Live outputs of all four verification commands at both commits plus the /tmp end-to-end smoke (cleaned up; `git status` clean except this report)

## evidenceGaps

1. ~~16,284,488 / 3,995,749 totals had no in-repo artifact~~ — closed at 0e526ea with `.omo/evidence/2026-11-02-oneshot-token-measurement.md`; raw transcripts still live outside the repo (stated location), which is acceptable for a single-sample benchmark.
2. Executor code review report, manual QA matrix, and notepad were not supplied with the task; all checks were reconstructed directly from the diff and live runs.
