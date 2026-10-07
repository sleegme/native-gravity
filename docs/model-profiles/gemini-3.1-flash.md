# gemini-3.1-flash — profile
**Status:** stub   **Last evidence:** none (collection pipeline pending)

## Strengths
- Fast turnaround; low latency for short bounded tasks.
- Cheap enough to be the default executor/discovery tier.

## Known biases / failure modes
- TBD pending collected evidence. Watch for: premature completion claims on
  long tasks, shallow diagnosis loops.

## Recommended role mapping
| Role tier | Fit | Reason |
|---|---|---|
| planner | medium | fast at outlining; may under-specify edge cases |
| executor (bobcat/puma) | strong | default tier |
| gate / reviewer | weak | not the primary choice |
| specialist (jaguar discovery) | strong | read-only, bounded |

## Gate-checklist variants
- Check for "looks done" claims without a run/test output in evidence.
- Check context-pruning artifacts on tasks with many tool calls.

## Evidence sources
- Pending `ntg-improvement-loop.mjs` per-model aggregation.
