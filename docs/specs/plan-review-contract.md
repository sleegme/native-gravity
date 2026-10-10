# Zen Plan-Review Contract

> **Status:** Active — issue #126
> **Implements:** `agents/zen.md` (plan-review section), consumed by `agents/piledriver.md`
> **Gate:** `hooks/primary-review-gate.py` — unchanged; the verdict format below parses identically

Piledriver's final plan-readiness gate is Zen reviewing the *plan itself* before
`PLAN READY` — a second pair of eyes on the reasoning, not the diff. A bad plan
that is implemented faithfully otherwise only fails at merge review. Zen remains
the same non-mutating, read-only reviewer; plan review adds a second review
shape to the existing artifact-review contract rather than a new agent or new
tools.

## Packet inputs

Piledriver supplies Zen with a plan-review packet containing, explicitly:

1. **Original request and acceptance contract** — carried losslessly; derived
   checklists may supplement but never replace it.
2. **Chosen PO option or decision** the plan must follow, when one exists.
3. **Current plan** — including `TASK_GRAPH`, dependencies, and parallelizable
   groups.
4. **Material evidence with sources** — each claim backed by a file, commit, or
   quote.
5. **Remaining UNKNOWN gaps and needs.**
6. **Recommended verification strategy.**

## Review checklist

Zen reviews the plan against five items:

1. **Scope coverage** — `TASK_GRAPH` covers the decided scope: every item in the
   original request and the PO decision maps to a task; nothing asked is
   silently dropped.
2. **Repo consistency** — each plan step is consistent with repo reality:
   referenced surfaces, files, and commands actually exist, or are flagged
   UNKNOWN rather than asserted. (This class of check is what would have caught
   the #112 Settings-tabs gap.)
3. **Evidence sourcing** — evidence claims carry a source (file, commit, or
   quote); unbacked claims are marked `INFERRED` or `UNKNOWN` rather than stated
   as fact.
4. **Fan-out safety** — work packages are independent: parallelizable groups
   share no hidden mutable state.
5. **PO-contract fidelity** — the plan follows the chosen PO option: no quiet
   re-litigation of the decision and no scope substitution.

## Verdict format

Unchanged from artifact review:

- `VERDICT: GO` — the plan satisfies every checklist item.
- `VERDICT: NO-GO` — followed by numbered blockers naming the failed items and
  the required revisions.

Because the format is unchanged, `primary-review-gate.py` needs no parsing
change: a plan-review `VERDICT: GO` gates `PLAN READY` exactly the way an
artifact-review GO gates completion.

## Boundaries

- Zen stays non-mutating and read-only; plan review grants it no tools and no
  repair authority. Every verification command still carries `NTG_ZEN_VERIFY=1`.
- The plan-review section in `agents/zen.md` is additive; the existing
  artifact-review contract is unchanged.
- No new agent and no topology change: this is the PO's option A — the
  plan-review contract lives in Zen, the existing shared review gate.
- On `NO-GO`, Piledriver revises only around the concrete blockers and requests
  a fresh review; an older GO is stale after a material plan revision or a
  newer Zen invocation.
