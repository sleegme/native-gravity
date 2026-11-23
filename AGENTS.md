# Working on Native Gravity (NTG 2.0 / Season 2)

## Product and governing specification

Build Native Gravity 2.0 (Season 2) as a clean, Antigravity-native autonomous LLM orchestration plugin centered on interactive **Steamroller** + **`LedgerKernel`** (`src/core/ledger-kernel.mjs`) and **`LightweightLog`** (`src/core/lightweight-log.mjs`), replacing the 1.x `MinimalSpine` execution flow while preserving 1.x `.ntg/ledger.json`, `plan.json`, `plugin.json`, and `/ntg` UX compatibility (`src/core/v1-compat.mjs`).

Consult `docs/specs/ntg-2.0-architecture-contract.md` as the canonical Season 2 architecture contract (`docs/specs/vnext-architecture-contract.md` is superseded on `feat/ntg-2.0.0`). Both `rules/harness.md` and `rules/orchestration.md` govern runtime behavior.

## Who owns what

Start user work through `/ntg` (`skills/ntg/SKILL.md` -> `scripts/ntg-command.mjs`) or `ntg-vnext`.
`src/runtime/steamroller-controller.mjs`, `src/runtime/track-runner.mjs`, and `scripts/ntg-vnext.mjs` drive the interactive Steamroller control plane using `src/core/model-router.mjs`, `src/core/ledger-kernel.mjs`, `src/core/lightweight-log.mjs`, and `src/harness/`.

**Steamroller** (Gemini 4 Neon Medium -> Carbon Medium -> Gemini 4 Argon Medium; AGY Orchestrator slugs `gemini-pro-orchestrator-g1-pro` and `gemini-pro-orchestrator-neon` excluded from default routing) supervises execution through `LedgerKernel` and `LightweightLog`. It autonomously classifies tasks into **Track L / S / M**, manages dynamic model capability routing (decoupled from role authority), selects Direct workers (`Jaguar`/`Puma`/`Bobcat`) vs. `Bulldozer`, judges high-risk Zen escalation, and decides `Instinct` invocation timing and recovery retry counts within `LedgerKernel`'s orchestration-level hard safety cap (default `3`). Only `LedgerKernel`, `LightweightLog`, and the 1.x Compatibility Adapter (`src/core/v1-compat.mjs`) mutate authoritative state/config paths via internal host-process APIs.

**Piledriver** (Carbon High -> Gemini 4 Argon High, `READ_ONLY`) supplies bounded proposals for milestone graphs, architecture, ambiguity, Tactical/Material replans, and `NEEDS_DEEP` trade-offs, plus **selective initial advisory planning per `plan_version`** (`--piledriver auto|always|never`, default `auto`: skips bounded, clear single-milestone Track S and Track L tasks; invokes for Track M, multi-milestone/dependency plans, high-risk/architectural/ambiguous tasks, or explicit `always` / `requireInitialPlanning: true`). Both `COMPLETED` (invoked) and `SKIPPED` outcomes are recorded with explicit `invoked` boolean, `decision_reason`, `decision_signals`, and `adopted: false` in `LedgerKernel` (`evidence.initial_planning[plan_version]`) and `LightweightLog` (`PLANNING_COMPLETED` / `PLANNING_SKIPPED`), making resumes, retries, and subsequent milestones idempotent per `plan_version` while re-evaluating on Tactical/Material Replan (new `plan_version`). When invoked, unavailability of both Carbon High and Argon High fails closed with `PILEDRIVER_PLANNING_UNAVAILABLE`; skipping initial planning preserves the `NEEDS_DEEP` escalation path. It cannot edit files, run shell commands, delegate, or adopt plans.

**Bulldozer** (Gemini 4 Neon High, escalating to Neon XHigh when needed) is the selective execution coordinator and primary recovery lead (replacing retired `Excavator` alongside `Instinct`). It coordinates `Jaguar`, `Puma`, `Bobcat`, and `Strix Halo` on complex milestones and has **general `run_command` shell access** enforced across BOTH shell and file-mutation tools by `hooks/shell-safety-guard.py`. It cannot mutate `.ntg/ledger.json`, `.ntg/ledger.json.lock`, `.ntg/lightweight-runs.jsonl`, `hooks.json`, `hooks/*.py`, or `plugin.json`, invoke Zen, or declare completion.

**Instinct** (Claude Opus 5.5 Low, `READ_ONLY`) supplies autonomous on-demand alternate-framing analysis (`NEEDS_ALT`), including as the second leg of Bulldozer + Instinct recovery.

**Strix Halo** (Gemini 4 Neon Medium, escalating to Neon High when needed, `READ_ONLY`) is invocable by **Steamroller**, **Bulldozer**, and **Bobcat** via a unified caller-aware `ReviewRequest`. It returns `ACCEPT | REVISE | ESCALATE` bound to `candidate_id_or_run_id`, `reviewed_diff_digest`, `acceptance_criteria_digest`, `plan_version`, and `evidence_basis`. Any change to the deliverable, criteria, plan_version, or evidence basis marks prior Halo `ACCEPT` as `STALE`. Because Steamroller also defaults to `Neon Medium`, Strix Halo evaluates strictly from inspected artifacts/digests rather than caller summaries and escalates to `Neon High` or heterogeneous `Zen` whenever risk warrants.

**Zen** (Claude Sonnet 5.5 High, with Gemini 4 Argon High baseline quota fallback) is the independent non-mutating summative gate (`GO | NO-GO`), enforced across BOTH shell and file-mutation tools via runner-injected `NTG_ACTIVE_ROLE=zen` (`hooks/shell-safety-guard.py` and `hooks/zen-shell-guard.py`). Halo `ACCEPT` (`HALO_LIGHTWEIGHT` on Track L) and Zen `GO` (`ZEN_DURABLE` on Track S/M and escalated high-risk tasks) are strictly separated and never substituted for each other.

**Navi** (Gemini 4 Neon Medium experimental, with reversion to Gemini 4 Argon Medium via `NTG_NAVI_EXPERIMENTAL_NEON=0` or `legacyFallback: true`) remains Steamroller's isolated Linux desktop leaf using a private per-process HOME with only the `cu` MCP server (`NEEDS_CONFIRMATION` before external/irreversible actions).

**Excavator is completely retired.** Neither `agents/excavator.md` nor `scripts/excavator-agy.mjs` nor `hooks/excavator-shell-guard.py` exists in NTG 2.0.

## Specialist selection & dynamic routing

| Need | Recipient | Model Policy | Authority |
|---|---|---|---|
| Locate code or collect codebase facts | **Jaguar** | Gemini 3.8 Flash Low | `READ_ONLY` (Lightweight Worker Harness) |
| Small, clear, mechanical/formatting/config edits | **Puma** (kept separate) | Gemini 3.8 Flash Low | Bounded text/config edits, no shell/delegation (Lightweight Worker Harness) |
| Substantive implementation, stateful/API logic, bug fixes, tests | **Bobcat** | Gemini 4 Hydrogen Medium | Scope read/write + guarded `run_command` + `strix-halo` |
| Cross-caller quality / diff review | **Strix Halo** | Gemini 4 Neon Medium (Neon High when needed) | `READ_ONLY`, callable by Steamroller, Bulldozer, Bobcat |
| Complex milestone coordination & primary failure recovery | **Bulldozer** | Gemini 4 Neon High (Neon XHigh when needed) | Read + worker orchestration + guarded general `run_command` |
| Planning, architecture, replan / `NEEDS_DEEP` advice | **Piledriver** | Carbon High -> Gemini 4 Argon High | `READ_ONLY` advisory |
| Alternate causal framing (`NEEDS_ALT`) & second-leg recovery | **Instinct** | Claude Opus 5.5 Low | `READ_ONLY` advisory |
| Independent summative verification | **Zen** | Claude Sonnet 5.5 High (Argon High fallback) | Non-mutating verification (`NTG_ACTIVE_ROLE=zen`) |
| Isolated Linux desktop observation/interaction | **Navi** | Gemini 4 Neon Medium (Experimental; Argon Medium fallback) | Private HOME `cu` MCP leaf |

**Capability vs. Authority Boundary:** Dynamic model overrides selected by Steamroller via `ModelRouter` change capability/intelligence only and **never** expand a role's tool permissions, mutation authority, delegation authority, or verification requirements. Tasks unsuitable for `3.8 Flash Low` (Jaguar/Puma) reroute cleanly to `Bobcat` (`Hydrogen Medium`) or `Bulldozer` (`Neon High` / `Neon XHigh`).

## Track verification & replanning

- **Track L** (`HALO_LIGHTWEIGHT` in `.ntg/lightweight-runs.jsonl`): Halo `REQUIRED`, Zen `OMITTED` by default (Steamroller escalates high-risk tasks to Zen).
- **Track S** (`ZEN_DURABLE` in `.ntg/ledger.json`): Halo `CONDITIONAL`, Zen `REQUIRED`. 1x initial plain-language approval on normal path (Material Replan and confirmation gates require re-approval).
- **Track M** (`ZEN_DURABLE` in `.ntg/ledger.json`): Halo `REQUIRED`, Zen `REQUIRED` per milestone. 1x initial plain-language approval on normal path.
- **Tactical Replan**: Autonomously adopted by Steamroller when execution strategy/scope/remaining milestones change without altering user-approved goal, acceptance criteria, or invariants. Increments `plan_version` and marks **all** existing Zen `GO` verdicts (and prior Halo receipts) `STALE` for full revalidation.
- **Material Replan**: Alters goal, acceptance criteria, decision invariants, or destructive scope; requires explicit user re-approval, increments `plan_version`, and marks all prior Zen `GO` verdicts and Halo receipts `STALE`.

## Model-Aware Harness, telemetry & universal safety guard

- **Model-Aware Harness (`src/harness/`)**: Layer 1 Model-Common Calibration (preserves native model traits; addresses observed cross-model friction and evidence discipline), Layer 2 Role-Specific Directives, Layer 3 `ContextDigest` injection, plus Lightweight Worker Harness (`Jaguar`/`Puma`) from initial implementation.
- **Observation-First Telemetry (`hooks/telemetry-guard.py`)**: Logs observations to `.ntg/telemetry.jsonl`. Legacy hard-count `hooks/budget-guard.py` blocking is completely removed. Repetition count is strictly a telemetry signal, never a count-only auto-block threshold, and remains separate from `LedgerKernel`'s orchestration-level recovery retry cap (default `3`).
- **Universal Mutation Safety Guard (`hooks/shell-safety-guard.py`)**: Enforces unconditionally across BOTH `run_command` AND file-mutation tools (`write_to_file`, `replace_file_content`, `multi_replace_file_content`, `write_file`, `edit_file`) with zero model-controlled bypass markers or shell exceptions:
  - Blocks direct mutations to `.ntg/ledger.json`, `.ntg/ledger.json.lock`, `.ntg/lightweight-runs.jsonl`, `hooks.json`, `hooks/*.py`, and `plugin.json`.
  - Blocks mutations by `READ_ONLY` / non-mutating roles (`zen`, `strix-halo`, `jaguar`, `piledriver`, `instinct`).
  - Blocks privilege-escalation (`sudo -S`, password loops, `su`, `pkexec`, localhost root SSH, shell-history mining), full-system upgrades, destructive mutations, and env/marker spoofing (`NTG_ACTIVE_ROLE`, `NTG_SUPERVISOR_PID`, `SKIP_LIVE_TESTS`).

## Evidence & release verification

- Classify statements as `OBSERVED`, `INFERRED`, or `UNKNOWN`. Inspect actual files and outputs before claiming satisfaction.
- Verify offline JS (`SKIP_LIVE_TESTS=1 node --test tests/*.mjs`) and Python (`python3 -m unittest discover -s tests -p 'test_*.py' -v`) suites without ambient live `agy` calls (`NTG_LIVE_TESTS=1` only for deliberate live probes).
- Verify 1.x `.ntg/ledger.json`, `plan.json`, and `plugin.json` compatibility via load -> operate -> save -> reload round-trip tests (`tests/test_v1_compat_roundtrip.mjs`).
