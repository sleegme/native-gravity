# gemini-4-hydrogen — profile (NTG 2.0)

**Status:** draft (NTG 2.0 primary execution and review family)
**Last evidence:** 2026-11-17 AGY `agy models` catalog exposes `gemini-4-hydrogen-low`, `gemini-4-hydrogen-medium`, `gemini-4-hydrogen-high`, and `gemini-4-hydrogen-xhigh`.

## Strengths
- Tiered reasoning spectrum (`-medium`, `-high`, `-xhigh`) aligned cleanly with NTG 2.0 execution and formative review responsibilities:
  - `gemini-4-hydrogen-xhigh`: **Bulldozer** (selective milestone coordination, multi-worker synthesis, root-cause failure recovery alongside Instinct).
  - `gemini-4-hydrogen-high`: **Strix Halo** (cross-caller implementation quality review for Steamroller, Bulldozer, and Bobcat).
  - `gemini-4-hydrogen-medium`: **Bobcat** (substantive implementation, refactoring, stateful/API logic, bug fixes, and test authorship).

## Known biases / failure modes
- `HYPOTHESIS`: Deep reasoning at `-high` / `-xhigh` can over-explore without structured `ContextDigest` injection; Layer 3 `ContextDigest` supplies `scope_map`, `git_diff_stat`, and `failure_summary` upfront.
- Requires strict separation between formative Halo verdicts (`ACCEPT`/`REVISE`/`ESCALATE`) and independent summative Zen `GO`/`NO-GO` verdicts.

## Recommended role mapping (NTG 2.0 deployed via `ModelRouter`)

| Role | Slug | Rationale |
|---|---|---|
| Bulldozer | `gemini-4-hydrogen-xhigh` | Selective coordination + primary failure recovery |
| Strix Halo | `gemini-4-hydrogen-high` | Cross-caller formative code & acceptance review |
| Bobcat | `gemini-4-hydrogen-medium` | Substantive code, API, state, and test implementation |

## Calibration & Guardrails
- Preserves native reasoning/tool-use traits via Layer 1 Model-Common Calibration.
- Bulldozer holds general `run_command` shell access guarded across shell and file-mutation tools by `hooks/shell-safety-guard.py`.
- Dynamic model overrides never expand role tool/mutation/delegation/verification permissions.
