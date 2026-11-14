# PR #130 gate review: #113 live probe (option B)

- PR: sleegme/native-gravity#130, branch `feat/113-live-probe`, head `f72c9ab`, merge-base `1f898fe1` (origin/main is now `115b526`; the branch is behind main but adds only evidence files).
- Reviewer: omo-native-gate-reviewer (st_01a126b2). Date: 2026-10-11.
- **recommendation: APPROVE (verdict PASS)**
- **blockers: none**

## originalIntent
PO decision B on #113: run live probes of the 09 Preview `agy` binary to (1) diagnose the historical `error: interrupted` failures, (2) exercise the five routing paths live, and (3) re-run the static surface sweep. Commit the evidence, with no behavior changes.

## desiredOutcome
A trustworthy, reproducible evidence bundle that the PO can use to decide #113/#56. It must have raw transcripts behind every PASS claim, an honestly scoped not-reproducible finding, and a per-path result table.

## userOutcomeReview
The bundle delivers this. Every PASS claim traces to a real agy session transcript (`step_index`/`source`/`type`/`created_at` records written by the agy runtime) or to raw spawn output in `results.jsonl`. The weaknesses listed below are in labeling and indexing, not in the substance of the evidence. None of them changes a verdict.

## Criterion checks

| # | Criterion | Result | Evidence |
|---|---|---|---|
| a | Evidence is real transcripts/JSONL; claimed PASS paths have matching transcripts | PASS | 37 distinct session UUIDs, each in agy runtime transcript format. Per path: jaguar parent `ef957948` contains `TypeName:"jaguar"`, and child `e5a8b5be` receives a message from `ef957948` and reports `scripts/ledger.mjs` with 1,852 lines. Puma parent `23aa7f34` contains `TypeName:"puma"` and `PUMA_LEG_DONE`, and child `adfcde97` receives a message from `23aa7f34`, creates the note and reports. Bobcat parent `83305634` contains `TypeName:"bobcat"` and `BOBCAT_LEG_DONE`. Bobcat child `68a9cb5b` receives `ADVISOR_GATE: REQUIRED` from `83305634` and contains `TypeName:"strix-halo"`. Strix child `2ce1073e` receives a message from `68a9cb5b` and ends with "sent the ACCEPT verdict to Bobcat". Runner slug sessions `cabf0cc1` and `83b98fb6` both return `SLUG_OK`. |
| b | Interrupted diagnosis is honestly scoped | PASS | The section 1 heading reads "NOT REPRODUCIBLE on this host today". It lists the remaining hypotheses (transient service problem, an untested trigger, rate limiting) and keeps `probe.mjs` as the repro harness. It does not claim the bug never existed. One phrase in section 1, "host-date-specific", is an inference and should not be read as an established cause (Note N5). |
| c | Steamroller→Zen GO has OBSERVED evidence objects and a ledger entry | PASS | The last `B2-steamroller-zen` record in `results.jsonl` has `exit:0`, `milestoneResult.status:"DONE"`, `verified:true` and `verdict:"GO"`, with two `{classification:"OBSERVED"}` objects. Zen session `331b9754` returns the same bare JSON. In `ledgerTail`, `completed_milestones:["one"]` and the result_ref `ref-sha256-3c8f1fa9…` match. `candidate_artifact_ref` is `1f898fe1…:package.json`, which is the PR merge-base. `probe.mjs:206` confirms Zen ran as `--agent zen --model gemini-3.1-pro-low`. The three earlier failed attempts are kept and disclosed. |
| d | Runner slug table matches repo config | PASS | piledriver→`gemini-3.1-pro-high`, bulldozer→`gemini-3.8-flash-high` and steamroller→`gemini-3.8-flash-high` match `docs/specs/44b-runner-spike.md:15-17` and `tests/test_runner_spike.mjs:117-128`. `sweep.json.models` lists all three slugs as installed. `results.jsonl` `B3-slug-resolution-v2` holds the real `resolveSlug()` output (`scripts/runner.mjs:220`). The first attempt, which called a wrong function name, is also kept and not hidden. |
| e | Scope: evidence and docs only, no vNext behavior change | PASS | `git diff --name-only origin/main...origin/feat/113-live-probe` returns only paths under `.omo/evidence/`: 142 files, +1436/-0. `probe.mjs` lives under evidence and only imports `scripts/spine.mjs` and `scripts/runner.mjs`, without changing them. |
| f | All 5 paths documented with a per-path result | PASS | The section 2 table has one row per path, each with its own verdict and session IDs: Jaguar, Puma, Bobcat→Strix Halo (two hops), Steamroller→Zen end-to-end, and runner exact-model calls. |

Other claims I checked:
- The `sweep.json` claims hold: agy `1.3.3` and `1.2.12`, and `plugin validate` reports 9 agents and 4 hooks.
- The S1 live tool inventory for bulldozer matches the list in section 3.

## Notes (non-blocking; recommended cleanup)

- **N1. The transcript copier mislabels files.** The copier swept every recently touched brain session into each probe label. As a result, the same UUID appears under up to 5 labels: for example, `B1a-bulldozer-jaguar-e14e818b` is actually the A4 `pwd` run, and `B3-bulldozer-2ce1073e` is actually the Strix Halo child. Some of these copies differ because they were snapshotted mid-session. The filename prefix therefore does not identify which probe produced a session, and a reader has to go by UUID plus content. The doc cites sessions by UUID, so its claims remain correct.
- **N2. `results.jsonl` points at transcripts that do not exist.** The recovered B1c record names `B1c-bulldozer-bobcat-83305634-*`, but the committed file is `B1c-bulldozer-bobcat-strix-83305634-*`. The B1c2 record names `B1c2-strix-halo-advisor-68a9cb5b-*`, which was never committed. B1c2 also mislabels `68a9cb5b` as the Strix Halo advisor, when the transcript shows it is the Bobcat child that dispatched strix-halo (the doc gets this right). The content does exist under other filenames.
- **N3. The B2 citation mixes runs.** The doc cites `a517d9ee` (piledriver) and `700b56f3` (bulldozer) as role-body sessions of the GO run. Those sessions are from the first failed B2 attempt at 16:13Z. The GO run (16:36–16:40Z) used piledriver `3a59194e`, bulldozer `24509e77` and `e4bc8508` (the latter holds the DONE packet), and zen `331b9754`. Both sets prove role-body injection, but the citation should point at the GO run's own sessions.
- **N4. The harness verdict field is wrong in the GO record.** The successful B2 record carries `evidence.zenVerdict:"VERDICT: NO-GO"`. That is a false positive: the scraper matched the role-body text "exactly `VERDICT: GO | VERDICT: NO-GO`". The authoritative `milestoneResult.verdict` is GO.
- **N5. Section 1 claims transcripts confirm `run_command`, but some are missing.** A2 (`9c01103f`) and A3 (`252d0d26`, 1.2.12) have `transcriptFiles: []`. Their run is shown only by `status:SUCCESS` and `PWD_OK` stdout. Separately, the phrase "host-date-specific" in section 1 is an inference, not a demonstrated cause.
- **N6. The branch is behind `origin/main`.** Rebase before merging; there are no conflicts because the PR only adds files.

## Slop / overfit pass
The PR adds no tests and no production code. `probe.mjs` is a one-off harness kept as a repro tool, which is reasonable for an evidence PR. The doc is not over-padded. Its "honest findings" are backed by the failed-attempt records kept in `results.jsonl`, so they are not decoration. No code-review report or QA matrix was supplied with this task, so I could not cross-check those reports' skill coverage. This review rests only on my own direct inspection.

## Checked artifacts
- `.omo/evidence/113-live-probe-results.md`
- `.omo/evidence/113-live-probe/results.jsonl` (all 21 records)
- `.omo/evidence/113-live-probe/sweep.json`
- `.omo/evidence/113-live-probe/probe.mjs`
- All 136 `*-transcript{,_full}.jsonl` files, grouped by UUID; deep reads of `ef957948`, `e5a8b5be`, `23aa7f34`, `adfcde97`, `83305634`, `68a9cb5b`, `2ce1073e`, `a517d9ee`, `700b56f3`, `3a59194e`, `24509e77`, `e4bc8508`, `331b9754`, `13d2490b`
- Repo: `scripts/runner.mjs`, `docs/specs/44b-runner-spike.md`, `tests/test_runner_spike.mjs`

## Evidence gaps (exact)
- There are no transcripts for A2 or A3. The `run_command` execution in those two cases rests on agy stdout only.
- The `/tmp/ntg113-puma-note.txt` and `/tmp/ntg113-bobcat-marker.txt` files were removed, so I could not re-check them on disk. Their creation is shown only in the child transcripts.
- I did not re-run any probes live. This review verifies the committed artifacts, not reproducibility today.
