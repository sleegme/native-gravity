# 44G step-7 e2e validation — 2026-10-04

Harness: `.omo/evidence/2026-10-04-44g-e2e-live.mjs` (real agy calls via production `invoke()`)
Transcript: `.omo/evidence/2026-10-04-44g-e2e-transcript.json` (16 records, 15 agy calls)
Main HEAD at run time: `33c82e3` (merged PR #81 role-contract fix)

## Per-case verdicts

| Case | Verdict | Result |
|---|---|---|
| case1 multi-milestone (bulldozer) | ERROR | `TOOL_PERMISSION_DENIED` on bulldozer `read_file` — the runner invokes agy without `--dangerously-skip-permissions`, and the bulldozer role's read tool hit a permission gate the task brief does not allow bypassing. |
| case2 zen-no-go (bulldozer → zen) | ERROR | Same `TOOL_PERMISSION_DENIED` on bulldozer; Zen never invoked. |
| case3 fresh-context-resume | SKIP | Depends on case1 milestone-one completing; bulldozer failed first. |
| case4 plan-revision (bulldozer) | ERROR | Same `TOOL_PERMISSION_DENIED`. |
| advisory-requestPlan (piledriver → zen) | PASS | piledriver ran, Zen returned a well-formed replan advising v2 plan adoption (`steamroller` adopt v2; observed `invalidating_reality`, `affected_milestones: ['two']`, `recommended_next_action`). |

## Acceptance-criteria delta (issue #44 P0 items)

| P0 item | Before | After | Evidence |
|---|---|---|---|
| vNext role bodies invoked with real agy (no `--agent`) | UNVERIFIED | PARTIAL — piledriver runs clean; bulldozer blocked by tool-permission gate | transcript records 11–13 |
| Strict response-packet unwrap (fail-closed) | VERIFIED (PR #81 tests) | still holds — bulldozer error paths return structured `{"ok":false,...}` not prose | transcript records 3, 7, 10 |
| Multi-milestone spine progression end-to-end | UNVERIFIED | NOT VERIFIED — case1 error before milestone completion | transcript record 4 |
| Zen NO-GO blocks a bad milestone | UNVERIFIED | NOT VERIFIED — bulldozer blocked before Zen was reached | transcript records 8–10 |
| Fresh-context resume across process restart | UNVERIFIED | NOT VERIFIED — skipped by dependency | transcript record 4 |
| Plan revision surfaces to advisory | UNVERIFIED | PARTIAL — advisory path works, plan-revision case blocked | transcript records 11–14 |

## Blocker

vNext e2e cannot proceed until the bulldozer role can read project files without the agy permission gate blocking the run. Options (PO decision):

- Allow `read` tool in the agy invocation for read-only vNext roles, or
- Run the e2e under a sandbox/bwrap profile that grants read access without bypassing permission checks, or
- Mark bulldozer read as out-of-scope for this e2e and re-scope step 7 to advisory-only cases.

The `TOOL_PERMISSION_DENIED` is not a code defect in the runner; it's a permissioning boundary the PO explicitly held. Findings file written without AGENTS.md or permission changes.
