# Issue #134 — vNext activation (44G) evidence (lane vnext-activate)

Date: 2026-10-12 (KST). Branch `feat/134-vnext-activate` off `origin/main` @ `4b45987`. Host binary `agy 1.3.3`.
PO decision **A** (activate now); lead scope **A1 + A2** (runner is the default entry, merged agent bodies, native Bulldozer/Piledriver/Excavator kept with Zen gates, missing 44G live validations run here, OQ-6 left to the PO).

## 1. Installed plugin re-import (activated default)

- Backup of the pre-activation install: `<HOME>/.gemini/config/plugins-backup-134-20261011215304`.
- From the lane worktree at `128222e`: `agy plugin validate .` (9 agents, 4 hooks) → `agy plugin uninstall native-gravity` → `agy plugin install .`; `importedAt: 2026-10-11T21:53:04Z` (UTC).
- `diff -rq` worktree vs `<HOME>/.gemini/config/plugins/native-gravity`: `agents/`, `hooks/`, `rules/`, `plugin.json`, `hooks.json` — all identical.
- Later commits on the branch touch only `scripts/`, `tests/` and evidence; the runner and `ntg-vnext` run from the repo, so the install stayed current for every probe.

## 2. Live 44G validation (real `ntg-vnext` CLI, real agy)

Harness: `134-live-probe/probe.mjs` (`node probe.mjs all`, then `node probe.mjs p2a`), `TMPDIR=$HOME/.cache/ntg134-tmp`. Raw records: `134-live-probe/results.jsonl` (home paths sanitized to `<HOME>`). Session IDs are the AGY brain sessions created during each step.

| Step | What it proves | Result | Sessions |
|---|---|---|---|
| P1b `run` (m1) | Steamroller → Bulldozer → independent native Zen → promotion | exit 0; m1 `DONE`, Zen `GO` (v1), `verified: true` | `62b10e77-e773-45a3-bb61-92ad38ddb21d`, `7f19e5c4-fdf1-4d61-9b39-c0bbc3ecb436`, `ca09ea46-732d-4c8d-9c74-c1c446eec150` |
| P1c `run` (m2), SIGKILL at 25s | supervisor killed mid-Bulldozer invocation | killed; lock left behind | `b13ddd6a-57ad-4cf5-b58b-91c1cc6dc540` |
| P1d `status` | killed owner's lock blocks other supervisors | exit 1 `…lock already exists; verify its owner…` | — |
| P1e `recover` | owner-verified stale-lock recovery + observed interruption recorded | exit 0; `dead_owner_pid` removed, `current_milestone: null`, completed `[m1]` | — |
| P1f `run --all` (fresh process) | **fresh-context resume** from the ledger; **multi-milestone** in dependency order; global completion | exit 0; m2 `DONE`, Zen `GO` (v1); completed `[m1, m2]`; `global_completion` declared | `396749c4-8222-4dd5-8ad2-5d41991e222f`, `3a26ed89-8b90-4c74-a00b-6d2a69bcf458`, `3c3dd4cf-552f-4b7d-aeac-27624ce6790b`, `540a69cf-e60b-4ee8-a9f9-be1163e4c2b9` |
| P2a `plan` | live Piledriver advice (not adopted) | run 1: exit 1 `TIMEOUT` at the runner's 90s default; runs 2–3 after the timeout fix: exit 1 `TOOL_PERMISSION_DENIED` (Piledriver tried `git grep` via RunCommand; runner failed closed); run 4 after the no-shell instruction fix: **exit 0**, advisory plan (`plan_version: v3`, milestones, replan_analysis, evidence, unknowns, recommended_verification) returned with `adopted: false` (see §4) | run 1 `1077cedb-3be4-49dd-b326-57000852ffe4`; run 2 `cedee484-f8e9-4658-ba90-6b8a2e2c6875`; run 3 `c167dd8c-edee-42db-a6fa-f240f833b8fe`; run 4 `0b2b0f84-ffb5-42cf-90e8-ea2a7e0e6b9d` |
| P2b `replan` v2 | **plan revision**: material replan | exit 0; `plan_version: v2`, completed cleared `[]` | — |
| P2c `run --all` | retained milestone revalidated under v2 with a fresh GO | exit 0; m1 `DONE`, Zen `GO` with `plan_version: v2`; global completion | `48bba551-481c-4a08-8aaf-73e96e20143d`, `5d3040be-8470-49b0-b399-82df6282b167`, `d12c0210-2575-408f-88c2-0065d022c2ae` |
| P3b `run`, artifact tampered before Zen | **live Zen NO-GO** | exit 2; w1 `DONE` candidate, Zen `NO-GO`, `verified: false`, repair_needs "Update …/ntg134-nogo.txt to contain exactly … 'alpha' instead of 'tampered'"; completed `[]` | `4a5d8754-33d7-45c1-b56c-cae7553791d9`, `c3b26152-71d8-4584-ba85-1a7eaaf22d1e`, `e9456cbb-17a1-497d-a36e-71169d1e86ba` |
| P3c `run` (repair) | repaired candidate needs and gets a **fresh GO** | exit 0; w1 `DONE`, Zen `GO`; artifact `alpha\n`; global completion | `595f3647-9e4d-4d92-901f-c71f3c5b554b`, `5cffdd45-c341-4d86-ad5d-0f0e53656927`, `826e0477-4296-4104-90dc-c24e2b621d7d` |

P3 tampering is fault injection in the probe driver only (a wrapper around the shipped `nativeZen` adapter overwrites the artifact once, after Bulldozer's DONE and before Zen). Everything else is the shipped CLI.

## 3. Test suite

Final run at `b38da0d`, sequential, from the repo root. Every command is prefixed `TMPDIR=$HOME/.cache/ntg134-tmp` (host /tmp quota).

| Command | Exit | Summary |
|---|---|---|
| `node tests/test_dag_view.mjs` | 0 | `tests 10 ; pass 9 ; fail 0 ; skipped 1` |
| `node tests/test_ledger.mjs` | 0 | `Summary: 39 passed, 0 failed (Total: 39)` |
| `node tests/test_ntg_run.mjs` | 0 | `tests 12 ; pass 12 ; fail 0 ; skipped 0` |
| `node tests/test_ntg_vnext.mjs` | 0 | `tests 8 ; pass 8 ; fail 0 ; skipped 0` |
| `node tests/test_runner_spike.mjs` | 0 | `Summary: 46 passed, 0 failed (Total: 46)` |
| `node tests/test_spine.mjs` | 0 | `tests 96 ; pass 96 ; fail 0 ; skipped 0` |
| `node tests/test_studio_runner.mjs` | 0 | `tests 10 ; pass 10 ; fail 0 ; skipped 0` |
| `node tests/test_telemetry.mjs` | 0 | `tests 7 ; pass 7 ; fail 0 ; skipped 0` |
| `python3 tests/test_excavator_review_gate.py` | 0 | `Ran 52 tests ; OK` |
| `python3 tests/test_excavator_shell_guard.py` | 0 | `Ran 4 tests ; OK` |
| `python3 tests/test_gate_panel.py` | 0 | `Ran 19 tests ; OK` |
| `python3 tests/test_primary_review_gate.py` | 0 | `Ran 41 tests ; OK` |
| `python3 tests/test_zen_shell_guard.py` | 0 | `Ran 7 tests ; OK` |

**Total: 351 tests — 350 pass, 0 fail, 1 skipped** (node 228 incl. 1 skipped; python 123). New: `test_ntg_vnext.mjs` (8), 2 gate cases in `test_primary_review_gate.py`. Baseline on `4b45987` before any change: all 12 files rc=0.

## 4. Defects found and fixed in this PR

1. **Stale lock after a killed supervisor** (P1, first probe run). `ledger-lock` deliberately refuses an existing lock, and nothing removed it, so a crash made the ledger unusable. Fix: `ntg-vnext recover` removes the lock only when its recorded owner PID is dead (`process.kill(pid, 0)` → `ESRCH`) and refuses a live owner. Tests: killed-owner resume (real child SIGKILLed), live-owner refusal. Mutation check: dropping the unlink fails the resume test.
2. **Piledriver timeout and shell attempts** (P2a). The CLI passed no runner timeout, so Pro/High planning hit the runner's 90s default. Fix: `--timeout SECONDS` (default 600, `NTG_RUNNER_TIMEOUT_S`); test asserts the forwarded timeout. Next, Piledriver tried `git grep` via RunCommand, which headless agy denies and the runner reports as `TOOL_PERMISSION_DENIED` (fail closed, correct). A role-body sentence alone did not stop it (run 3); stating the no-shell rule with the read-only tool names in the runner's planning instruction (`spine.mjs requestPlan`) did (run 4).
3. **`runner_spike` 2.7a flake** — a test bug that predates this PR (from #100), not runner code. The test sampled `ps` once right after the runner's asynchronous process-group SIGKILL; under load the descendant was still in its exit path (state `R`, the failure message). Fix: wait for the descendant's exit through a pidfd (`os.pidfd_open` + `poll`) with a 5s bound. Verified 46/46; mutation check (runner group kill removed) fails with "descendant … still alive 5s after group SIGKILL".

## 5. Remaining risks

- Single host, `agy 1.3.3`, one day.
- Natively selected Bulldozer/Piledriver/Excavator flows were not re-exercised live in this PR (their bodies kept the released gate semantics; #56 covered Bulldozer routing on the prior bodies).
- OQ-6 (`inheritCustomizations`) is unresolved by design — PO decision in the PR body.
