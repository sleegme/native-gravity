# gemini-3.8-flash — profile
**Status:** draft (evidence accumulating via ntg-improvement-loop per-model stats)
**Last evidence:** local CLI log aggregation shows `gemini-3.8-flash-high` ≈760 and `gemini-3.8-flash-low` ≈35 model-resolution events in Oct-2026 logs — the de-facto default executor tier. Counts measure usage frequency, not quality.

## Strengths
- Fast, cheap, and stable for bounded executor/discovery tasks.
- Sub-variants (`-low/-medium/-high`) let callers trade latency for reasoning depth without leaving the family.
- Verified live on AGY 1.3.1: headless `--print`, `--agent` dispatch, and Excavator→Zen gate round-trip all pass on `gemini-3.8-flash-low` (see `.omo/evidence/agy-1-3-1/side-probe.md`). Historical: that Excavator→Zen gate belonged to the former native Excavator primary; the current Excavator worker never invokes Zen.

## Known biases / failure modes
- Shallow-diagnosis risk on multi-loop repair tasks (same failure mode family as 3.1-flash stubs; evidence pending).
- On `-low` tier, watch for truncated reasoning chains in gate output; escalate to `-medium/-high` when verdicts lack cited evidence.

## Recommended role mapping (NTG 2.0)

In NTG 2.0, `gemini-3.8-flash-low` powers the **Lightweight Worker Harness** for **Jaguar** (read-only scout) and **Puma** (separate mechanical/formatting/config worker). Substantive implementation and complex coordination moved to the **Gemini 4 Hydrogen** family (`Bobcat` Medium, `Strix Halo` High, `Bulldozer` XHigh). Tasks exceeding `3.8 Flash Low` capability reroute cleanly to `Bobcat` or `Bulldozer`.

| Role tier | Fit | Reason |
|---|---|---|
| specialist (jaguar discovery) | strong | read-only, bounded under Lightweight Worker Harness (`gemini-3.8-flash-low`) |
| mechanical worker (puma) | strong | separate low-cost text/formatting/config edits (`gemini-3.8-flash-low`) |
| substantive implementation | weak->reroute | route to Bobcat (`gemini-4-hydrogen-medium`) |
| coordination / recovery | reroute | route to Bulldozer (`gemini-4-hydrogen-xhigh`) + Instinct |

## Gate-checklist variants
- Require cited command output in VERIFICATION_EVIDENCE, not assertions.
- On `-low`, check the model did not skip the Zen invocation step entirely (historical native-primary flow; current workers never invoke Zen).

## Evidence sources
- `~/.chat/ntg-model-stats.json` — aggregated by `ntg-improvement-loop.mjs` (#75 pipeline).
- `.omo/evidence/agy-1-3-1/side-probe.md` — live runs on AGY 1.3.1.
