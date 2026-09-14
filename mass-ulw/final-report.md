# NTG vNext mass-ulw — Final Report

Run: ulw-loop session 01a0949f-7dc8-7494-b4b1-f137cebd5e3a
DAGs: dag_22e064a3 (Phase 1, 6/6 nodes completed), dag_7016d97a (Phase 2, 2/2 nodes completed)

## Phase 1 node verdicts

| Lane | Verdict | Evidence |
|---|---|---|
| 44B runner role-body wiring | GO (verifier + lead spot-check) | PR #54 OPEN @ 121c793b635ebb3783a2a7741f8701792a7034f6; one commit atop origin/main; only scripts/runner.mjs + tests/test_runner_spike.mjs changed; runner tests 33/33, ledger 37/37; ROLE_BODY_ROLES allowlist, deterministic "## Role Body" + handoff composition, ROLE_BODY_MISSING/INVALID fail-closed, cwd-independent dir resolution, raw-history rejection preserved |
| 44E minimal-spine re-author | GO (verifier + lead spot-check; provenance re-run GO) | PR #51 OPEN @ 3d7681ce61a3d23e076a97d717c0c0c5e4337e6b (re-run commit; prior d7e35e4 superseded); rebuilt from origin/main, contaminated e29ec49/2eb9860 unreachable; exactly 7 authored files; spine 27 + guard 7 + runner 24 + ledger 37 green; live hook: marked read-only allowed / marked mutation denied; agy plugin validate 0 (9 agents, 2 hooks); durable cleanroom + receipts incl. literal --force-with-lease capture |
| 44F specialist re-author | GO (verifier + lead spot-check; provenance re-run GO) | PR #50 OPEN @ 9795decaf7c12c7b683c8281fe04bc21aad8111c (re-run commit; prior e3171b9 superseded); rebuilt from origin/main, contaminated 9b97f0d/4658402 unreachable; exactly agents/jaguar.md, puma.md, strix-halo.md; role semantics quoted-verified; agy validate clean; durable cleanroom + receipts incl. literal --force-with-lease capture |

No lane required retry/amend — all verifiers returned GO on first pass.

## Phase 2 verdict

44D integration: GO (verifier + lead first-hand re-proof in rebuilt /tmp/ntg-44d-verify after /tmp wipe).
- Combined tree: 44B head 121c793 + PR #53 six-file overlay; role bodies sha256-identical to PR #53 blobs.
- composeBoundedPrompt injects each role's full trimmed body (steamroller 5054ch, piledriver 2937ch, bulldozer 3796ch — gate-review measured) plus all handoff sections; identical result from a neutral mktemp cwd with no AGENTS.md.
- Missing body -> ROLE_BODY_MISSING; non-allowlisted role -> UNRESOLVED_MODEL_SLUG.
- test_runner_spike.mjs 33/33 in the combined tree.
- OQ-6 recorded NOT_APPLICABLE_TO_RUNNER_ROLES (runner reads explicit files; frontmatter/inheritCustomizations not on the runner path).
- PR #53 unchanged — no cleanup push was needed.

## PR + HEAD state (verified at report time)

| PR | State | Draft | HEAD |
|---|---|---|---|
| #54 (44B, new) | OPEN | no | 121c793b635ebb3783a2a7741f8701792a7034f6 |
| #51 (44E) | OPEN | no | 3d7681ce61a3d23e076a97d717c0c0c5e4337e6b |
| #50 (44F) | OPEN | no | 9795decaf7c12c7b683c8281fe04bc21aad8111c |
| #53 (44D) | OPEN | yes | 049719574c6189d9dc820b5481797009d3a5582e |

All headRefOids equal their local branch HEADs. Latest merged PR is #48 (pre-run); nothing from this run was merged.

## Tests / live evidence

- 44b clone: test_runner_spike 33/33, test_ledger 37/37 (re-run by lead).
- 44e clone: test_spine 27, test_zen_shell_guard 7, runner 24, ledger 37 (re-run by lead); live guard allow/deny transcripts in verifier artifact.
- 44f clone: agy plugin validate exit 0 (re-run by lead).
- Integration: per-role injection + neutral-cwd + fail-closed re-run by lead in /tmp/ntg-44d-verify.
- Verifier artifacts: .omo/senpi-task/dag/results/dag_22e064a3-*/verify-{44b,44e,44f}.txt and dag_7016d97a-*/verify-44d.txt.
- Retained-evidence consolidation (post-/tmp-wipe): retained-evidence.md in this attempt dir — reflog rebuild sequences, sha256 tables, cleanroom tree record, integration re-proofs.
- Durable provenance re-run (Phase 1b, dag_5ed4922f): cleanroom-44e/ and cleanroom-44f/ under this attempt dir contain authored files + receipts/ (authored-sha256.txt, git-receipts.txt, push-receipt.txt with literal --force-with-lease command+output, test-receipts.txt, live-hook.txt) + REPORT.md; verifier artifacts verify-44e-rerun.txt / verify-44f-rerun.txt both GO.

## Remaining blockers

- OQ-6 stays open for native-subagent roles (Zen/Jaguar/etc.) — resolved only for runner roles.
- Activation blockers unchanged: tool/delegation enforcement, ledger storage interfaces, exact model slugs for native roles, Excavator placement, Sonnet path — all deferred to 44G per contract.

## Confirmation

No PR merged. No vNext activation. PR #53 remains Draft. Parent dir treated as independent clones throughout. 44G gate held.
