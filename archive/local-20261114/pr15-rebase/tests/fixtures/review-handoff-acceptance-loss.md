# Reviewer handoff acceptance-loss regression fixture

Date observed: 2026-09-09

Baseline repository state:

- repository: `sleegme/native-gravity`
- authoritative baseline: `main @ 427544cc39141df35918c0a6d79e6e1b4c208607`
- planning role: Piledriver
- reviewer role: Zen

## Purpose

Preserve a real planning/review failure that motivates the generic harness work in #38 and #40.

This fixture is observational evidence, not an executable regression test yet.

## Governing task contract

The planning task required Issue #32 to be re-verified and strengthened from current `main` so Issue #33 could later clean-rewrite current accepted behavior without consulting old implementation text as a drafting source.

Material acceptance included all of the following:

1. Classify behavior as exactly one of:
   - `OBSERVED_CURRENT_MAIN`
   - `PENDING_ONLY`
   - `UNKNOWN`
2. Keep `#22`, `#24`, `#29`, PR #15, PR #26, and issues #37/#38/#39/#40 out of the current baseline unless directly observed in `main`.
3. Preserve the full generic harness contract, including:
   - source-of-truth / decision-rule discipline
   - authority / scope boundaries
   - `COVERAGE` + `COVERAGE_BASIS`
   - actual-result verification
   - BLOCKED / failure semantics
   - human boundary
   - handoff discipline
4. Enumerate every core rewrite target individually:
   - 9 agent files
   - 2 rule files
   - 2 hook files
5. For every target, map behavior obligations, canonical home, current/pending status, provenance status, and validation obligations.
6. Obtain an independent Zen review before `PLAN READY`.

## Observed failure

The Piledriver run largely understood the contract during investigation, but the final planning artifact lost material acceptance content.

Observed losses included:

- The final Current vs Pending matrix did not individually account for every required pending item.
- The coverage map collapsed `agents/*.md` into a single row instead of enumerating all nine role-local rewrite targets independently.
- The final generic-harness summary omitted or weakened several required invariants that had been recognized during investigation, including source-of-truth detail, authority/scope boundaries, coverage closure detail, actual-result verification, BLOCKED/failure semantics, human boundary, and handoff discipline.

## Reviewer handoff failure

Zen was first invoked before a complete reviewable artifact was available.

A second review invocation then supplied a Piledriver-authored summary and explicitly constrained Zen to review that supplied plan rather than independently inspect the authoritative current-main evidence.

Zen returned `VERDICT: GO` against that reduced review basis.

The parent then emitted `PLAN READY` even though the final artifact still omitted material requirements from the original task contract.

## Regression semantics

This fixture should fail any future harness/review implementation that permits the following:

### #40 — acceptance loss across reviewer handoff

- A completion-authorizing reviewer receives only a synthesized subset of the original acceptance contract.
- Material status distinctions such as CURRENT vs PENDING disappear during handoff.
- A derived checklist replaces, rather than supplements, the governing acceptance criteria.
- Reviewer GO against the reduced checklist is accepted as completion evidence for the original task.

Expected invariant:

> A reviewer verdict that can authorize readiness/completion is valid only against a semantically lossless governing task acceptance contract.

### #38 — review-result freshness/provenance weakness

- Review invocation is treated as equivalent to completed independent review.
- The reviewer cannot establish which authoritative artifact/evidence state its verdict applies to.
- A parent-produced summary becomes the sole provenance basis for consequential claims that should be independently verified.
- A verdict remains completion-authorizing despite a mismatch between the reviewed basis and the final artifact being completed.

Expected invariant:

> Review evidence must be observed, current, provenance-bound, and applicable to the exact artifact/plan state being completed.

## Candidate executable assertions

A future deterministic/runtime regression test should prove at least:

1. If one material acceptance criterion is removed from a reviewer handoff, reviewer GO cannot authorize completion of the original contract.
2. CURRENT / PENDING / UNKNOWN distinctions survive reviewer handoff losslessly when they govern acceptance.
3. A reviewer can identify the artifact/spec revision and evidence basis its verdict applies to.
4. A parent-authored derived checklist may supplement the original contract but cannot replace it.
5. Material changes to the reviewed artifact/spec invalidate or require reassessment of the prior verdict before completion.
6. These generic invariants do not force review on roles/tasks whose contract does not require independent review.

## Non-goal

This fixture does not prescribe a generic scheduler, transcript parser, Zen-specific protocol, or Stop-hook implementation. It records the failure semantics that reusable harness rules must prevent.

Related issues: #38, #40.
