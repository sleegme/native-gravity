# Internals (NTG 2.0)

Implementation reference for maintainers. It covers NTG 2.0 module boundaries, model routing, ledger locking, safety hooks, telemetry, and release verification. For everyday use, read [Usage](usage.md); for design overview, read [Architecture](architecture.md). The canonical Season 2 specification is [specs/ntg-2.0-architecture-contract.md](specs/ntg-2.0-architecture-contract.md).

## Core & Runtime Architecture

```text
User (/ntg, ntg-command, ntg-vnext)
  -> SteamrollerController (src/runtime/steamroller-controller.mjs)
       ├─ ModelRouter (src/core/model-router.mjs)         [capability only; immutable ROLE_AUTHORITY_TABLE]
       ├─ TrackRunner (src/runtime/track-runner.mjs)      [Track L HALO_LIGHTWEIGHT vs Track S/M ZEN_DURABLE]
       ├─ LedgerKernel (src/core/ledger-kernel.mjs)       [.ntg/ledger.json + lock-manager.mjs + v1-compat.mjs]
       ├─ LightweightLog (src/core/lightweight-log.mjs)   [.ntg/lightweight-runs.jsonl + digest binding]
       └─ Model-Aware Harness (src/harness/*.mjs)         [Layer 1/2/3 + Lightweight Worker Harness]
```

- **State ownership boundary:** Only `LedgerKernel` (`src/core/ledger-kernel.mjs`), `LightweightLog` (`src/core/lightweight-log.mjs`), and `v1-compat.mjs` (`src/core/v1-compat.mjs`) mutate `.ntg/ledger.json`, `.ntg/ledger.json.lock`, or `.ntg/lightweight-runs.jsonl`. Model-driven tool calls targeting those protected paths or `hooks.json` / `hooks/*.py` / `plugin.json` are blocked unconditionally by `hooks/shell-safety-guard.py`.
- **Owner-token ledger lock:** `src/core/lock-manager.mjs` writes `<pid>\ntoken:<uuid>\n` exclusively via `O_CREAT | O_EXCL` (`wx`), tracks active owner tokens in-process, and validates dead-owner PIDs before stale-lock recovery (`breakStaleLedgerLock` uses `parseLockFileContent`).

## Role Ownership & Model Policy (`src/core/model-router.mjs`)

| Role | Policy Model (Effort) | Authority / Capability |
|---|---|---|
| `steamroller` | Carbon Medium -> `Gemini 4 Argon (Medium)` (`gemini-pro-orchestrator-g1-pro` excluded) | Control-plane supervisor, Track L/S/M router, sole ledger writer |
| `piledriver` | `Gemini 4 Argon (High)` | `READ_ONLY` bounded architecture, planning, tactical/material replan advisor |
| `bulldozer` | `Gemini 4 Hydrogen (XHigh)` | Selective coordinator & primary recovery lead (replacing retired Excavator); guarded general `run_command`; invokes Jaguar, Puma, Bobcat, Strix Halo |
| `strix-halo` | `Gemini 4 Hydrogen (High)` | `READ_ONLY` unified cross-caller reviewer (`steamroller`, `bulldozer`, `bobcat`) via `ReviewRequest` |
| `bobcat` | `Gemini 4 Hydrogen (Medium)` | Substantive code/API/state/test implementation + local verification + invokes `strix-halo` |
| `jaguar` | `Gemini 3.8 Flash (Low)` | `READ_ONLY` Lightweight Worker Harness scout (`REROUTE_REQUIRED` to Bobcat/Bulldozer on deep/code tasks) |
| `puma` | `Gemini 3.8 Flash (Low)` | Separate mechanical/formatting/config edits (`REROUTE_REQUIRED` to Bobcat/Bulldozer on substantive code/shell) |
| `zen` | `Claude Opus 5.5 (High)` (`Gemini 4 Argon High` quota fallback) | Independent non-mutating summative verifier (`NTG_ACTIVE_ROLE=zen`); `GO \| NO-GO` |
| `instinct` | `Claude Sonnet 5.5 (High)` (`Claude Opus 5.5 High` on escalation) | `READ_ONLY` alternate causal framing (`NEEDS_ALT`) and second-leg recovery advisory |
| `navi` | `Gemini 4 Argon (Medium)` | Isolated Linux desktop leaf using private per-process `HOME` with `cu` MCP (`NEEDS_CONFIRMATION`) |

**Retired completely:** `Excavator` (`agents/excavator.md`, `scripts/excavator-agy.mjs`, `hooks/excavator-shell-guard.py`) and hard per-turn count blocks (`hooks/budget-guard.py`, `BULLDOZER_BUDGET_DEFAULTS`, `NTG_SALVAGE`) are permanently removed in NTG 2.0.

## Track Gates, Digest Binding & Replanning

- **Track L (`HALO_LIGHTWEIGHT`):** Requires a fresh Strix Halo `ACCEPT` bound to `candidate_id_or_run_id`, `reviewed_diff_digest`, `acceptance_criteria_digest`, `plan_version`, and `evidence_basis`. Zen is omitted by default unless Steamroller escalates for high risk.
- **Track S / M (`ZEN_DURABLE`):** Track S keeps Strix Halo conditional + Zen required; Track M requires both fresh bound Halo `ACCEPT` and Zen `GO`. Halo `ACCEPT` alone never promotes a milestone.
- **Tactical & Material Replans:** Both increment `plan_version` and mark all prior Zen `GO` and Halo verdicts `STALE` in `LedgerKernel` so retained milestones undergo fresh current-version review in dependency order.
- **Recovery Safety Cap:** `SteamrollerController.recoverMilestone` coordinates `Bulldozer (Hydrogen XHigh)` + on-demand `Instinct`, tracked by `LedgerKernel.recordRecoveryAttempt` against `max_recovery_retries = 3`.

## Universal Safety Guard, Zen Non-Mutation & Telemetry

- **`hooks/shell-safety-guard.py`:** Enforces protected state/config paths, `READ_ONLY` role write denials (`zen`, `strix-halo`, `jaguar`, `piledriver`, `instinct`), privilege escalation / `sudo -S` / destructive command blocks, and env-spoofing guards across BOTH `run_command` and file-mutation tools (`write_to_file`, `replace_file_content`, `multi_replace_file_content`, `write_file`, `edit_file`) with zero bypass markers or shell exceptions.
- **`hooks/zen-shell-guard.py`:** Enforces strict read-only command validation for Zen under both runner-injected `NTG_ACTIVE_ROLE=zen` and `NTG_ZEN_VERIFY=1`, rejecting compound/chained/redirection/mutation tricks.
- **`hooks/telemetry-guard.py`:** Observation-first telemetry logging to `.ntg/telemetry.jsonl`. High legitimate tool/read counts never auto-block; only confirmed non-progressing identical repetition triggers minimal loop-escape hints.

## Release & Compatibility Verification

Run the offline verification suites before release:

```bash
SKIP_LIVE_TESTS=1 node --test tests/*.mjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
node scripts/sync-version.mjs --check
```

1.x backward compatibility (`ledger.json`, `plan.json`, `plugin.json` load -> operate -> save -> reload) is enforced by `src/core/v1-compat.mjs` and verified in `tests/test_v1_compat_roundtrip.mjs`. See [AGENTS.md](../AGENTS.md) and [Status](status.md) for current validation status.
