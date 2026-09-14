# 44F durable cleanroom provenance re-run

Task: st_01a09af6

## Delivered result

- Cleanroom: `/home/sleeg/work/ntg-vnext/.omo/evidence/ulw/01a0949f-7dc8-7494-b4b1-f137cebd5e3a/G001-root-work-ntg-vnext-parent-dir-is-no/a1/cleanroom-44f/`
- Clone: `/home/sleeg/work/ntg-vnext/native-gravity-44f`
- PR: https://github.com/sleegme/native-gravity/pull/50 (OPEN)
- Branch: `feat/issue-44f-specialists`
- Previous head: `e3171b94a14793b5a55f056119f0240f364e81d2`
- New HEAD and confirmed PR headRefOid: `9795decaf7c12c7b683c8281fe04bc21aad8111c`
- Unchanged parent: `95b64ad21189579a6e560fae1f7a0d62d30fe9b3`
- Commit: `feat(44F): reauthor specialists with durable provenance (#44F-a)`

All three files were freshly written under this durable cleanroom before copying
into the clone. Their pre-copy SHA-256 manifest matches the delivered files.
The amended commit contains only the three authorized specialist paths.
No PR was merged, no push targeted main, and no vNext activation was performed.
No parallel clone was modified.

## Sources and provenance boundary

Drafting sources:

1. `docs/specs/pre-vnext-v0.4-behavior-baseline.md`: frozen #32 generic contract,
   evidence, mutation, coverage, blocking, handoff, and specialist obligations.
   SHA-256: `a5b1f4cb81127563e29fb0aad22fe0a6c3e35f8bf814264c4c503b9ac9cf8614`.
2. `docs/specs/vnext-architecture-contract.md`: #44A role boundaries, escalation,
   candidate-matching independent Zen gate, ledger ownership, and non-activation.
   SHA-256: `3b713b06159e658410a6fd169ced724896aa87299f10d1b1587574a6032d9c6c`.
3. The three verified-clean specialist versions at `e3171b9`, explicitly permitted
   by this task as semantics references. This is a provenance re-run, not a claim
   that those three prior versions were unseen.
4. Official AGY custom-agent documentation:
   https://antigravity.google/docs/subagents/ . The retrieved HTML and extracted
   schema rows are preserved in receipts. All eleven used frontmatter fields
   were located in the official table and accepted by the installed validator.

Frozen specs and permitted specialist references are archived under
`receipts/references/`. Repository `AGENTS.md` was read for workspace instructions
and released-topology boundaries, not used as drafting text. Package metadata,
CI/test/script listings and targeted searches, git status/log metadata, and the
current specialist diff were inspected for scope and validation context.
Legacy sibling agent/rule/hook implementations, abandoned rewrite branches,
PR #41 implementation, and external OMO/GJC/OMP source text were not drafting
sources. The task's express permission to consult `e3171b9` governs this re-run.

## Approach and assumptions

Two approaches were considered: append a second provenance commit, or amend the
existing single specialist commit after fresh cleanroom authoring. Amendment won
because it preserves the established single-commit PR shape and unchanged parent
without a reset or changes to unrelated files. The starting tree was observed
clean. No reset was necessary or run; this is explicitly recorded rather than
fabricating a reset receipt. `--force-with-lease` was used exactly as requested.

Assumptions resolved from task context: preserve semantics rather than exact prose;
keep all capability/model/configuration fields unchanged; leave released topology,
Zen, runtime integration, and activation surfaces outside this three-file scope.
Those surfaces require no changes for a semantics-preserving provenance re-run.
The amending operation preserves the prior author date; these receipts document
this new authoring and push rather than treating that date as re-run evidence.

## Per-file design and static semantic review

### agents/jaguar.md

- Retains native Flash, subagent-only selection, sandbox policy, empty extensions,
  and only `view_file` / `grep_search` tools.
- Organizes the prompt around bounded assignment, factual discovery, and return
  to Bulldozer. No implementation, architecture decisions, approvals, delegation,
  state writes, or indirect acquisition of denied capabilities.
- Preserves all eleven assignment fields; OBSERVED/INFERRED/UNKNOWN discipline;
  independent verification before consequential inference; actual-result checks;
  complete COVERAGE with independent COVERAGE_BASIS; bounded absence claims;
  compact evidence packets; inherited identifiers; four-condition BLOCKED.
- Discovery remains local evidence. Worker READY and Strix ACCEPT cannot complete
  milestones; Steamroller retains ledger/promotion/global authority with current
  candidate-matching Zen GO in isolated vNext validation.

### agents/puma.md

- Retains native Flash and the two read tools plus `write_to_file` and
  `replace_file_content`; no shell, delegation, advisor, or extension capability.
- Organizes the prompt around work-kind eligibility, reversible mechanical edits,
  actual-result inspection, and return to Bulldozer. Small substantive behavior,
  API, state, lifecycle, and test-logic changes do not become mechanical by size.
- Preserves all assignment fields, evidence/source/coverage requirements, exact
  write scope, unrelated-content preservation, practical undo, and prohibition
  of persistent/destructive effects and indirect bypasses.
- Out-of-role work returns to Bulldozer without performing it. No Bobcat role
  takeover, Strix ceremony, plan changes, ledger writes, or completion authority.
  READY remains integration readiness only; four-condition BLOCKED is retained.

### agents/strix-halo.md

- Retains native Pro, subagent-only selection, the two read-only tools, sandbox
  policy, and empty extensions; no shell or delegation capability.
- Separates intake from review. Bobcat is the only authorized caller; a wrong or
  unknown caller receives an intake failure, never an implementation verdict.
- Preserves bounded contract/inherited constraints and decision invariants,
  current artifact inspection, evidence classifications, coverage closure,
  unavailable-runtime UNKNOWN, no repairs, and no indirect capability bypasses.
- ACCEPT requires every applicable local criterion; REVISE identifies evidence,
  correction, and verification through Bobcat; NEEDS_DEEP identifies the decision
  beyond Bobcat's authority without adopting an architecture.
- Retains the exact escalation route:
  `Strix Halo -> Bobcat -> Bulldozer -> Steamroller -> optional Piledriver`.
  No hop skipping or direct Piledriver invocation by lower roles.
- ACCEPT is not milestone completion or Zen GO. Bulldozer DONE remains a candidate;
  Steamroller observes independent Zen GO matching milestone, current plan, and
  candidate before promotion. Only Steamroller owns global completion and ledger
  updates. Four-condition BLOCKED and the 44G non-activation boundary remain.

These are static author review findings, not a new live-model behavioral verdict.

## Validation evidence

`/home/sleeg/.local/bin/agy plugin validate .` exited 0:

```text
[ok] .
- skills      : skipped (not found)
agents        : 9 processed
- commands    : skipped (not found)
- mcpServers  : skipped (not found)
hooks         : 2 processed
```

The raw output, including terminal escape bytes, is in `test-receipts.txt`.
The validator's absent optional components are not skipped test failures.

- `git diff --check` and staged diff checks passed.
- Pre-copy hashes matched all three clone files, including after commit.
- Every capability/model/config frontmatter line except the intentionally
  reauthored description matched the permitted prior version.
- Markdown LSP diagnostics were attempted on all three changed files but are
  unavailable: `No LSP server configured for extension: .md`.
- Package metadata has no build script. AGY plugin validation is the applicable
  real artifact/schema entry point. No prose snapshot tests were added.
- Live model invocation, delegation enforcement, and full-stack behavior were not
  re-tested; those are not established by schema validation and remain gated by
  44G. Existing unrelated runner/ledger/hook suites were not rerun.

The push succeeded with the full explicit command:
`git push --force-with-lease origin feat/issue-44f-specialists`.
The first immediate PR read still returned the old head; the following equality
check succeeded, and the subsequent full PR response reported the new head and
OPEN state. Both observations are preserved unmodified in the push receipt.

## Receipt inventory

Required:

- `receipts/authored-sha256.txt`: three authored file hashes, captured before copy.
- `receipts/git-receipts.txt`: initial state, explicit no-reset decision, exact
  copy/staging/amend commands and outputs, diff, unchanged parent, final clean
  status, and copied-file hash checks.
- `receipts/push-receipt.txt`: exact force-with-lease command and complete output,
  gh head reads, equality check, and OPEN PR state.
- `receipts/test-receipts.txt`: validator output/exit, integrity and frontmatter
  checks, source hashes, and verification limitations.
- `REPORT.md`: this report.

Additional:

- `receipts/agy-subagents.html`: official documentation snapshot.
- `receipts/schema-source.txt`: official field/type/default/meaning rows.
- `receipts/references/agents/*.md`: permitted prior specialist semantics sources.
- `receipts/references/docs/specs/*.md`: frozen specification snapshots.
