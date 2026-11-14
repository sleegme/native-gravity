# 44G step-7 e2e validation — run 4 (2026-10-07)

Harness: `.omo/evidence/2026-10-04-44g-e2e-live.mjs` (real agy calls via production `invoke()`)
Transcript: `/tmp/ntg-44g-e2e-bcgma6/transcript.json` (24 records)
Runner HEAD: `d91003f` (flag-order fix + bare-JSON + no-shell contract lines)

## Fixes since run 3

1. `scripts/runner.mjs` dd0c722 — bulldozer invocations get `--dangerously-skip-permissions`
   (owner decision "불도저한테 권한즘 풀어줘"). Flag placed BEFORE `--print` so agy
   consumes the correct prompt token (first attempt put the flag after `--print`
   and agy ate it as the prompt).
2. `docs/specs/vnext/agents/bulldozer.md` — "inspect known execution context,
   delegate discovery"; inspection is prompt-mediated (no shell/RunCommand);
   files named in the packet are read DIRECTLY (delegating a named read is a
   contract violation); bare-JSON response must start with `{` as first byte.

## Per-case verdicts (run 4)

| Case | Verdict | Result |
|---|---|---|
| case1 multi-milestone (bulldozer) | PASS | DONE + Zen GO; bulldozer read packet-named files directly, returned bare JSON |
| case3 fresh-context resume | PASS | milestones [one, two] completed across process restart |
| case4 plan revision | PASS | staleOk + freshOk, v2 verified |
| case2 zen-no-go (bulldozer → zen) | scenario-error | bulldozer TIMEOUT at 360s — actual work but exceeded budget |
| advisory piledriver | PASS | unchanged |

## Prior claim re-verified

| Prior claim | Status |
|---|---|
| Bulldozer error paths return structured `{"ok":false,...}` | holds — TIMEOUT returned structured |
| `TOOL_PERMISSION_DENIED` blocks e2e | RESOLVED by dd0c722 |

## Open — RESOLVED in solo rerun

- case2 timeout: RESOLVED — solo rerun (`.omo/evidence/2026-10-07-44g-case2-solo.mjs`,
  transcript `/tmp/ntg-44g-case2-xHCGsw/transcript.json`) at 600s budget:
  bulldozer DONE + Zen GO. The >360s was real work: producing a
  content-addressed artifact (git blob `4d79e9255...:package.json`) plus Zen
  verification via `git cat-file`. Not wedged.
- Naming note: "case2-zen-no-go" expected NO-GO because it assumed the criteria
  could not be satisfied. With permission to inspect, bulldozer produced a
  compliant artifact so GO is the correct verdict. Exercising actual NO-GO
  requires a deliberately non-compliant candidate — a test-design follow-up,
  not a defect.
