# PR #131 gate review: ntg-dag read-only ledger viewer

- PR: sleegme/native-gravity#131, head `feat/ntg-dag-view` @ `67078ce`, base `main`
- Design: `.omo/evidence/dag-viewer-design.md` (option B)
- Reviewer runtime: Node v26.8.1, 2026-10-11

## recommendation

**REJECT (FAIL).** Two blockers. Watch mode exits when the ledger graph is invalid, and every box's top border is one column wider than its body.

## originalIntent

The owner wants to see the vNext ledger milestone DAG in the TUI next to `agy`, the way omo-herdr-dag does it. The design picks option B: a read-only script with no dependencies (`ntg-dag`) that prints Unicode boxes and has a live `--watch` mode for a herdr or tmux side pane.

## desiredOutcome

`ntg-dag --ledger <path> --watch` in a side pane shows a correct, aligned box DAG of milestone states. It survives transient or bad ledger states by keeping the last good frame, and it never writes the ledger. The one-shot mode prints the section 3.3 frame and uses exit codes 0, 1 and 2.

## userOutcomeReview

The one-shot mode mostly works. The state tags, layers, header, footer, list fallback and exit codes are all correct. Two things fail:

- **Watch mode crashes on bad input.** The live side pane is the main use case. If a ledger fails the graph checks (cycle, dangling dependency, self-edge, duplicate id, empty milestones), the watcher process crashes with an uncaught exception instead of keeping the last good frame.
- **The boxes are visibly misaligned.** Every top border sticks out one column past the right edge of the box.

## blockers

### B1: watch mode exits on a graph error instead of keeping the last good frame

- **violatedCriterion:** criterion 1 ("atomic-save aware, renders last good on transient failure"), as specified in design section 3.5 ("On a read, parse or graph error, the last good frame stays ... Watch mode never exits because of ledger errors").
- **Observation:** `draw()` (scripts/dag-view.mjs about line 210-225) wraps only `load()` (the read and JSON parse). On a successful parse it calls `render(r.ledger, ...)`, and `checkGraph` throws inside `render` with no try/catch. The exception escapes from the `watchFile` callback and kills the process.
- **evidencePointer:** a reproduction run in this session.
  - Setup: copy the fixture to a temp dir and run `--watch --width 80` on the copy.
  - Malformed JSON replaced via `mv`: the watcher survived and printed `! Expected property name ... (showing last good frame)`. This part is correct.
  - Valid JSON with a cycle (`schema` depends on `release`) replaced via `mv`: the output was `PROCESS DIED after cycle`, and stderr showed `at render (scripts/dag-view.mjs:97:3) / at draw (:217:19) / at StatWatcher.<anonymous> (:239:48)`.
- **Test gap:** no test exercises watch mode at all.

### B2: each box's top border is one column wider than its body and bottom

- **violatedCriterion:** criterion 3 (layout), and A1 ("prints the frame in section 3.3", where box borders line up).
- **Observation:** `top = "┌ " + id + "─"*fill + st + " ┐"` with `fill = inner - id - st - 1` gives a width of `inner + 3`. The body and bottom lines are `inner + 2`, so the `┐` sits one column to the right of every `│` and `┘`. The id also runs straight into the rule (`┌ schema────`) instead of `┌ schema ──` as in the sketch. Separately, `boxW` uses `dispW(id)+10+4` rather than the design's `id+tag+6` clamp, which gives inner width 19 instead of 20. That last point is not a blocker by itself.
- **evidencePointer:** `node scripts/dag-view.mjs --ledger tests/fixtures/dag-view/all-states.ledger.json --width 80 --no-color | awk '{print length($0)}'` printed `26: L0  ┌ schema────────DONE ┐` and `25:     │ Ledger schema     │` / `25:     └───────────────────┘`. The skew is visible in every row of the A1 output.
- **Test gap:** the A1 test checks only regexes such as `┌ schema.*DONE`, so it passes with the boxes misaligned.

## Criterion-by-criterion

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Read-only; atomic-save aware | **FAIL (B1)** | Searching for `writeFile`, `renameSync`, `openSync`, `unlink`, `mkdir`, `acquireLedgerLock` and `appendFile` in the script found nothing, so it is read-only. It uses `watchFile` polling by path, and a JSON parse failure keeps the last good frame (observed). A graph error crashes the process (B1). |
| 2 | States per section 3.1 | PASS | `stateOf()` order: ACTIVE, DONE, BLOCKED, NO-GO (not stale), STALE, READY, PENDING. That is the design's first-match order (NO-GO and STALE are mutually exclusive). In the A1 output: schema/store DONE, cli STALE `was GO@1`, docs NO-GO, api ACTIVE, auth BLOCKED, metrics READY, e2e/release PENDING. DONE trusts `completed_milestones` as the design says (section 3.1: "the writer guarantees a fresh GO"). |
| 3 | Layout (L rows, perRow, list fallback) | **FAIL (B2)** | perRow = `max(1, floor((width-2)/(boxW+2)))` is correct: width 80 gives 3 per row and width 56 gives 2 per row (observed). The list fallback at `width < boxW+4` works: width 24 printed `L0 DONE    schema`. Box borders are misaligned (B2). |
| 4 | Exit codes 0/1/2 | PASS | Observed: A1 exits 0. Missing file, malformed JSON, self-edge, cycle and dangling dependency exit 1. No ledger, `--bogus`, `--width 0` and `--width abc` exit 2. |
| 5 | Test coverage (A1, narrow, cycle, dangling, missing, usage, read-only, env-var) | PASS (presence) | `node --test tests/test_dag_view.mjs`: 8/8 pass. The full `node --test tests/*.mjs`: 128/128 pass. All the listed cases exist, but they are shallow (see notes). |
| 6 | No production code changes | PASS for the PR's own commit | `git diff f72c9ab 67078ce --name-only` shows only `scripts/dag-view.mjs`, `tests/**`, `package.json` and `docs/{,ko/}usage.md`. `npm pack --dry-run` lists `scripts/dag-view.mjs`, and `node --check` passes. |

## Notes (not blockers)

- **N1, stacked diff:** the PR's GitHub file list against `main` still includes about 142 `.omo/evidence/113-live-probe*` files from `f72c9ab`. PR #130 for `feat/113-live-probe` is MERGED. Rebase onto `main` so #131 shows only its own six files.
- **N2, fixture not built through the real API:** the fixture does not load with `AuthoritativeLedger.load()` and fails with `Zen GO verification milestone_id must be a non-empty string`. It uses a numeric `plan_version` (2), which gives `plan 2` and `was GO@1` instead of the design's `plan v2` and `was GO@v1`. The A1 test pins `plan 2`. Design section 7 and A2.1 require a fixture generated by the API so that schema drift (R3) fails a test. That protection is currently missing.
- **N3, design artifacts missing:** the design's A2 asks for tests and fixtures that are not here. None of them is in the brief's criterion 5 list, so they are recorded as gaps:
  - the `wide-cjk.ledger.json` fixture
  - the `validatePlan()` parity test (A2.4)
  - the `acquireLedgerLock` concurrent-read test (A2.6)
  - the directory-listing and sha256 read-only check (the current check compares contents only, and one-shot only)
  - the event-driven watch test (A2.7)
  - tests for the line-width limit and for no `\x1b[` in piped output (the absence of escapes was checked manually: the count was 0)
- **N4, watch-mode details that differ from section 3.5:**
  - The `watching <path> · updated` header line appears only on error frames, not on good frames.
  - With non-TTY output there is no blank line between frames.
  - The `waiting for` frame was printed twice at startup when the file was missing.
  - The `fs.watchFile` callback also fires on unrelated stat changes.
  - There is no tall-frame fallback to the list layout in watch mode.
- **N5, help exit code:** `-h` and `--help` print usage and exit 2. Help normally exits 0, and the design lists `-h` separately from usage errors.
- **N6, smaller layout gaps:**
  - Wrapped rows repeat the `Lk` label, where the design continues them under the same label.
  - There is no `+N` dependency overflow; deps are only clipped.
  - Combining marks are counted as width 1, where the design says 0.
  - Ids are never clipped, so long ids widen the top border further (`fill` has a minimum of 1).
  - `--ledger` with no value silently overrides `NTG_LEDGER` and becomes a usage error. That behaviour is fine.
- **N7, slop and overfit pass:** I found no excessive, tautological or implementation-mirroring tests, and no unnecessary production extraction. The problem is the opposite: the tests are too weak. The regex-only A1 test gives false confidence; it passed with the B2 misalignment.

## Code review report / QA matrix

No separate code-review report, manual QA matrix or executor evidence was supplied with this task. Every conclusion above comes from my own runs.

## Checked artifacts

- `.omo/evidence/dag-viewer-design.md`
- `scripts/dag-view.mjs` @ 67078ce
- `tests/test_dag_view.mjs`
- `tests/fixtures/dag-view/all-states.ledger.json`
- `package.json` diff, `docs/usage.md` diff (`docs/ko/usage.md` by stat only)
- `gh pr view 131` file list; `gh pr list --head feat/113-live-probe` (#130 MERGED)

## Exact evidence gaps

- A4 (`agy plugin validate .` unchanged) and A6 (live herdr pane): not run.
- The resize path on a real TTY: not exercised.
- `docs/ko/usage.md`: content not read (diff stat +15 only).
