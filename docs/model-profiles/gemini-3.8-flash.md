# gemini-3.8-flash — profile
**Status:** draft (evidence accumulating via ntg-improvement-loop per-model stats)
**Last evidence:** local CLI log aggregation shows `gemini-3.8-flash-high` ≈760 and `gemini-3.8-flash-low` ≈35 model-resolution events in Oct-2026 logs — the de-facto default executor tier.

## Strengths
- Fast, cheap, and stable for bounded executor/discovery tasks.
- Sub-variants (`-low/-medium/-high`) let callers trade latency for reasoning depth without leaving the family.
- Verified live on AGY 1.3.1: headless `--print`, `--agent` dispatch, and Excavator→Zen gate round-trip all pass on `gemini-3.8-flash-low` (see `.omo/evidence/agy-1-3-1/side-probe.md`).

## Known biases / failure modes
- Shallow-diagnosis risk on multi-loop repair tasks (same failure mode family as 3.1-flash stubs; evidence pending).
- On `-low` tier, watch for truncated reasoning chains in gate output; escalate to `-medium/-high` when verdicts lack cited evidence.

## Recommended role mapping
| Role tier | Fit | Reason |
|---|---|---|
| planner | medium | outlines quickly; use -high for acceptance design |
| executor (bobcat/puma) | strong | default tier |
| gate / reviewer | weak→medium | usable at -high for lightweight reviews; Zen defaults to Pro tier |
| specialist (jaguar discovery) | strong | read-only, bounded |
| excavator | medium | works (verified on 1.3.1); prefer Pro for long repair loops |

## Gate-checklist variants
- Require cited command output in VERIFICATION_EVIDENCE, not assertions.
- On `-low`, check the model did not skip the Zen invocation step entirely.

## Evidence sources
- `~/.chat/ntg-model-stats.json` — aggregated by `ntg-improvement-loop.mjs` (#75 pipeline).
- `.omo/evidence/agy-1-3-1/side-probe.md` — live runs on AGY 1.3.1.
