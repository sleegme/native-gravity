# Instinct (#20) + #136 — implementation results

Branch: `fix/136-bulldozer-relay` (base `main` @ da11485). Product version bumped to 1.1.0 (B bump: new specialist per `docs/versioning.md`). All published local home-directory paths are redacted to `<HOME>`.

## A. #136 fix

`agents/bulldozer.md` MACHINE-INVOCATION MODE now states that specialist/worker
reports (Jaguar findings, Puma/Bobcat results, Strix Halo verdicts) are relayed
only inside packet fields (`verification_evidence`, `delegations` findings),
never as text before or after the JSON object. `scripts/runner.mjs`
`parseResponsePacket` is unchanged, per the brief. It accepts one unambiguous object (narration without JSON-like tokens may be unwrapped) and fails closed on malformed, multiple or ambiguous output.

## B. Instinct (#20)

- `agents/instinct.md` — runner-only role body (`mainAgent: false`,
  `subagent: false`), read-only file tools only, no shell; MACHINE-INVOCATION
  MODE returns one bare JSON object (`current_framing`,
  `why_current_framing_may_be_wrong`, `alternate_hypotheses` each with
  `hypothesis` + `evidence_basis` (`OBSERVED`/`INFERRED`/`UNKNOWN`) +
  `discriminating_test`, `recommendation`, `unknowns`); tier-B visibility
  boundary identical to Piledriver (no prompt/role text).
- `scripts/runner.mjs` — `instinct` added to runner roles and
  `ROLE_POLICY_TABLE` (Claude Sonnet 5.5 / High; `escalated` family Claude
  Opus 5.5 / High). Exact slugs resolve from the installed `agy models`
  surface via the existing policy matcher; `resolveSlug(role, { escalate:
  true })` is the only path to Opus, and missing/ambiguous surfaces fail
  closed with `UnresolvedModelSlugError` (no silent fallback). The family
  matcher also compares a dot-to-dash slug variant so `claude-sonnet-5-5-high`
  resolves like the Gemini slugs do.
- `scripts/spine.mjs` — `requestAltFraming(task, { milestone,
  current_hypothesis, escalate })` builds a bounded NEEDS_ALT packet (failure
  class/signature, current hypothesis, attempt count, evidence, tier-B
  `replan_context`) derived from the durable failure history and invokes
  Instinct through the runner. The result is recorded as advisory evidence
  (`scripts/ledger.mjs` `recordAltAdvice`, `adopted: false`) and never
  promotes, adopts or mutates completion state. Exported
  `recommendNeedsAlt(evidence)` implements contract §2.9: recommend NEEDS_ALT
  when the same failure class (milestone:status:failed-step tool) has >= 3
  attempts and the latest attempt recorded no new evidence (its failure
  signature — sha256 of the recorded evidence — repeats an earlier attempt).
  Recommendation only; paid calls are never auto-run.
- `scripts/ntg-vnext.mjs` — subcommand
  `ntg-vnext alt --ledger PATH --task "..." [--milestone ID] [--escalate]`
  prints `{ advisory_alt: <Instinct JSON>, adopted: false }`; `status`/`init`
  now include per-failure-class `needs_alt` recommendations.
- Tests extended in existing styles (`tests/test_runner_spike.mjs` §7,
  `tests/test_spine.mjs`, `tests/test_ntg_vnext.mjs`): role/slug resolution,
  fail-closed missing and ambiguous slug (default and escalated), Opus only
  on explicit escalation (resolve + transport `--model` capture), handoff
  packet fail-closed, spine never mutates completion from Instinct (incl.
  hostile packets claiming `verdict`/`result_ref`/`completed_milestones`),
  Instinct response fail-closed (two objects / prose / malformed),
  NEEDS_ALT policy derivation from real durable failure history and its
  >=3-with-repeat threshold, CLI wiring (`alt`, `--task` required,
  `--escalate`, `--milestone`, `status` recommendations). No prose-pinning.
- Docs EN+KO: README, usage, architecture, status (+KO mirrors), AGENTS.md,
  `rules/orchestration.md` (new "Steamroller -> Instinct (NEEDS_ALT)" section),
  contract §2.10 / §6.3 model row / §6.4 / OQ-4 marked resolved.
- Version 1.1.0: `VERSION`, `package.json`, `scripts/npm-install.mjs`
  fallbacks, `docs/versioning.md` matrix row. `agents/` packaging already
  covers `agents/instinct.md` (verified in the tarball).

## Deterministic verification

Environment: `TMPDIR=$HOME/.cache/ntg-instinct-tmp`, `SKIP_LIVE_TESTS=1`,
`set -o pipefail`.

| Command | Result |
| --- | --- |
| `python3 -m unittest discover -s tests` | Ran 74 tests — OK |
| `node tests/test_runner_spike.mjs` | 48 passed, 0 failed |
| `node --test tests/test_spine.mjs` | 103 passed, 0 failed |
| `node --test tests/test_ntg_vnext.mjs` | 12 passed, 0 failed |
| `node tests/test_ledger.mjs` | 39 passed, 0 failed |
| `node --test tests/test_telemetry.mjs` | 7 passed, 0 failed |
| `node --test tests/test_dag_view.mjs` | 9 passed, 0 failed, 1 skipped (pre-existing) |
| `node --test tests/test_studio_runner.mjs` | 10 passed, 0 failed |
| `agy plugin validate .` | 10 agents processed, 3 hooks processed — OK |
| `npm pack --dry-run` | `native-gravity-1.1.0.tgz`, 31 files, `agents/instinct.md` included |
| `git diff --check` | clean |

Total deterministic assertions: 367 across 8 files (358 pass, 1 pre-existing
skip) + 74 Python tests.

Escalation selection (Opus) is covered deterministically only:
`tests/test_runner_spike.mjs` 7.1/7.2/7.3 assert `claude-opus-5-5-high` is
selected exactly when `escalate: true` and never otherwise (mock transport
captures the `--model` argv). **Opus was not run live** (quota), per the brief.

## Live verification (Sonnet)

One real `ntg-vnext alt` call against a small ledger in `~/.cache`:

```bash
LIVE=$HOME/.cache/ntg-instinct-tmp/live
node scripts/ntg-vnext.mjs init --ledger "$LIVE/ledger.json" --plan "$LIVE/plan.json"
node scripts/ntg-vnext.mjs alt --ledger "$LIVE/ledger.json" \
  --task "Milestone 'one' repeatedly fails the same way with no new evidence. Current framing assumes the artifact write itself is at fault. What materially different framings should we consider?"
```

- Exit 0, wall clock 24s, output: `<HOME>/.cache/ntg-instinct-tmp/live/alt-out.json`
- Conversation id: `7c887522-8e8e-4449-abbe-decb474cfb03`
  (`server.go:1278] Created conversation 7c887522-8e8e-4449-abbe-decb474cfb03`)
- Session store: `<HOME>/.gemini/antigravity-cli/brain/7c887522-8e8e-4449-abbe-decb474cfb03/.system_generated/logs/transcript.jsonl`
  (2 records: `USER_INPUT` carrying the composed bounded prompt — role body
  `# Instinct` + NEEDS_ALT packet — and the model response with
  `input_tokens`/`output_tokens`).
- Model slug observed as Sonnet in the run's CLI log
  (`<HOME>/.gemini/antigravity-cli/log/cli-20261012_164218.log`, the log this
  conversation id appears in 11 times):

```text
printmode.go:202] Print mode: starting (promptLength=5444, model="claude-sonnet-5-5-high", conversationID="")
model_resolver.go:93] Resolving model claude-sonnet-5-5-high   (x4)
resolver.go:85] Model ID claude-sonnet-5-5-high not in local config, defaulting to CCPA
```

The AGY 1.3.3 session transcript records steps but no model field; model
identity for this run is observed in the per-run CLI log above and in the
runner's deterministic resolution (`claude-sonnet-5-5-high`, tests 1.6/7.1).

Returned advisory JSON (verbatim; `adopted: false`):

```json
{
  "advisory_alt": {
    "current_framing": "The milestone 'one' keeps failing because the artifact write itself (creating/writing one.txt) is defective, so retries focus on re-performing or repairing that write.",
    "why_current_framing_may_be_wrong": "The packet contains no failure evidence: milestone_id is null, failure_class and failure_signature are 'unknown', current_hypothesis is UNKNOWN, attempt_count is 0, evidence is empty, and the replan context shows current_milestone null, no failure_telemetry and no verification_summary. Nothing observed supports 'repeated failure' or 'the write is at fault', so the premise may not match recorded state. If any failure did occur, the acceptance criterion 'content matches milestone ID' is ambiguous. Neither the expected content nor the exact comparison rule (trailing newline, case, 'one' vs a ledger ID) is defined, so a correctly written file could still be judged as failing. The fault could lie in the criterion, the verifier or the handoff rather than the write.",
    "alternate_hypotheses": [
      {
        "hypothesis": "The acceptance criterion is underspecified or mismatched. The file content is written as something other than the exact string the verifier expects, for example 'one' vs 'one\\n', a title vs an ID, or a different casing or format.",
        "evidence_basis": "INFERRED",
        "discriminating_test": "Recommended check, to be run by an authorized role: run `cat -A one.txt` and `xxd one.txt`, then compare byte for byte with the literal milestone ID 'one' with and without a trailing newline. If the file already matches under any reasonable reading, the write is not at fault and the criterion needs to be made exact."
      },
      {
        "hypothesis": "Verification or review is evaluating the wrong thing: a stale or mismatched candidate/result_ref, a different working directory or path, or a pre-write snapshot of one.txt. The artifact is fine but the check does not see it.",
        "evidence_basis": "UNKNOWN",
        "discriminating_test": "Compare the candidate_artifact_ref and plan_version in the ledger with the file's current content and mtime. Run the verifier from the same cwd that holds one.txt. If the verifier passes on the current file at the correct path, the cause was binding or path, not the write."
      },
      {
        "hypothesis": "The failure is in the handoff or packet. The milestone packet is malformed (milestone_id null in the NEEDS_ALT packet, empty evidence) so the executor or runner is failing before any write occurs, and the same pre-write error repeats.",
        "evidence_basis": "OBSERVED",
        "discriminating_test": "Check that the packet issued to Bulldozer carries milestone_id 'one' and the current plan_version, and inspect the runner's invocation logs and error output for the first failing step. If no write tool call is ever recorded, the failure is upstream of the artifact write."
      },
      {
        "hypothesis": "The environment blocks the write: the workspace directory is non-writable, the path is outside the permitted scope, or a file already exists with different permissions or ownership, so the failure is a permission or scope issue rather than content.",
        "evidence_basis": "UNKNOWN",
        "discriminating_test": "Run `ls -ld .` and `ls -l one.txt`, `test -w .`, and attempt a harmless write in the same directory under the same identity as the executor. If it succeeds, drop this hypothesis."
      },
      {
        "hypothesis": "There is no actual repeated failure. NEEDS_ALT was triggered with attempt_count 0 and no evidence, so it is premature or a spurious trigger, and the correct move is to run the first attempt and collect real failure telemetry.",
        "evidence_basis": "OBSERVED",
        "discriminating_test": "Check that the ledger's failure_telemetry and verification entries for milestone 'one' are empty, and that next_action still says 'Ready to delegate initial milestone: one'. If no prior attempt exists, treat the framing as untested."
      }
    ],
    "recommendation": "Do not act on the 'write is at fault' framing yet. First establish what actually failed. Capture the real failure_class, failure_signature and the failing step's tool name from runner telemetry, and tighten the acceptance criterion to an exact expected content string. Then run the cheap checks above (byte-level view of one.txt, path and cwd, ledger binding, directory writability) before any further rewrite of one.txt.",
    "unknowns": [
      "Whether any attempt has actually happened. The packet shows attempt_count 0 and no evidence, which conflicts with 'repeatedly fails'.",
      "The exact expected content and comparison rule for 'content matches milestone ID', including newline and case handling.",
      "Whether one.txt currently exists and what it contains. I made no inspection here, and the answer would decide between the content, path and binding hypotheses.",
      "What the verifier or reviewer saw in the failing runs, and which tool step failed. Without it the failure class is unresolved."
    ]
  },
  "adopted": false
}
```

Schema and boundary observations from the live run:

- The JSON carries every contract-required field; `alternate_hypotheses` all
  carry `evidence_basis` in {OBSERVED, INFERRED, UNKNOWN} and a
  `discriminating_test`.
- Instinct observed the empty failure history itself (the live ledger had no
  failures; the derivation from real failure history is covered by
  `tests/test_spine.mjs` and `tests/test_ntg_vnext.mjs`) and refused to
  endorse the injected framing — expected advisory behavior.
- Post-state of `ledger.json`: `completed_milestones: []`,
  `current_milestone: null`, `plan_version: "v1"`, and
  `evidence.alt_framing` = 1 entry with `adopted: false`. Nothing promoted.

## Unresolved issues

1. **Transcript model field**: AGY 1.3.3 session transcripts do not record the
   model slug; "transcript model is Sonnet" is confirmed via the per-run CLI
   log (`model="claude-sonnet-5-5-high"`) plus deterministic slug resolution,
   not the transcript file itself.
2. **Opus tier not live-validated** (deliberate, quota): escalation selection
   is deterministic-test-only (runner spike 7.1-7.3).
3. **"No new evidence" rule** is a documented interpretation: the latest
   attempt's recorded-evidence digest repeating an earlier attempt of the same
   class. First attempts always count as new evidence, so NEEDS_ALT can never
   trigger below 3 attempts.
4. `tests/test_dag_view.mjs` retains its pre-existing 1 skipped test
   (unrelated to this change).
5. `ntg-vnext alt` accepts an explicit request with no failure history
   (packet fields default to `unknown`/`0`); the recommendation path in
   `status` is what enforces the ≥3-attempts threshold. Live call observed
   this case (Instinct flagged it as hypothesis 5).

---

# Excavator demotion to Bulldozer worker (owner choice 3) — results

Branch: `fix/136-bulldozer-relay`, on top of `1d938f4` (the Instinct/#136
commit above). Owner decision (Discord 1559103837862891571): Excavator is no
longer a natively selectable primary; it is a specialist worker that only
Bulldozer invokes, for difficult diagnose -> reproduce -> root-cause ->
repair -> verify work inside one milestone. Version stays 1.1.0 (same release
as #20/#136). Home paths redacted to `<HOME>`.

## Implementation

- `agents/excavator.md` — worker role body: `mainAgent: false`,
  `subagent: true`, `invoke_subagent` tool removed, no `inheritCustomizations`
  field. Primary-only semantics are gone: no READY/BLOCKED primary completion
  claim (STATUS is a local worker signal like other workers') and no Zen
  invocation (Zen is Steamroller's independent milestone gate; Bulldozer and
  its children never invoke it). Return contract: ROOT_CAUSE
  (`CONFIRMED | LIKELY | SPECULATIVE`) / CHANGES / VERIFICATION_EVIDENCE /
  ROLLBACK / RESIDUAL_RISK / STATUS (`READY | BLOCKED`). Investigation depth,
  root-cause discipline, the sudo/privilege boundary and the
  `NTG_EXCAVATOR=1 ` marker + `hooks/excavator-shell-guard.py` are preserved.
  The body documents that #137's `inheritCustomizations: true` decision
  applied to the native primary and is superseded.
- `agents/bulldozer.md`, `rules/orchestration.md`, `AGENTS.md` (plus
  `rules/harness.md`, `agents/zen.md` consistency) — routing adds Excavator
  as Bulldozer's hard broken-behavior worker (vs Bobcat for ordinary
  implementation); Excavator has no nested delegation and never invokes Zen;
  return contracts list the Excavator worker result.
- Removed the native-primary Zen completion gate with its primary:
  `hooks/excavator-review-gate.py`, its `hooks.json` Stop entry and
  `tests/test_excavator_review_gate.py`; and the display-only
  `scripts/gate_panel.py` + `tests/test_gate_panel.py` (existed only to render
  that gate) with their `package.json` and docs references. Issue #112 history
  stays in `.omo/evidence`. No reason to keep them was found: with Excavator
  forbidden from invoking Zen the gate would manufacture an endless-continue
  loop on worker READY.
- `scripts/spine.mjs` — `excavator` added to the specialist roles, to
  Bulldozer's allowed delegation set (adapter routing and the post-hoc
  `delegations` check in `runMilestone`), and to the no-delegation callers
  (it can never invoke subagents). `tests/test_spine.mjs` covers:
  `[{ role: 'excavator' }]` delegations reach independent review (would fail
  if excavator were rejected), the reject list keeps non-worker roles (zen,
  piledriver, steamroller, strix-halo, unknown — would fail if one were
  accepted), Bulldozer -> excavator adapter delegation succeeds, and
  `caller: 'excavator'` cannot delegate.
- Docs EN+KO (README, usage, status, architecture) and contract §2.9 with the
  OQ-3/OQ-6 rows updated: no natively selectable primary remains, entry is
  `ntg-vnext`, OQ-3 resolved (owner decision), OQ-6 superseded by the
  demotion. `docs/versioning.md` matrix 1.1.0 row extended (version unchanged).

## Deterministic verification

Environment: `TMPDIR=<HOME>/.cache/ntg-instinct-tmp`, `SKIP_LIVE_TESTS=1`,
`set -o pipefail`, run fail-fast.

| Command | Result |
| --- | --- |
| `python3 -m unittest discover -s tests` | Ran 11 tests — OK (4 excavator-shell-guard + 7 zen-shell-guard; review-gate/gate-panel tests removed with their subjects) |
| `node tests/test_runner_spike.mjs` | 48 passed, 0 failed |
| `node --test tests/test_spine.mjs` | 101 passed, 0 failed (103 before: -3 rejected-role cases with excavator removed from the reject list, +1 allowed-delegation case) |
| `node --test tests/test_ntg_vnext.mjs` | 12 passed, 0 failed |
| `node tests/test_ledger.mjs` | 39 passed, 0 failed |
| `node --test tests/test_telemetry.mjs` | 7 passed, 0 failed |
| `node --test tests/test_dag_view.mjs` | 9 passed, 0 failed, 1 skipped (pre-existing) |
| `node --test tests/test_studio_runner.mjs` | 10 passed, 0 failed |
| `agy plugin validate .` | 10 agents processed, 2 hooks processed — OK |
| `npm pack --dry-run` | `native-gravity-1.1.0.tgz`, 29 files (gate_panel.py and the review-gate hook gone) |
| `git diff --check` | clean |

Totals: 227 deterministic Node cases (226 pass, 0 fail, 1 pre-existing skip)
+ 11 Python tests = 238 cases, 0 failures.

## Live verification (Bulldozer -> Excavator -> Zen GO)

Plugin install/restore (explicit steps only; `<HOME>/.gemini/config/plugins/native-gravity`):

- Baseline before: installed snapshot identical to `main` @ da11485
  (`diff` of `agents/`, `hooks/`, `rules/`, `hooks.json` — all identical).
- Branch install: `agy plugin uninstall native-gravity` ->
  `agy plugin install .` from the worktree (10 agents, 2 hooks;
  `importedAt 2026-10-12T08:19:22Z`).
- Restore after: uninstall -> `agy plugin install <HOME>/work/native-gravity`
  (main; 9 agents, 3 hooks; `importedAt 2026-10-12T08:33:35Z`), `diff`-verified
  identical to main — `NTG136_MAIN_RESTORED`.

Fixture (`<HOME>/.cache/ntg-exca-live`): `check.js` requires `retries>=3` in
`app.conf`; the fixture was broken with `retries=0` (`node check.js` ->
`FAIL: retry budget too low: 0`). One-milestone plan `fix1` objective tells
Bulldozer to delegate this bounded diagnose+repair to the Excavator worker.

```bash
node scripts/ntg-vnext.mjs init --ledger <HOME>/.cache/ntg-exca-live/ledger.json --plan <HOME>/.cache/ntg-exca-live/plan.json
node scripts/ntg-vnext.mjs run --ledger <HOME>/.cache/ntg-exca-live/ledger.json
```

- Exit 0 (~8.5 min wall clock). `fix1` -> Bulldozer `DONE` -> Zen `GO`
  (matching `result_ref ref-sha256-a92f5efc...`) -> Steamroller promotion,
  `completed_milestones: ["fix1"]`, `global_completion.completed: true`.
  `app.conf` repaired to `retries=3`; `node check.js` prints `ok`.
- Session ids (new sessions created by the run; store
  `<HOME>/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl`):
  - `b8fa67b3-0d3c-4d0b-b5b4-71a36afa6d90` — Bulldozer (runner invocation)
  - `bbdfaeea-9a04-452d-b47e-5a972339f9a9` — Jaguar (discovery)
  - `c83eca51-bb16-4206-8ee4-7b7f454de157` — Excavator (the diagnose+repair)
  - `e420bd33-c2ab-429d-8371-d6332cd7fec7` — Zen (independent verification)

Transcript observations:

- `invoke_subagent` with `TypeName: "excavator"` appears twice in the
  Bulldozer transcript (steps 13 and 35) carrying delegation packets in the
  orchestration contract's field shape (ROLE_REASON/GOAL/SCOPE/NON_GOALS/
  ACCEPTANCE/EVIDENCE/EDIT_POLICY/EXPECTED_OUTPUT -> worker result contract).
- The step-13 dispatch failed: `subagent "excavator" not found or not allowed
  to be invoked`. Bulldozer used Jaguar discovery and then `define_subagent`
  (step 33) with the shipped `agents/excavator.md` body verbatim
  (`enable_subagent_tools: false`, `enable_write_tools: true`); the step-35
  `invoke_subagent TypeName=excavator` succeeded and created `c83eca51`.
- Excavator session `c83eca51`: 0 `invoke_subagent` calls and zero mentions
  of "zen" — Excavator did not invoke Zen. All 4 of its `run_command` calls
  carry the `NTG_EXCAVATOR=1 ` marker. Its worker result:
  ROOT_CAUSE CONFIRMED (`app.conf` had `retries=0` vs `check.js` enforcing
  `retries>=3`), CHANGES (one-line fix), VERIFICATION_EVIDENCE (`node check.js`
  exit 0 `ok` + sha256 `04065efd...`), STATUS READY.
- Zen session `e420bd33` returned the bare JSON verdict packet with
  `milestone_id: fix1`, `plan_version: v1`, the unchanged `result_ref`,
  `verdict: GO` and OBSERVED evidence matching each acceptance criterion;
  the promotion happened only after that observed GO.

## Unresolved issues (Excavator demotion)

1. **First `invoke_subagent TypeName=excavator` dispatch failed** in the fresh
   runner-spawned Bulldozer session: `subagent "excavator" not found or not
   allowed to be invoked`, even though the branch plugin was installed and
   Jaguar dispatched normally. Recovery was observed via `define_subagent`
   carrying the shipped role body, after which the same dispatch worked.
   Whether this is an AGY registry/visibility quirk (e.g. the runtime still
   classifying the pre-demotion `mainAgent: true` excavator) is UNKNOWN and
   should be re-probed on the next AGY upgrade. The successful excavator run
   used the exact shipped `agents/excavator.md` contract text, so the worker
   semantics under test are the shipped ones.
2. `tests/test_dag_view.mjs` retains its pre-existing 1 skipped test
   (unrelated to this change).
3. Excavator's model assignment stays at native `model: pro` (unchanged from
   the primary); OQ-3 is closed on authority/placement, and comparative
   model evidence remains future work.

## Excavator dispatch defect: root cause and fix (lead)

The worker's live run above needed `define_subagent` because the shipped
`agents/excavator.md` could not be invoked. The lead reproduced and isolated it
(AGY 1.3.3, branch plugin installed, main restored after every probe):

- Direct `invoke_subagent TypeName=excavator` from Bulldozer, `define_subagent`
  forbidden: `subagent "excavator" not found or not allowed to be invoked`
  (session `eb29b13e-d941-4f14-81dd-cebf64e032ce`). Bobcat control dispatched.
- Same failure with `model: flash` and under a new name (`digger`): not model
  or name. Excavator frontmatter + Bobcat body failed; Bobcat frontmatter +
  Excavator body dispatched: the frontmatter is the cause.
- Excavator frontmatter with a plain description dispatched in every variant
  (tool order, `invoke_subagent` added, empty mcpServers/skills/plugins).
- A strict YAML parse of all agent frontmatter fails only for excavator.md: its
  description was an unquoted plain scalar containing `: ` ("...work: diagnose"),
  which is invalid YAML. AGY drops the agent silently, so the call reports
  "not found". The pre-demotion description had no colon.

Fix: description reworded without `: `. Regression test
`tests/test_agent_frontmatter.mjs` checks every agent's top-level plain
scalars and name/file agreement; it fails on the old description (1 of 21)
and passes on the fix (21 of 21).

Verification of the fix, shipped file, no workaround: Bulldozer session
`a29d1b5a-6b53-47a5-a69c-1868d8c69be0` made one `invoke_subagent TypeName=excavator`
and no `define_subagent`; zero "not found" errors. Excavator child
`5b19f41f-9076-4aa0-a849-d3fcab252157` used view/write/run_command/send_message
only, no `invoke_subagent` (never Zen); its shell call carried `NTG_EXCAVATOR=1 `.
The fixture ended as `alpha`. Installed plugin restored to main and diff-verified.

This supersedes unresolved issue 1 above: it was a shipped frontmatter defect,
not an AGY registry quirk.
