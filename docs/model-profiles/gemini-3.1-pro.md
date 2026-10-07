# gemini-3.1-pro — profile
**Status:** stub   **Last evidence:** none (collection pipeline pending)

## Strengths
- Stronger reasoning depth; the right tier for trade-off analysis and
  completion review.

## Known biases / failure modes
- Historically drifted on long-running mutation loops (the v0.3.3 global
  mutation deny existed for this reason); v0.4 re-scoped authority so
  Excavator may mutate while Zen stays read-only. Watch for overstepping a
  read-only role's intent when given a long rationale chain.

## Recommended role mapping
| Role tier | Fit | Reason |
|---|---|---|
| planner | strong | trade-offs, acceptance design |
| executor (excavator) | strong | bounded autonomous repair |
| gate / reviewer (zen, strix-halo) | strong | default |
| specialist (steamroller reasoning) | strong | deep-reasoning tier |

## Gate-checklist variants
- On read-only roles, check that no file mutation happened even with a
  plausible justification.
- Check that a `VERDICT: GO` cites concrete evidence, not a chain of
  reasoning alone.

## Evidence sources
- Pending `ntg-improvement-loop.mjs` per-model aggregation.
