# Issue #113 — Live probe results: `agy` 09 Preview binary on this host

Date: 2026-10-10/11 (KST). Lane: `live-probe-113` (PO decision **B** on #113).
Binary under test: `agy 1.3.3` at `~/.local/bin/agy`. Reference binary: `agy 1.2.12` at `/usr/bin/agy` (pacman, unmodified).
Plugin under test: installed snapshot `~/.gemini/config/plugins/native-gravity` (imported 2026-09-30; `agy plugin list`). **This snapshot drifts from `origin/main`** — 4 agent bodies (bobcat, bulldozer, excavator, piledriver) and 3 hooks (excavator-review-gate, primary-review-gate, zen-shell-guard) differ from repo HEAD on main. All `--agent` results below describe the *installed* snapshot; runner-path results use `docs/specs/vnext/agents` role bodies from the checkout.
Harness: `.omo/evidence/113-live-probe/probe.mjs`; raw records `results.jsonl`; session transcripts copied per-run as `<label>-<uuid8>-transcript{,_full}.jsonl` in `.omo/evidence/113-live-probe/`; static sweep `sweep.json`.
Transcript location note: on 1.3.x sessions live at `~/.gemini/antigravity-cli/brain/<uuid>/.system_generated/logs/transcript{,_full}.jsonl` (moved from session root used by 1.2.12).

## 1. `error: interrupted` diagnosis — NOT REPRODUCIBLE on this host today

The validation doc recorded `error: interrupted` twice on multi-step prompts (2026-09-29, agy 1.2.12). Today's differential matrix, all `agy --print` headless calls from this repo cwd:

| Case | Binary | Flags | Prompt shape | Result |
|---|---|---|---|---|
| A0 | 1.3.3 | — | single-step | SUCCESS 9.8s |
| A1a | 1.3.3 | — | 2-step + `view_file` | SUCCESS 19.6s |
| A1b | 1.3.3 | skip | 2-step + `view_file` | SUCCESS 15.1s |
| A1c | 1.2.12 | — | 2-step + `view_file` | SUCCESS 16.6s |
| A1d | 1.2.12 | skip | 2-step + `view_file` | SUCCESS 13.2s |
| A2 | 1.3.3 | — | `run_command` (`pwd`) | SUCCESS 26.7s |
| A3 | 1.2.12 | — | `run_command` (`pwd`) | SUCCESS 14.4s |
| A4 | 1.3.3 | `--agent bulldozer` (sandbox policy), no skip | `run_command` (`pwd`) | SUCCESS 13.0s |

8/8 calls completed with `status:"SUCCESS"`; transcripts confirm actual tool execution (`view_file`, `run_command`). The `error: interrupted` failure mode is **not reproducible** on this host on either binary today. It was not a stable headless-permission block (the 1.3.x fix's signature failure is `jetski: ... auto-denied`, which also did not occur here — `run_command` executed ungated even without `--dangerously-skip-permissions` and under a `commandExecutionPolicy: sandbox` role). Remaining possibilities for the 09-29 failures: transient service/host interruption at that date, or a trigger not covered by this matrix (longer multi-tool chains, specific tool sequences, rate limiting). Multi-step headless sessions DO complete now; the live-routing gap was host-date-specific, not an intrinsic 1.2.12→1.3.3 blocker.

## 2. Routing paths — per-path results

| Path | Verdict | Evidence |
|---|---|---|
| Bulldozer → Jaguar | **PASS** | `ntg-run --agent bulldozer --model gemini-3.8-flash-medium --dangerously-skip-permissions -p <delegate discovery>`; parent session `ef957948` transcript_full shows `invoke_subagent` `TypeName:"jaguar"`, `Role:"Factual Discovery Specialist"`; jaguar child session `e5a8b5be`; bulldozer relayed the answer (`scripts/ledger.mjs`, 1,852 lines). |
| Bulldozer → Puma | **PASS** | parent session `23aa7f34` shows `invoke_subagent` `TypeName:"puma"`, `Role:"Quick Writing Worker"`; puma child `adfcde97`; artifact `/tmp/ntg113-puma-note.txt` = `alpha\nbeta\ngamma` verified on disk; parent ended `PUMA_LEG_DONE`. |
| Bulldozer → Bobcat → Strix Halo | **PASS (two-hop)** | parent session `83305634` shows `invoke_subagent` `TypeName:"bobcat"`, `Role:"Implementation Worker"` (ADVISOR_GATE: REQUIRED in packet); bobcat child `68a9cb5b` shows second `invoke_subagent` `TypeName:"strix-halo"`, `Role:"Implementation Advisor"` with the contract + observed evidence verbatim; strix child `2ce1073e` returned **ACCEPT** to bobcat; bobcat reported `STATUS: READY` via system message; parent ended `BOBCAT_LEG_DONE`; artifact `/tmp/ntg113-bobcat-marker.txt` = `marker\n`. |
| Steamroller → Zen (vNext runner path) | **PASS (end-to-end)** | `MinimalSpine.runMilestone('one')` with real `invoke`/`invokeZen`: runner composed role-body sessions `a517d9ee` (piledriver advisory), `700b56f3` (bulldozer) and `331b9754` (zen) prove role-body injection; milestone closed `status:"DONE", verified:true` — bulldozer returned a compliant DONE packet binding `candidate_artifact_ref = <commit-sha>:package.json`, Zen (`--agent zen --model gemini-3.1-pro-low`) returned `VERDICT: GO` with `verification_evidence` objects `{classification:"OBSERVED"}`, and the ledger records `completed_milestones:["one"]` with `result_ref`. (Two earlier model-compliance iterations are honest findings: Zen emits ```` ```json ```` fences unless told bare JSON, and emits string evidence unless told the OBSERVED-object schema; bulldozer needed `candidate_artifact_ref` in acceptance criteria.) Note: installed-snapshot steamroller.md is a read-only specialist with *no* `invoke_subagent` tool, so in-model Steamroller→Zen is structurally impossible there; the vNext path carries the delegation at the runner/spine layer, which is what was measured. |
| Runner exact-model calls | **PASS** | `resolveSlug()` on the live surface: piledriver→`gemini-3.1-pro-high`, bulldozer→`gemini-3.8-flash-high`, steamroller→`gemini-3.8-flash-high` (all present in `agy models`); live `invokeTransport` round-trips: piledriver SLUG_OK 10.5s, bulldozer SLUG_OK 8.3s, slug fields recorded in `results.jsonl`. |

Harness caveat (recorded honestly): the `run()` recorder had a TDZ bug that crashed three phases *after* the `agy` child exited; the spawn results were lost and verdicts for B1a/B1b/B1c are derived from the session transcripts + on-disk artifacts (which are the authoritative evidence anyway). Bug fixed; harness artifacts retained in `results.jsonl` marked `-recovered`.

## 3. Static sweep (showcommands-style inventory) — drift vs 1.2.12 doc

`agy showcommands` does not exist as a subcommand; the sweep was implemented as the decision card's intent — declared surface vs live surface. Artifacts: `sweep.json`.

| Surface | 1.2.12 doc (2026-09-29) | 1.3.3 today | Drift |
|---|---|---|---|
| `agy plugin validate .` | 9 agents, 2 hooks | 9 agents, **4 hooks** | +2 hooks (excavator-review-gate, primary-review-gate now declared in repo hooks.json — the doc predates them) |
| `agy agent` (primaries) | bulldozer, excavator, piledriver | same | none |
| `list_dir` | ABSENT on live surface | **PRESENT** (used by live bulldozer) | resolved |
| `find_by_name` | ABSENT | **PRESENT** | resolved |
| `grep_search` | ABSENT | **PRESENT** (observed in jaguar child transcript) | resolved |
| `multi_replace_file_content` | ABSENT | not observed in live tool inventory (bobcat-only declaration, not exercised) | open (unchanged risk) |
| `manage_task` | not in doc | **PRESENT** on live surface, declared by no agent | NEW undeclared tool |
| bulldozer live inventory | n/a | find_by_name, grep_search, invoke_subagent, list_dir, manage_subagents, manage_task, run_command, send_message, view_file | recorded (S1) |
| `write_to_file`/`replace_file_content` on bulldozer | n/a | absent — matches read-only intent | consistent |

Installed snapshot vs repo drift (recorded, not probed for fix): 4 agent files + 3 hooks differ; `agy plugin list` still reports `importedAt: 2026-09-30`. If the intent is to probe current-repo role bodies via `--agent`, the installed plugin needs a re-import; runner paths are unaffected (they read `docs/specs/vnext/agents` directly).

## 4. Conclusion for #113 / #56

- The "live host" requirement is met on this host today: headless multi-step and delegated sessions complete on both 1.3.3 and 1.2.12.
- All five routing paths exercised **live** with transcript-level `invoke_subagent` dispatches; the two-hop Bulldozer→Bobcat→Strix Halo advisory chain works end-to-end.
- The 1.2.12 tool-surface mismatch documented in `issue56-09preview-validation.md` is resolved on 1.3.3 (list_dir/find_by_name/grep_search exist); `multi_replace_file_content` remains unobserved (bobcat-only, needs a replacement-scenario probe to close).
- `error: interrupted` cause: not a stable local gate; not reproduced in 8/8 differential calls. Treat as historical/transient unless it reappears; if it does, the differential matrix in `probe.mjs` is the repro harness.

## Artifacts index

- `results.jsonl` — every invocation: argv, exit, timing, stdout/stderr tails, transcript file refs, extracted dispatches.
- `sweep.json` — declared vs live surface inventory.
- `probe.mjs` — reproducible harness (phase-arg driven).
- `*-transcript_full.jsonl` — session transcripts including `invoke_subagent` args verbatim.
- `/tmp/ntg113-puma-note.txt`, `/tmp/ntg113-bobcat-marker.txt` — on-disk artifacts (removed after doc).
