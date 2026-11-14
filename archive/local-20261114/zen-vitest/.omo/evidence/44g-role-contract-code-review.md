# Code Review — 44G role-contract conflict fix

Reviewer: omo-native-code-reviewer (senpi-task st_01a101f8)
Date: 2026-10-03
Scope reviewed: working-tree diff of `fix/44g-role-contract-conflict` vs `main`
(docs/specs/vnext/agents/{steamroller,bulldozer,piledriver}.md, scripts/runner.mjs,
tests/test_runner_spike.mjs, tests/test_spine.mjs), the findings file
`.omo/evidence/2026-10-03-44g-role-contract-findings.md`, the live harness
`.omo/evidence/2026-10-03-44g-role-contract-live.mjs`, and prior probe
transcripts under /tmp/ntg-44g-*.

## Skill-perspective check

`remove-ai-slops` and `programming` skill files were NOT loadable in this
session: the only skill exposed to this reviewer is `bun-1-4`. The criteria
documented in the review instructions were applied directly instead:
deletion-only / tautological / implementation-mirroring tests, needless
production parsing or normalization, untyped escape hatches, validation
placed where the boundary does not require it.

Result: no violation found. The parser addition sits exactly at the
model-output trust boundary the goal names; the extraction rule fails closed
rather than searching for a parsable subset; the new tests assert real
external behavior (classification, provenance, gate strictness), not
implementation constants. Test-spine additions verify the state machine
rejects schema/authority mismatches on unwrapped candidates and still
requires an independent Zen GO — a directly relevant regression guard for
"keep the gate strict". Prompt-equality assertions in runner tests 3.1-3.3
continue the file's existing fixture style and pin a machine-consumed
artifact (the composed prompt), not prose quality.

## Verified facts

- `git log main..HEAD` is EMPTY. `git status` shows all six file changes
  UNSTAGED; nothing is committed, nothing is pushed, `gh pr list --head
  fix/44g-role-contract-conflict` returns `[]`.
- `invokeTransport` on main already passes no `--agent`; verified by diffing
  `git show main:scripts/runner.mjs` — the diff adds only the explanatory
  comment at scripts/runner.mjs:535. The step-3 mechanism actually used is
  repointing `loadRoleBody`'s default to `../docs/specs/vnext/agents`
  (scripts/runner.mjs:89), so the composed machine prompt carries the vNext
  contract body instead of the live `agents/` contract. `agents/` and
  `docs/specs/vnext/agents/` contain identical role filename sets, so no
  role resolution breaks. This is one coherent choice, documented in the
  findings file, and respects the hard hold (no live agents/*.md edits,
  no AGENTS.md/permission/allowlist changes, no activation).
- `parseResponsePacket` (scripts/runner.mjs:444-481): full-parse first;
  on failure, slices first-`{` to last-`}`, strips line-anchored code
  fences from the surrounding text, and rejects when leftover narration
  contains braces/brackets/quotes/backticks or JSON scalar literals.
  Multiple objects, unclosed candidates, top-level arrays/scalars, and
  malformed payloads all land on INVALID_RESPONSE_FORMAT; `result.response`
  and `result.raw` are preserved untouched for provenance. Traced edge
  cases (escaped braces inside strings, `{"a":NaN}`, `Before "{}" After`,
  `{}\nnull`, `Before { {} After`) all classify correctly.
- `parseResponseEnvelope` still returns early on `!result.ok`
  (TOOL_PERMISSION_DENIED/EMPTY_RESPONSE path intact; test 2.6h asserts
  the denied-envelope pass-through).
- Tests run by this reviewer: `node tests/test_runner_spike.mjs` -> 41/41
  PASS; `node --test tests/test_spine.mjs` -> 41/41 PASS.
- Prior A/B evidence corroborates the diagnosis: every complex-packet call
  in /tmp/ntg-44g-model-ab-JNmxf0/transcript.json (20 calls across
  gemini-3.8-flash-high, gemini-3.1-pro-high, claude-sonnet-5-5-high,
  claude-opus-5-5-high, claude-sonnet-5-5-medium) ended
  INVALID_RESPONSE_FORMAT under the old strict parser, and framing probes
  emitted `PLAN READY` traced to the live role files.

## Findings

### CRITICAL

1. Deliverable does not exist as specified. The goal requires a branch
   "with commits", a push, and `gh pr create` (body `Refs #44`) plus a
   reported PR URL. The branch has zero commits (all changes are unstaged
   working-tree edits), nothing is pushed, and no PR exists. A reviewer
   cannot approve work that upstream consumers cannot fetch, and the
   working tree could be lost or contaminated. (git status / git log /
   gh pr list outputs above.)

2. Step 6 of the required order — the bounded live before/after re-check —
   was never executed. No `/tmp/ntg-44g-role-contract-*` directory exists
   (the harness would have printed EVIDENCE_DIRECTORY and written
   transcript.json there), and `.omo/evidence/2026-10-03-44g-role-contract-findings.md`
   still contains the placeholder stub under "## Verification": "Results
   will be recorded after parser regression checks and the bounded live
   comparison." There is therefore no before/after strict-parser pass-rate
   table — a required expected output. The harness file itself exists and
   is well-formed (8-call bound, `assert.ok(++calls <= 8)`, packet and
   before-prompt asserted identical to the historical transcript, prior
   roles/models replayed), so the remaining work is: run it, record the
   table, update the findings file.

### HIGH

(none beyond the criticals; the code itself verifies clean)

### MEDIUM

(none — see skill-perspective check above; no useless tests or needless
production complexity found)

### LOW

1. `.omo/evidence/2026-10-03-44g-role-contract-live.mjs` compares
   `before` = `--agent <role>` + pre-edit vNext body (replicating the buggy
   probe harness) against `after` = no `--agent` + new vNext body. This
   measures the combined fix, not the isolated contribution of either the
   body repoint or the machine-mode section. Acceptable for the stated
   question ("does the unified contract raise strict-parser pass rate"),
   but the pass-rate table should label it as combined-effect, not
   attribution. Note also the production before-state differed (no --agent,
   live bodies); the findings file documents this correctly.
2. The new `--agent`-absence assertion (tests/test_runner_spike.mjs:758)
   pins a comment-only invariant. Justified as a regression pin for this
   issue, but it cannot detect the harness or external callers re-adding
   `--agent`; worth noting, not fixing.

## Verdict

The code diff is correct, minimal, and well-tested: contract repoint is
the least invasive single-contract fix, the parser fails closed on
ambiguity, provenance is preserved, the spine gate remains strict, and
all 82 relevant tests pass under this reviewer's own run. The blocker is
entirely in completion: the work is uncommitted, unrun live, and un-PR'd.

codeQualityStatus: BLOCK
recommendation: REQUEST_CHANGES
