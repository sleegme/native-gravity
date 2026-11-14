# Gate review: PR #127 (feat/112-gate-panel @ 0d89c57)

recommendation: REJECT (verdict: FAIL)

## originalIntent
Issue #112, PO option A: a persistent, read-only gate-status panel that shows real Zen/Stop-hook gate state. It should be laid out horizontally and reuse the hook logic. If no Settings-tabs surface exists, the escape clause allows the smallest useful panel.

## desiredOutcome
An operator can look at the panel or its `--json` output and trust that it reports what the Stop hooks would actually decide for a session: which gate is armed (Zen/primary, excavator, or none), the Zen verdict, and stop vs continue.

## userOutcomeReview
The panel is read-only. It renders horizontally, its `--json` output is valid, it stays in scope, and the escape clause is used honestly. However, the panel's decision chain is a hand-copied re-creation of the hooks' `main()` functions, and that copy has already drifted. In three reproducible situations the panel reports the opposite of what the real Stop hook decides. A status panel that tells the user "stop" while the hook forces "continue" (or the reverse) does not deliver "real Zen/Stop-hook state". The consistency tests did not catch this because they cover only four fixtures, all on the happy path or close to it.

## Blockers

1. **violatedCriterion: (b) real state / (c) no copy-paste drift.** The panel leaves out the primary hook's pending-review short-circuit (`primary-review-gate.py` main: `pending_review = zen_started and request_index > verdict_index` -> continue/REVIEW_PENDING, which is checked *before* the READY/PLAN READY checks). `_primary_decision` in `scripts/gate_panel.py` has no equivalent. Result:
   - bulldozer with Zen in flight and non-READY text: hook=`continue`, panel=`stop "(no READY claim; gate not engaged)"`
   - piledriver with Zen in flight and no PLAN READY: hook=`continue`, panel=`stop`
   - bulldozer with Zen in flight and READY: the decision matches, but the panel gives the wrong reason (NO_VERDICT instead of PENDING).
   evidencePointer: `/tmp/gr127/probe.py` output, cases `bulldozer_pending_zen_working_text`, `piledriver_pending_no_planready`.

2. **violatedCriterion: (b) real state — armed-gate detection.** `detect_gate()` calls `primary_gate.detect_primary_role(records)` without passing `role_hint`. The hook passes `event.get("roleHint") or event.get("agentName")`, which its own docstring names as the primary attribution path on AGY 1.2/1.3 (issue #64). With `--event {"roleHint":"bulldozer"}` and READY but no Zen, the hook returns `continue` while the panel shows `gate none / stop / "no NTG gate owns this session"`.
   evidencePointer: probe case `roleHint_event_bulldozer_ready_nozen`; compare `scripts/gate_panel.py` `detect_gate` with `hooks/primary-review-gate.py` `main()`.

3. **violatedCriterion: (b) real state under `--event`.** The panel's docstring says it reports "the decision the Stop hook would return for the event in effect", and that `--event` is there "to inspect the decision under a different event". However, the panel never applies the hooks' first gate (`error` set, or `terminationReason` not in `NORMAL_STOP_REASONS`, makes both hooks return `stop`). With `{"error":"boom"}` or `{"terminationReason":"MAX_STEPS"}`, both hooks return `stop` and the panel returns `continue` (REVIEW_REQUIRED_BULLDOZER).
   evidencePointer: probe cases `error_event_bulldozer_ready_nozen`, `abnormal_reason_bulldozer_ready_nozen`.

Root cause shared by all three: the PR claims "Gate state is reused, not owned", but only the helper functions are reused. The decision chain (`_primary_decision`, `_excavator_decision`) is a re-transcription of each hook's `main()`. The smallest fix that removes the drift class is one of these: (a) run each hook's real `main()`/decision with the synthesized event (subprocess with stdin, as the consistency tests already do), or (b) extract a pure `decide(event, records)` in each hook and have both `main()` and the panel call it. Either way, extend the consistency tests to the probe cases above.

## Criteria results
| id | check | result | evidence |
|---|---|---|---|
| a | read-only | PASS | Code only reads (`read_transcript`, `check_child_log_verdict` reads). No hook `respond`/write path is called. `git status --porcelain` is identical before and after running the probe (`NO_TRACKED_CHANGES`). Importing the hooks may write ignored `hooks/__pycache__` (gitignored, so not gate state). |
| b | real Zen/Stop-hook state for Zen armed / Stop-hook armed / none | FAIL | Blockers 1-3. Matching cases: bulldozer GO, bulldozer READY+pending, piledriver GO, excavator GO/stale (PR tests), ungated -> none. |
| c | no copy-paste drift vs hooks/*.py | FAIL | Helpers and constants are imported (good). The decision chains are copies with three divergences (blockers 1-3). Excavator chain: checked line by line, equivalent, including stale logic (`verdict_index>=0 and latest_change>verdict_index` only matters after the GO branch, so it is equivalent to the hook). |
| d | 117 py + 120 mjs | PASS | `python3 -m unittest discover -s tests` -> `Ran 117 tests ... OK`. `node --test tests/*.mjs` -> `tests 120 pass 120 fail 0`. |
| e | `--json` valid | PASS | Mixed ungated + missing transcripts parse with `json.load`. The probe parsed `--json` output in 7 cases. |
| f | scope | PASS | `git diff --name-only origin/main...HEAD`: docs/usage.md, package.json (+1 files[] entry), scripts/gate_panel.py, tests/test_gate_panel.py. Single commit 0d89c57. `hooks/` is already in package `files[]`, so the shipped script can load the hooks. |
| g | escape clause honest | PASS | The repo-wide grep for `settings[ _-]?tab|settingsTab|"settings"` finds only the PR's own prose. plugin.json has no UI or settings keys, and hooks.json has only PreToolUse/Stop command hooks. NOTE: the PR **title** "gate panel inside Settings tabs" contradicts the body and the actual deliverable. Retitle it. |

## remove-ai-slops / programming pass (direct)
- Overfit tests: the `GatePanelConsistencyTests` class gives false confidence. It is presented as proof that "panel decision equals hook decision" but covers only 4 fixtures and never exercises pending review, roleHint events, or abnormal events. This is exactly where the drift lives.
- Several render tests assert prose substrings (`"predates"`, `"Zen" in reason`, `"VERDICT: GO" in row`). These are minor prose pins (NOTE).
- `_latest_text` is a one-line pass-through wrapper (NOTE: needless indirection).
- Duplicated decision logic is a maintenance burden: every future hook change must be mirrored by hand (this is blockers 1-3).
- `detect_gate` checks excavator first and returns a single role. Both Stop hooks actually fire, so a transcript that matches both would show only one row (NOTE: edge case, not a stated criterion).
- No code-review report or QA matrix was supplied to this reviewer, so report coverage could not be cross-checked (evidence gap).

## Checked artifacts
- /home/sleeg/work/native-gravity-112-gate-panel (worktree, HEAD 0d89c57 == origin/feat/112-gate-panel)
- scripts/gate_panel.py, tests/test_gate_panel.py, docs/usage.md, package.json (diff)
- hooks/primary-review-gate.py, hooks/excavator-review-gate.py, hooks.json, plugin.json
- PR #127 body/title via `gh pr view 127`
- /tmp/gr127/probe.py (scratch differential probe: hook subprocess vs panel `--event --json`)

## Evidence gaps
- `agy plugin validate .` was not re-run by this reviewer (claimed "ok" in PR body); not needed for the verdict.
- No executor code-review report, QA matrix, or notepad was provided.

---

# Re-review: PR #127 @ 79c9a8e (fix for blockers 1-3)

recommendation: APPROVE (verdict: PASS)

blockers: none

## originalIntent / desiredOutcome
These are unchanged from the original review. The panel must report what the Stop hooks actually decide, with no copy-paste drift.

## userOutcomeReview
The drift is fixed at its root cause. Each hook's `main()` is now a thin wrapper: it parses stdin, calls `read_transcript`, then `decide(event, records)`, then `respond`. The panel calls that same `gate.decide(event, records)` from the module it imports, so it no longer uses a copy. All three earlier divergences now match the real hook subprocess. An operator can trust the decision/reason the panel shows.

## Checks
| id | check | result | evidence |
|---|---|---|---|
| a | the panel calls the same code as the hooks' main() | PASS | `git diff 0d89c57..79c9a8e`: `_primary_decision`/`_excavator_decision`/`_latest_text` are deleted. `evaluate()` calls `gate.decide(event, records)`. Both hook `main()` functions call `decide()`. The body of `decide()` is a line-for-line transform of the old `main()` chain (`respond(x[,r]); return` -> `return x, r|None`). The order is preserved, including pending-review before READY and the error/terminationReason first gate. `respond()` omits a falsy reason, so `("stop", None)` emits the same bare `{"decision":"stop"}` as before, and hook behavior is unchanged. |
| b | the 3 original mismatches now agree | PASS | `/tmp/gr127/probe.py <worktree>` reports all 7 cases as MATCH: bulldozer_pending_zen_working_text, bulldozer_pending_zen_ready (reason is now REVIEW_PENDING), piledriver_pending_no_planready, roleHint_event_bulldozer_ready_nozen, error_event, abnormal_reason (MAX_STEPS), zen_only_bulldozer_go. `detect_gate` now passes `role_hint=event.roleHint or agentName`. |
| c | the new parity tests assert hook-vs-panel agreement | PASS | `_assert_hook_parity` runs the real hook script as a subprocess and the panel CLI `--event --json` on the same event. It asserts that decision is equal, and that reason is equal whenever the hook emits one. The tests cover pending Zen (3 transcripts), roleHint, agentName, and error/MAX_STEPS for both hooks. Mutation check: reverting the roleHint pass-through in a copy (`/tmp/gr127/mut`) makes `test_role_hint_event_...` and `test_agent_name_event_...` FAIL, so the tests can fail on real drift. |
| d | `--json` valid; read-only | PASS | `gate_panel.py --transcript /nonexistent --json` parses with `json.load` (JSON_OK), and the probe parsed `--json` in all 7 cases. `git status --porcelain` is identical before and after the probe and the test runs (NO_TRACKED_CHANGES). The panel never calls `respond`. |
| e | scope | PASS | `git diff --stat 0d89c57..79c9a8e` shows only hooks/{primary,excavator}-review-gate.py (pure extraction of decide()), scripts/gate_panel.py, and tests/test_gate_panel.py. The PR's total file set is the earlier 4 files plus the 2 hooks, and the hook edits are needed for the chosen fix (option b from the original review). |
| suites | python + mjs | PASS | `python3 -m unittest discover -s tests` gives `Ran 121 tests ... OK`. `node --test tests/*.mjs` gives `tests 120 pass 120 fail 0`. Both match the executor's claim. |

## remove-ai-slops / programming pass (direct): NOTES only
- `_fallback_reason` re-checks `error`/`terminationReason` against `NORMAL_STOP_REASONS` to label a bare stop. This is a small display-only re-implementation. It cannot change the decision, but it could mislabel the row if the hook's first gate changes. NOTE.
- `evaluate()` still recomputes excavator `stale` from `review_state` for the display column. This is display-only, and the decision comes from `decide()`. NOTE.
- `"VERDICT: GO observed"` can label a bare stop that actually came from "no READY claim". This is cosmetic. NOTE.
- `detect_gate` returns a single role (excavator first). The earlier NOTE about transcripts that match both hooks still applies and is not a criterion.
- PR title "inside Settings tabs" vs the escape-clause deliverable: the earlier NOTE still applies (not re-checked here).
- The new tests are not tautological. They compare two independent execution surfaces (hook subprocess vs panel CLI), and the mutation shows they fail on drift.

## Checked artifacts
- /home/sleeg/work/native-gravity-112-gate-panel (HEAD 79c9a8e == origin/feat/112-gate-panel)
- `git diff 0d89c57..79c9a8e` (4 files)
- hooks/primary-review-gate.py, hooks/excavator-review-gate.py (`respond`, `decide`, `main`)
- /tmp/gr127/probe.py (re-run), /tmp/gr127/mut (scratch mutation copy)

## Evidence gaps
- No executor code-review report or QA matrix was supplied for 79c9a8e, so report coverage could not be cross-checked. The direct checks above stand in for it.
- `agy plugin validate .` was not run (not a criterion of this re-review).
