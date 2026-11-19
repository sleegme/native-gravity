# Status

[한국어](ko/status.md) · [Usage](usage.md) · [Internals](internals.md)

- **Native Gravity**: 2.0.1
- **Status**: NTG 2.0 (Season 2 on `feat/ntg-2.0.0`)
- **Compatibility**:
  - Host `agy models` surface verified (`gemini-4-argon-{low,medium,high}`, `gemini-4-hydrogen-{low,medium,high,xhigh}`, `gemini-3.8-flash-{low,medium,high}`, `claude-opus-5-5-{low,medium,high}`, `claude-sonnet-5-5-{low,medium,high}`)

The [Versioning Policy](versioning.md) defines the version rules and lifecycle stages.

## What works today (NTG 2.0)

- **Hybrid control plane & Track L / S / M routing:** `SteamrollerController` (`src/runtime/steamroller-controller.mjs`) and `TrackRunner` (`src/runtime/track-runner.mjs`) classify tasks autonomously into Track L (`HALO_LIGHTWEIGHT` via `src/core/lightweight-log.mjs`) and Track S/M (`ZEN_DURABLE` via `src/core/ledger-kernel.mjs`), including high-risk Zen escalation on Track L.
- **Role lineup & retired Excavator:** **Bulldozer** (`Gemini 4 Hydrogen XHigh`) + on-demand **Instinct** (`Claude Sonnet 5.5 High` / escalated `Claude Opus 5.5 High`) replace retired **Excavator** (`agents/excavator.md`, `scripts/excavator-agy.mjs`, `hooks/excavator-shell-guard.py` removed completely). **Puma** (`Gemini 3.8 Flash Low`) stays separate for bounded mechanical edits, while `3.8 Flash Low` tasks exceeding capability reroute cleanly to **Bobcat** (`Gemini 4 Hydrogen Medium`) or **Bulldozer**.
- **Cross-caller Strix Halo & strict Halo/Zen separation:** Steamroller, Bulldozer, and Bobcat invoke `strix-halo` via unified `ReviewRequest` (`ACCEPT | REVISE | ESCALATE`), bound to `candidate_id_or_run_id`, `reviewed_diff_digest`, `acceptance_criteria_digest`, `plan_version`, and `evidence_basis`. Drift automatically marks Halo reviews `STALE`, and Halo `ACCEPT` never substitutes for Zen `GO` on Track S/M.
- **Authority-decoupled `ModelRouter`:** `src/core/model-router.mjs` routes capability dynamically (`Carbon Medium` -> `Gemini 4 Argon Medium`, excluding `gemini-pro-orchestrator-g1-pro`) while forbidding any expansion of immutable role permissions.
- **Universal safety guard & observation-first telemetry:** `hooks/shell-safety-guard.py` and `hooks/zen-shell-guard.py` enforce protected paths, read-only/Zen locks (`NTG_ACTIVE_ROLE=zen`), and privilege boundaries across BOTH `run_command` and file-mutation tools with zero bypass markers. `hooks/telemetry-guard.py` replaces retired `hooks/budget-guard.py`.
- **Tactical & Material replanning + 1.x compatibility:** `LedgerKernel` increments `plan_version` and marks all prior Zen `GO` and Halo reviews `STALE` on both Tactical and Material replans, manages owner-token locks (`src/core/lock-manager.mjs`), enforces orchestration recovery safety caps (`max_recovery_retries = 3`), and preserves 1.x `.ntg/ledger.json`, `plan.json`, and `plugin.json` round-trips (`src/core/v1-compat.mjs`).

## Limits and known boundaries

- **Deterministic offline coverage vs. live `agy` runs:** The offline JS and Python test suites mock model calls cleanly (`SKIP_LIVE_TESTS=1`); full live end-to-end agent runs require explicit opt-in (`NTG_LIVE_TESTS=1`) and active `agy` model quota.
- **Linux crash recovery:** PID+token orphan executor cleanup (`ntg-vnext recover`) uses Linux `/proc` and Python `os.pidfd_open`. Only one supervisor session may own `.ntg/ledger.json.lock` at a time.

## Live & Deterministic Validation

Deterministic offline suites (`SKIP_LIVE_TESTS=1 node --test tests/*.mjs` + `python3 -m unittest discover -s tests -p 'test_*.py' -v`) cover:

- `ModelRouter` slug resolution, session catalog caching, excluded orchestrator default check, and `AuthorityExpansionError` enforcement (`tests/test_model_router.mjs`, `tests/test_runner_spike.mjs`)
- `LedgerKernel`, `LightweightLog`, owner-token `lock-manager`, Halo freshness/staleness binding, tactical/material replanning, and 1.x `.ntg/ledger.json` / `plan.json` / `plugin.json` round-trip compatibility (`tests/test_ledger.mjs`, `tests/test_ledger_guard.mjs`, `tests/test_v1_compat_roundtrip.mjs`)
- Universal `hooks/shell-safety-guard.py`, `hooks/zen-shell-guard.py`, `hooks/telemetry-guard.py`, and Model-Aware Harness Layers 1–3 (`tests/test_shell_safety_guard.py`, `tests/test_zen_shell_guard.py`, `tests/test_telemetry_guard.py`, `tests/test_harness.mjs`)
- `SteamrollerController`, `TrackRunner`, `MinimalSpine`/`SteamrollerSpine`, and `ntg-vnext` runtime/CLI transitions (`tests/test_spine.mjs`, `tests/test_ntg_vnext.mjs`)

## Historical baseline records (1.x pre-Season 2)

Pre-2.0 validation records on AGY 1.3.3/1.3.6 (retained in `.omo/evidence/`) documented the 1.x MinimalSpine activation, temporary Excavator headless bridge prior to Season 2 retirement, and initial Instinct `NEEDS_ALT` live probes. In NTG 2.0, `Excavator` and `hooks/budget-guard.py` are permanently removed.
