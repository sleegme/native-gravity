# Issue #134 — vNext activation (44G) evidence (lane vnext-activate)

Date: 2026-10-12 (KST). Branch `feat/134-vnext-activate` off `origin/main` @ `4b45987`. Host binary `agy 1.3.3`.
PO decision **A** (activate now); lead scope **A1 + A2** (runner is the default entry, merged agent bodies, native Bulldozer/Piledriver/Excavator kept with Zen gates, missing 44G live validations run here, OQ-6 left to the PO).

## 1. Installed plugin snapshot (provenance, corrected after gate review B5)

- Pre-activation backup: `<HOME>/.gemini/config/plugins-backup-134-20261011215304`.
- **First probe run (superseded)**: plugin installed from `128222e` (importedAt `2026-10-11T21:53:04Z`). The earlier claim that later commits "touch only scripts/, tests/ and evidence" was **false**: `b38da0d` added three no-shell lines to `agents/piledriver.md`, so the installed native snapshot no longer matched HEAD for the P2a reruns. The runner itself always loads role bodies from the repository (`agents/`), so runner results reflected the repo body, not the installed snapshot. Those records are kept as `134-live-probe/results-pre-gate.jsonl`.
- **Final probe run (this report)**: plugin reinstalled from the final code commit `474a881` (`agy plugin validate .` 9 agents / 4 hooks → uninstall → install; importedAt `2026-10-11T22:43:06Z`). `diff -rq` of `agents/`, `hooks/`, `rules/`, `plugin.json`, `hooks.json` against the install: all identical. Commits after `474a881` change only evidence files, so the installed snapshot, the repository bodies the runner loads, and the tested code are the same artifact for every probe below.
- After the probes the installed plugin was restored to `origin/main` `4b45987` (diff identical).

## 2. Live 44G validation — final run (real `ntg-vnext` CLI, real agy 1.3.3)

Harness: `134-live-probe/probe.mjs` (`node probe.mjs all`, then `node probe.mjs p2a`), `TMPDIR=$HOME/.cache/ntg134-tmp`. Raw records: `134-live-probe/results.jsonl` (sanitized). Sessions are now attributed by **creation time** (directory birth time ≥ step start) instead of modification time, so a pre-existing session that keeps writing is not credited to a later step (gate review B2 note).

| Step | What it proves | Result | Sessions created in the step |
|---|---|---|---|
| P1b `run` (m1) | runner fails closed on a malformed Bulldozer packet | exit 1: Bulldozer prefixed Jaguar's prose and `* * *` before its JSON DONE packet → invalid response format → INVOCATION_FAILURE recorded, **nothing promoted**. Filed as #136 (not caused by the gate fixes; 1 of 8 live Bulldozer runner calls) | `0fcfffeb-14b7-4686-8dbd-78fdb5c16afc`, `651dfdcd-183a-406d-8d5b-e732984e8148` (Jaguar) |
| P1c `run` (m1 retry), SIGKILL at 25s | supervisor killed while its executor is in flight | killed; lock and detached executor left behind | `0ebdf96a-2218-4554-a7a7-a5ca54f8022f` |
| P1d `status` | a dead owner's lock blocks other supervisors | exit 1 `…lock already exists; verify its owner…` | — |
| P1e `recover` | **B2**: old executor proven dead before release | exit 0 in 88 ms; `dead_owner_pid 1485161`, `terminated_executors: [1485203]` (found via inherited supervisor markers, group-SIGKILLed, exit observed via pidfd); `current_milestone: null` | — |
| P1f `run --all` (fresh process) | **fresh-context resume**, **multi-milestone** in dependency order, no overlap | exit 0; m1 `GO` (v1), m2 `GO` (v1); completed `[m1, m2]`; global completion. Killed session `0ebdf96a` transcript last written 07:45:45.007 KST and never after; first P1f session created 07:45:51.748 — **no overlap** | `786e2188-38b8-4ee5-8a59-617f975fa2ff`, `e19cefcf-5439-4da4-93c7-847149a722d5`, `95a4a75a-575f-4a45-870f-f53e78ab4b42`, `8b8103bd-4d92-49b1-819a-87ee4a54cbc4`, `418a449f-f222-48e6-a351-4ee71a8cfe75`, `715fa73a-b728-405a-b3b1-ed1b0e6bc30e` |
| P2a `plan` (twice) | live Piledriver advice through the runner (B4), not adopted | exit 0 both times, `adopted: false`; no TOOL_PERMISSION_DENIED | `76e1e079-dcc8-462c-827d-194325e6f192`, `a0ba7f27-0270-470d-9876-d75f46482de1` |
| P2b `replan` v2 | **plan revision** | exit 0; `plan_version: v2`, completed cleared `[]` | — |
| P2c `run --all` | retained milestone revalidated with a fresh v2 GO | exit 0; m1 `GO` with `plan_version: v2`; global completion | `5d545a3e-f9cf-414c-8cca-dbce8cf1eca0`, `9b4b54a9-358e-48c8-9bd6-5698cad6ad27`, `e86d4e8a-0788-49ec-b29f-4e9f8d529109` |
| P3b `run`, artifact tampered before Zen | **live Zen NO-GO** | exit 2; w1 DONE candidate, Zen `NO-GO`, repair_needs "…contains exactly the single line \"alpha\""; completed `[]`; file `tampered\n` | `25b97273-4f42-4c89-bc3f-836f9e7cfdf2`, `a02ec514-a1ad-47d8-8e97-d70288424bd1`, `f4ff1ce6-7e97-4faf-8d36-3ac6be193a70` |
| P3c `run` (repair) | repaired candidate gets a **fresh GO** | exit 0; w1 `GO`; file `alpha\n`; global completion | `18fa01b1-fc73-4788-b6aa-c294486c6cb1`, `81e7d8b6-afe9-4b84-97de-16dace0924cd`, `caff0671-5ac9-4024-9ba4-44bf7f440d25` |

P3 tampering is fault injection in the probe driver only. The 25 s kill point in P1c is a harness timing assumption; P1e's `terminated_executors` is the observed proof that an executor was in flight when the supervisor died.

## 3. Test suite

Final run at `474a881`, sequential, from the repo root, every command prefixed `TMPDIR=$HOME/.cache/ntg134-tmp`; live runner tests included.

| Command | Exit | Summary |
|---|---|---|
| `node tests/test_dag_view.mjs` | 0 | `tests 10 ; pass 9 ; fail 0 ; skipped 1` |
| `node tests/test_ledger.mjs` | 0 | `Summary: 39 passed, 0 failed (Total: 39)` |
| `node tests/test_ntg_run.mjs` | 0 | `tests 12 ; pass 12 ; fail 0 ; skipped 0` |
| `node tests/test_ntg_vnext.mjs` | 0 | `tests 10 ; pass 10 ; fail 0 ; skipped 0` |
| `node tests/test_runner_spike.mjs` | 0 | `Summary: 47 passed, 0 failed (Total: 47)` (incl. live 5.1 Piledriver, 5.2 Bulldozer) |
| `node tests/test_spine.mjs` | 0 | `tests 96 ; pass 96 ; fail 0 ; skipped 0` |
| `node tests/test_studio_runner.mjs` | 0 | `tests 10 ; pass 10 ; fail 0 ; skipped 0` |
| `node tests/test_telemetry.mjs` | 0 | `tests 7 ; pass 7 ; fail 0 ; skipped 0` |
| `python3 tests/test_excavator_review_gate.py` | 0 | `Ran 52 tests ; OK` |
| `python3 tests/test_excavator_shell_guard.py` | 0 | `Ran 4 tests ; OK` |
| `python3 tests/test_gate_panel.py` | 0 | `Ran 19 tests ; OK` |
| `python3 tests/test_primary_review_gate.py` | 0 | `Ran 41 tests ; OK` |
| `python3 tests/test_zen_shell_guard.py` | 0 | `Ran 7 tests ; OK` |

**Total: 354 tests — 353 pass, 0 fail, 1 skipped.** The gate reviewer's earlier reproduction (349/1/1 at `e9a3d22`) failed live 5.1; see §4 item 4.

## 4. Defects found and fixed in this PR

1. **Stale lock after a killed supervisor** (P1, first probe run). `ledger-lock` deliberately refuses an existing lock, and nothing removed it, so a crash made the ledger unusable. Fix: `ntg-vnext recover` removes the lock only when its recorded owner PID is dead (`process.kill(pid, 0)` → `ESRCH`) and refuses a live owner. Tests: killed-owner resume (real child SIGKILLed), live-owner refusal. Mutation check: dropping the unlink fails the resume test.
2. **Piledriver timeout and shell attempts** (P2a). The CLI passed no runner timeout, so Pro/High planning hit the runner's 90s default. Fix: `--timeout SECONDS` (default 600, `NTG_RUNNER_TIMEOUT_S`); test asserts the forwarded timeout. Next, Piledriver tried `git grep` via RunCommand, which headless agy denies and the runner reports as `TOOL_PERMISSION_DENIED` (fail closed, correct). A role-body sentence alone did not stop it (run 3); stating the no-shell rule with the read-only tool names in the runner's planning instruction (`spine.mjs requestPlan`) did (run 4).
3. **`runner_spike` 2.7a flake** — a test bug that predates this PR (from #100), not runner code. The test sampled `ps` once right after the runner's asynchronous process-group SIGKILL; under load the descendant was still in its exit path (state `R`, the failure message). Fix: wait for the descendant's exit through a pidfd (`os.pidfd_open` + `poll`) with a 5s bound. Verified 46/46; mutation check (runner group kill removed) fails with "descendant … still alive 5s after group SIGKILL".

4. **Gate review B1 — bin symlink no-op.** The main-module check compared `argv[1]` (the npm symlink) with the resolved module path. Fix: compare real paths. Test runs the CLI through a symlink (missing ledger → exit 1 ENOENT; init → JSON). Mutation (old comparison) fails it.
5. **Gate review B2 — overlapping executor after recover.** Recovery only checked the dead supervisor PID while its detached agy executor kept running (pre-gate run: `b13ddd6a` kept working after recover). Fix: `ntg-vnext` marks itself in `NTG_SUPERVISOR_PID` / `NTG_SUPERVISOR_LEDGER`, which every runner/Zen child inherits; `recover` finds processes carrying the dead owner's markers in `/proc`, SIGKILLs their process groups, waits for exit via pidfd (10 s bound) and only then releases the lock; it refuses (lock kept) if anything survives or `/proc` is unavailable. Test: a real supervisor process spawns a detached executor and is SIGKILLed; recover must report and terminate it. Mutation (skip termination) fails it. Live: P1e above.
6. **Gate review B3 — Zen GO from bad envelopes.** `nativeZen` now parses through the runner's `parseResponseEnvelope` (ERROR → MODEL_ERROR, denied actions → TOOL_PERMISSION_DENIED, missing response → INVALID_OUTPUT) and requires an explicit `GO`/`NO-GO`. Negative tests for each; mutation (bypass envelope) fails them.
7. **Gate review B4 — live Piledriver TOOL_PERMISSION_DENIED in runner_spike 5.1.** Cause (from the reviewer's failing session `bb778fac-19c1-4d1b-bc34-f2954637ba87`, which ran `git status; git log`): the activation merged the released interactive Planning discipline ("establish that the planning target is the requested target…") into `agents/piledriver.md`, and the runner sent the whole file, so headless runner invocations were told to ground the target by inspection. The 44D draft the runner used before activation had no such section. Fix: the runner drops the native-only `## INTERACTIVE MODE` section from bodies it loads (test 3.7 + updated 3.1/3.2/6.x expectations; mutation fails 3.1/3.2). Live 5.1 passed in the final suite, and P2a passed twice.

## 5. Remaining risks

- Single host, `agy 1.3.3`, one day.
- Natively selected Bulldozer/Piledriver/Excavator flows were not re-exercised live in this PR (their bodies kept the released gate semantics; #56 covered Bulldozer routing on the prior bodies).
- #136: Bulldozer occasionally prefixes prose before its runner JSON packet (fails closed; observed 1 of 8).
- Executor termination on recover relies on Linux `/proc` and `pidfd`; elsewhere recover refuses rather than guessing.
- OQ-6 (`inheritCustomizations`) is unresolved by design — PO decision in the PR body.
