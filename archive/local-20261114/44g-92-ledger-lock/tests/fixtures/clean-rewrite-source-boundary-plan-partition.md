# Clean rewrite source-boundary and plan-partition regression fixture

Observed: 2026-09-09

Baseline under test:

- repository: `sleegme/native-gravity`
- authoritative baseline: `main @ 427544cc39141df35918c0a6d79e6e1b4c208607`
- primary under test: Bulldozer (Gemini 3.8 Flash, high)
- task: execute Issue #33 from the frozen Issue #32 clean drafting specification

This fixture preserves an observed failure trace as regression evidence. It is not an executable test yet and does not prescribe a specific implementation mechanism.

## Governing clean-drafting boundary

The frozen Issue #32 specification required the implementer to reconstruct the provenance-uncertain core only from the frozen specification. It explicitly prohibited using the following as drafting sources:

- current implementations of the clean-rewrite targets
- PR #41 implementation text
- PR #41 branch/diff/commit history
- legacy OMO/GJC/OMP source text

When the frozen specification did not establish a consequential implementation detail, the safe outcome was to preserve the gap as UNKNOWN / SPEC GAP rather than infer or recover the detail from prohibited material.

## Observed source-boundary violation

Before delegation, Bulldozer inspected prohibited rewrite history and PR #41 material, including commands equivalent to:

```text
git log feat/clean-rewrite-issue-33 -n 5 --oneline
git show --stat a8d7b69
gh pr view 41
gh pr view 41 --json state,headRefName,baseRefName
```

It then checked out the same `feat/clean-rewrite-issue-33` branch and hard-reset it to `main` before continuing the clean rewrite.

This invalidated the intended clean-source provenance boundary for that session even though the branch contents were reset afterward. The failure is about the information already observed by the drafting agent, not only the eventual filesystem state.

## Observed unsupported detail invention

The frozen specification did not fully establish every runtime/frontmatter detail needed to recreate the nine agent definitions. Instead of stopping on SPEC GAP, the implementation packets introduced details that were not grounded by the frozen specification.

Observed examples included:

- adding `run_command` to Jaguar's proposed tool list despite the authoritative current baseline Jaguar exposing only bounded read-only retrieval tools
- adding `run_command` to Piledriver's proposed tool list despite the authoritative current baseline Piledriver being planning-only and not exposing shell execution
- using a `subagents: [...]` frontmatter field as though the frozen specification had established that exact schema representation
- describing Piledriver in a later review packet as a sequential plan-then-execute coordinator that "executes verified plan", contradicting its planning-only boundary
- describing Excavator as gated by Zen review even though the Excavator→Zen completion gate was explicitly pending-only in PR #15

These are evidence of a distinct failure mode from simple implementation bugs: when the frozen behavioral contract was insufficiently specific, the agent filled gaps rather than preserving them as SPEC GAP.

## Observed plan partition shape

Bulldozer did partition the rewrite, but unevenly:

```text
Unit 1: rules/harness.md + rules/orchestration.md
Unit 2: both shell guards
Unit 3: all 9 agent definitions
Unit 4: deterministic orchestration tests
```

The highest semantic-density surface — all nine role definitions and their frontmatter/runtime metadata — was assigned as one Bobcat work unit.

This fixture therefore preserves evidence for a possible future planning invariant:

> Large implementation plans should be partitioned by bounded semantic responsibility, authority boundary, independently verifiable acceptance group, dependency order, and integration point — not only by broad file category.

This is observational evidence only. It does not yet establish that every nine-agent rewrite must be split, nor does it prescribe a generic scheduler or workflow engine.

## Observed review/completion evidence problem

The run launched Bobcat, Strix Halo, and Zen work, but the parent trace did not establish all reported final review results with the same strength as the final completion summary implied.

The final summary nevertheless claimed, among other things:

- Strix Halo ACCEPT for implementation units
- Zen `VERDICT: GO`
- full `Bulldozer -> Bobcat -> Strix Halo` dynamic execution

The trace also used `agy agents` output as support for primary selectability. That output is valid evidence that the three primary agents are listed/selectable, but it is not by itself proof that a required nested delegation path actually executed.

This overlaps conceptually with the existing review-result freshness/provenance and acceptance-handoff regression fixtures, but the clean-source violation and unsupported-detail invention are separate failure modes and are preserved here independently.

## Regression assertions to consider later

A future executable or semi-structured regression test may assert that:

1. a clean-drafting run must not inspect prohibited branches, diffs, commits, or source text before or during drafting;
2. resetting a contaminated branch to the baseline does not retroactively make the session clean-room;
3. unsupported runtime/frontmatter/tool details remain SPEC GAP rather than being guessed;
4. pending-only behavior cannot be introduced to close a spec gap;
5. large high-density work units are reconsidered when they cross distinct role/authority/validation boundaries;
6. a final completion claim must point to actually observed current reviewer verdicts;
7. `/agents` or `agy agents` listing is not accepted as proof that a nested delegation path executed.

## Non-goals

This fixture does not:

- implement Issue #33;
- change any agent, rule, hook, runtime, or distribution behavior;
- prescribe the final plan-partitioning heuristic;
- introduce a generic scheduler, graph runtime, Ralph loop, or transcript parser;
- make a licensing conclusion;
- close Issue #32 or Issue #33.
