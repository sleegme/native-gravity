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

- `gemini-3.1-flash.md` — stub (fast lane; planner default)
- `gemini-3.1-pro.md` — stub (slow lane; reviewer/executor default)

## Pipeline hook

`scripts/ntg-improvement-loop.mjs` (user plugin) is the collection path: it
should emit a per-model aggregation (success rate, failure mode, reasoning
style tag) that feeds these files. That script lives outside this repo; the
schema here is the contract it should target.
