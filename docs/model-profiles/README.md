# Model Behavior Profiles (#75)

NTG treats the chosen model as a quality variable: different models show
different reasoning styles, failure modes, and stability. This directory
holds per-model profiles so role definitions can map a `model:` tier to a
concrete behavioral contract instead of a name.

> **Provisional research.** Profiles record hypotheses and partial observations;
> they do not change deployed routing (see [Internals](../internals.md#invocation-policy)).
> Statuses are `stub` (no evidence), `draft` (some observations), `partial` or
> `calibrated`. The collection pipeline below is a maintainer-local tool, not a
> shipped product feature.

## Schema

Each profile is one Markdown file (`<model>.md`) with this shape:

```markdown
# <model id> — profile
**Status:** stub | draft | partial | calibrated   **Last evidence:** <date or "none">

## Strengths
- <observed pattern>

## Known biases / failure modes
- <observed pattern + consequence>

## Recommended role mapping
| Role tier | Fit | Reason |
|---|---|---|
| planner | strong/medium/weak/none | ... |
| executor | ... | ... |
| gate / reviewer | ... | ... |
| specialist (explore/design) | ... | ... |

## Gate-checklist variants
- <things the gate reviewer should watch specifically for this model>

## Evidence sources
- <links to runs/issues/QA notes>
```

The `model:` values used in `agents/*.md` (`flash`, `pro`, `inherit`) are
tiers, not concrete IDs. On AGY 1.3.6, native `pro` is the Gemini 4 Argon
tier; AGY owns its reasoning effort. Runner roles use exact family/effort
policies instead of frontmatter. See [Argon](gemini-4-argon.md) for mappings
and cost guidance.

## Current profiles

- `gemini-3.1-flash.md` — stub (legacy fast lane)
- `gemini-3.1-pro.md` — historical stub (retired; no installed slug)
- `gemini-3.8-flash.md` — draft (current de-facto executor tier on AGY ≥1.3)
- `gemini-4-argon.md` — current routing and cost guidance (#74)

## Pipeline hook

`~/chat/ntg-improvement-loop.mjs` (user-local, driven by the daily timer) is
the collection path. Since 2026-10-08 it aggregates per-model
`Resolving model <slug>` counts from the CLI logs into
`~/.chat/ntg-model-stats.json`, which is the feed for these files. The schema
above is the contract that aggregation targets.
