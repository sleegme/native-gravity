# Mass-ULW durable evidence — pre-44G stack (vnext/pre-44g)

Source: ~/work/ntg-vnext/.omo (ulw-loop session 01a0949f-7dc8-7494-b4b1-f137cebd5e3a)
Selected per instruction: final-report, gate-review, verifier results, clean-room
receipts, hashes, force-with-lease evidence. Whole .omo NOT committed.

## Contents
- mass-ulw/final-report.md — run verdicts (44B/44D/44E/44F all GO), PR/HEAD table, blockers
- mass-ulw/gate-review.md — gate review (APPROVE)
- mass-ulw/retained-evidence.md — consolidated sha256 tables, reflog rebuilds, re-proofs
- mass-ulw/cleanroom-44e/ — REPORT.md + receipts/ (authored-sha256, git-receipts,
  push-receipt w/ literal --force-with-lease, test-receipts, live-hook allow/deny,
  plugin-validate, pr-head, runtime schema capture)
- mass-ulw/cleanroom-44f/ — REPORT.md + receipts/ (authored-sha256, git-receipts,
  push-receipt w/ literal --force-with-lease, test-receipts, reference snapshots)
- mass-ulw/verifier/<dag-id>/ — verify-*.txt + verify-*.stats.json for all lanes
  (44b/44e/44f phase-1, 44d phase-2, 44e/44f provenance re-runs)

## Excluded (not in the named set)
- .omo/ulw-loop/{brief.md,goals.json,ledger.jsonl} — orchestration state
- .omo/senpi-task/dag/{runs,events,skills,keys} + lane-*/integrate-* outputs — DAG internals
- a1/cli-transcript.txt — raw transcript
- cleanroom-44e/receipts/npm-cache/ — tool cache noise
- cleanroom authored trees (agents/, hooks/, scripts/, tests/ under cleanroom-*) —
  content already landed via the stacked commits; receipts carry their sha256.
