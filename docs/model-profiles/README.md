# Model Behavior Profiles (#75)

NTG treats the chosen model as a quality variable: different models show
different reasoning styles, failure modes, and stability. This directory
holds per-model profiles so role definitions can map a `model:` tier to a
concrete behavioral contract instead of a name.

## Schema

Each profile is one Markdown file (`<model>.md`) with this shape:

```markdown
# <model id> — profile
**Status:** stub | partial | calibrated   **Last evidence:** <date or "none">

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
tiers, not concrete IDs — a profile names the model ID a tier currently
resolves to so a future tier switch can diff behavior deliberately.

## Current profiles

- `gemini-3.1-flash.md` — stub (legacy fast lane)
- `gemini-3.1-pro.md` — stub (legacy slow lane; reviewer/executor default)
- `gemini-3.8-flash.md` — draft (current de-facto executor tier on AGY ≥1.3)

## Pipeline hook

`~/chat/ntg-improvement-loop.mjs` (user-local, driven by the daily timer) is
the collection path. Since 2026-10-08 it aggregates per-model
`Resolving model <slug>` counts from the CLI logs into
`~/.chat/ntg-model-stats.json`, which is the feed for these files. The schema
above is the contract that aggregation targets.
