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

## Open

- case2 timeout: bulldozer did real work but needed >360s. Either the milestone
  needs a longer budget for zen-no-go flows, or bulldozer spent cycles on
  delegated work it should have compressed. Needs a one-off rerun of case2
  alone at a higher budget to distinguish "slow" from "wedged".
