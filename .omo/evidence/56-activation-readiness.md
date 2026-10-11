# Issue #56 / #44 — vNext activation readiness (lane vnext-56)

Date: 2026-10-12 (KST). Base: `origin/main` @ `25f2877`. Host binary: `agy 1.3.3` (`~/.local/bin/agy`).
Scope: readiness evidence only. vNext is **not** activated, no defaults flipped, #56/#44 left open — activation is a PO decision (card in the PR body).

## 1. Installed plugin re-import (closes the #113 snapshot-drift gap)

- Backup of the stale snapshot (importedAt `2026-09-30T05:15:34Z`): `~/.gemini/config/plugins-backup-56-20261012005837/native-gravity`.
- Supported path (README "clean upgrade/reinstall"): `agy plugin validate .` (ok: 9 agents, 4 hooks) → `agy plugin uninstall native-gravity` → `agy plugin install .` from a clean worktree at `25f2877`. All rc=0.
- `agy plugin list` now: `importedAt: "2026-10-11T15:58:48Z"` (UTC; = 2026-10-12 00:58 KST).
- `diff -r` repo HEAD vs `~/.gemini/config/plugins/native-gravity`: `agents/`, `hooks/`, `rules/`, `hooks.json`, `plugin.json` — **all IDENTICAL**. The 4 drifted agent bodies (bobcat, bulldozer, excavator, piledriver) and 3 drifted hooks named in #113 evidence are gone.

## 2. #113 probe set re-run against the fresh install

Harness: `.omo/evidence/56-live-probe/probe.mjs` (copy of the #113 harness; only `REPO`/`ART` repointed to this worktree and the Puma/Bobcat artifact paths moved off `/tmp`, see §4). Raw records: `results.jsonl`; transcripts copied per run; static inventory `sweep.json`.

| Path | Verdict | Evidence (real session IDs) |
|---|---|---|
| Sanity (`agy -p`) | PASS | A0 `d25f8ffc-f25a-427f-9913-24614cbdd4de`, `status:SUCCESS`, response `PONG` |
| Bulldozer → Jaguar (`--agent bulldozer` via `ntg-run`) | **PASS** | B1a exit 0, transcript `invoke_subagent TypeName:"jaguar"`; sessions `9a778101-14a7-47b1-8a43-5102b3e6fd2e`, `10647ace-3d2c-485f-8b20-eea63d76088d`, `ea7be3d8-29e0-4cc8-9319-a8f0d17eef98`, `007b8d98-b841-4e31-9910-de9ed3a05a03`; Bulldozer relayed the line-count answer |
| Bulldozer → Puma | **PASS** | B1b (rerun) exit 0, `TypeName:"puma"`; sessions `46d1c062-2817-4a3e-8ba8-f227f92dc45a`, `0e3a7a7b-63ab-4a67-979d-11065955692a`; artifact `~/.cache/ntg56-tmp/ntg56-puma-note.txt` = `alpha\nbeta\ngamma\n`; parent ended `PUMA_LEG_DONE` |
| Bulldozer → Bobcat → Strix Halo | **PASS (two-hop)** | B1c (rerun) exit 0, dispatched `bobcat` and `strix-halo`; sessions `fc9efc76-f068-452f-954b-2da880dd3952`, `ffb0d706-de9f-4a06-89ac-18a4a1cb77ac`, `6fcf5839-1ff0-44b3-b918-abc1fb436839`; artifact `ntg56-bobcat-marker.txt` = `marker\n`; parent ended `BOBCAT_LEG_DONE` |
| Steamroller → Zen (vNext runner / `MinimalSpine.runMilestone('one')`) | **PASS (end-to-end)** | B2 exit 0; milestone `status:"DONE"`, `verified:true`; Zen packet `verdict:"GO"` with `OBSERVED` `verification_evidence`; sessions `0fa031fb-576b-43e0-8423-6a67a2c3294c`, `bccf027f-2b82-4781-9fb6-c74811907e89` |
| Runner exact-model calls | **PASS** | `resolveSlug`: piledriver→`gemini-3.1-pro-high`, bulldozer→`gemini-3.8-flash-high`, steamroller→`gemini-3.8-flash-high`; live `invokeTransport` `SLUG_OK`: piledriver `c1c4020a-9d73-49e8-8608-d7cabb5a1b4f` (12.6s), bulldozer `b77d81ae-4630-4d95-b403-55e122aae238` (10.4s) |

**Probes: 5/5 routing paths PASS** (Jaguar, Puma, Bobcat→Strix, Steamroller→Zen, runner exact-model), plus sanity and the static sweep (S1 `6e006d08-0ab3-45fa-99d6-52e8ad4f3aa1`). No `error: interrupted` occurred in any call.

## 3. Repo test suite (worktree @ `25f2877`, `TMPDIR=~/.cache/ntg56-tmp`)

| File | Result |
|---|---|
| tests/test_spine.mjs | 96/96 pass |
| tests/test_ledger.mjs | 39/39 pass |
| tests/test_runner_spike.mjs | 46/46 pass |
| tests/test_ntg_run.mjs | 12/12 pass |
| tests/test_studio_runner.mjs | 10/10 pass |
| tests/test_telemetry.mjs | 7/7 pass |
| tests/test_dag_view.mjs | 9 pass, 0 fail, 1 skipped (of 10) |
| tests/test_excavator_review_gate.py | 52 OK |
| tests/test_primary_review_gate.py | 39 OK |
| tests/test_gate_panel.py | 19 OK |
| tests/test_zen_shell_guard.py | 7 OK |
| tests/test_excavator_shell_guard.py | 4 OK |

**Total: 341 tests — 340 pass, 0 fail, 1 skipped** (node 219 pass + 1 skip; python 121 OK). All 12 files exit 0.

## 4. Findings

1. **Host `/tmp` quota exhausted** (OBSERVED): `/tmp` is a tmpfs mounted `usrquota`; writes fail with `EDQUOT` (errno -122) at 5.4G/6.8G. With the default `TMPDIR` the first suite run showed spurious failures in test_ledger (11), test_runner_spike (14), test_spine, test_telemetry, test_ntg_run, test_gate_panel (7 errors), test_excavator_review_gate, test_dag_view (3) — all `Unknown system error -122` writes. The first Puma/Bobcat probes dispatched correctly but left **0-byte** `/tmp` artifacts, and the Steamroller phase crashed in `acquireLedgerLock` (`mkdtemp` under `/tmp`). Rerun with `TMPDIR` and artifact paths under `~/.cache/ntg56-tmp` is fully green. This is an environment fault, not a code regression; /tmp was not cleaned (other processes' files).
2. **Harness verdict summary is misleading** (OBSERVED): the B2 one-line summary printed `VERDICT: NO-GO` because `extractEvidence` takes the last `VERDICT: (GO|NO-GO)` match from transcript text (which includes the prompt's `GO or NO-GO`); the authoritative `milestoneResult.verdict.verdict` is `"GO"`. Harness-only; does not affect product code.
3. Snapshot drift from #113 is resolved; `--agent` results above describe current main.

## 5. Remaining risks

- Single-host, single-day evidence on `agy 1.3.3`; `agy 1.2.12` paths were not re-run this time (#113 covered them).
- `multi_replace_file_content` (Bobcat-only declaration) still unobserved live (carried over from #113).
- `manage_task` present on the live surface but declared by no agent (carried over from #113).
- `error: interrupted` (2026-09-29) remains unexplained-but-unreproduced.
- The host `/tmp` quota makes the suite and any `/tmp`-writing agent work fail silently-ish (0-byte files); fix the environment or set `TMPDIR` before any activation trial on this host.
- Excavator / Piledriver primary `--agent` flows (Zen NO-GO correction loop, plan-readiness gate) were not part of the #113 probe set and were not re-exercised live here.

## 6. Recommendation

`activate` behind a flag (see PR decision card): all routing paths and the runner pass on the current install and suite is green, but the residual risks above argue for a reversible flag rather than a default flip.
