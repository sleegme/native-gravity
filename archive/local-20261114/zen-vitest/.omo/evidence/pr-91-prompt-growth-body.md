## Summary

- Cap recorded invocation error previews at 8 KiB with head and tail context and a SHA-256 digest. Preserve the full error transcript outside the ledger in `<ledgerPath>.transcripts/<digest>.txt`, referenced by `transcript_ref`.
- Project only the latest 5 failure entries per milestone or dependency into `getRelevantEvidence()`. Preserve the complete ledger audit history.
- Confirm the existing runner returns typed `PROMPT_TOO_LARGE` before spawning for prompts over its 128 KiB limit; add UTF-8 regression coverage.

## Design remainder

Piledriver's `requestPlan()` still sends the full ledger state. There is no existing planning-state projection to reuse; the existing projections are milestone-specific. Defining what planning may omit needs a PO/design call, so this change deliberately leaves that contract intact. Full-state planning prompts can therefore still grow with ledger history and hit the typed overflow guard.

The 8 KiB preview cap and 5-entry window bound failure history in milestone redelegation prompts, not arbitrary plan, candidate, blocker, or model-generated evidence sizes. Existing persisted failures are not rewritten. Keep the transcript sidecar directory with the ledger when archiving diagnostics.

## Verification

All four requested suites passed on the isolated branch based on `origin/main`: ledger 38/38, spine 91/91, runner spike 44/44, and ntg-run 12/12. Runner coverage included live Piledriver and Bulldozer invocations. JavaScript syntax checks and `git diff --check` passed. LSP diagnostics were unavailable because `typescript-language-server` is not installed.

Commit: `50eab5b` (`fix(spine): bound invocation failure prompt growth (Refs #91)`).

Refs #91.
