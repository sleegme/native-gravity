# Instinct (#20) + #136 — implementation results

Branch: `fix/136-bulldozer-relay` (base `main` @ da11485). Product version bumped to 1.1.0 (B bump: new specialist per `docs/versioning.md`). All published local home-directory paths are redacted to `<HOME>`.

## A. #136 fix

`agents/bulldozer.md` MACHINE-INVOCATION MODE now states that specialist/worker
reports (Jaguar findings, Puma/Bobcat results, Strix Halo verdicts) are relayed
only inside packet fields (`verification_evidence`, `delegations` findings),
never as text before or after the JSON object. `scripts/runner.mjs`
`parseResponsePacket` is unchanged (still fail-closed on prose), per the brief.

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
