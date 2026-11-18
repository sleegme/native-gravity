# Native Gravity 2.0 (Season 2) Architecture Contract

> **Status:** Canonical NTG 2.0 (Season 2) specification (`PO_DECISIONS_AND_FINAL_CONSISTENCY_COMPLETE`)
> **Branch:** `feat/ntg-2.0.0` (baseline commit `32f0ada`)
> **Supersedes:** [vNext Architecture Contract](./vnext-architecture-contract.md) (1.x MinimalSpine flow)

This document is the canonical architecture contract for Native Gravity 2.0 (Season 2). All NTG 2.0 runtime code (`src/core/`, `src/harness/`, `src/runtime/`), agent definitions (`agents/`), hooks (`hooks/`, `hooks.json`), rules (`rules/`), and UX entry points (`skills/ntg/`, `scripts/`) are authored cleanly from this contract and `rules/harness.md`.

**Provenance Legend:**
- `PO_CONFIRMED` — Explicitly decided and locked by the Product Owner.
- `EXISTING_BASELINE_DEFAULT` — Retained baseline setting from vNext 1.x not overridden by PO.
- `DESIGN_DEFAULT` — Implementation/architecture default proposed within PO constraints.
- `HYPOTHESIS` — Empirical hypothesis requiring live probes or measurement.

---

## Table of Contents

1. [Hybrid Control Plane & Target Topology](#1-hybrid-control-plane--target-topology)
2. [Role Lineup, Model Routing & Authority Decoupling](#2-role-lineup-model-routing--authority-decoupling)
3. [Track Verification, Halo Binding & Replanning Policy](#3-track-verification-halo-binding--replanning-policy)
4. [LedgerKernel, LightweightLog & 1.x Compatibility](#4-ledgerkernel-lightweightlog--1x-compatibility)
5. [Model-Aware Harness & Observation-First Telemetry](#5-model-aware-harness--observation-first-telemetry)
6. [Universal Mutation Safety Guard](#6-universal-mutation-safety-guard)
7. [Simple `/ntg` User Entry Flow](#7-simple-ntg-user-entry-flow)
8. [Decision Invariants (`DI-NTG2-00` .. `DI-NTG2-07`)](#8-decision-invariants-di-ntg2-00--di-ntg2-07)

---

## 1. Hybrid Control Plane & Target Topology

NTG 2.0 replaces the 1.x `MinimalSpine` loop with a clean-room hybrid control plane: an **interactive AGY `Steamroller`** coupled with a thin deterministic **`LedgerKernel`** (`src/core/ledger-kernel.mjs`) and **`LightweightLog`** (`src/core/lightweight-log.mjs`).

```text
USER (/ntg UX)
  └─► STEAMROLLER  [Carbon Medium -> Gemini 4 Argon Medium; AGY Orchestrator excluded]
        │  (Autonomous Track L / S / M classification, routing, dynamic capability overrides,
        │   high-risk Zen escalation, Instinct invocation timing, retry judgment within cap)
        │
        ├─► Track L (HALO_LIGHTWEIGHT -> .ntg/lightweight-runs.jsonl)
        │     ├─► Direct Lightweight Workers: JAGUAR / PUMA (3.8 Flash Low) or BOBCAT (Hydrogen Medium)
        │     └─► STRIX HALO (Hydrogen High) [REQUIRED completion gate; Zen OMITTED unless escalated]
        │
        ├─► Track S / Track M (ZEN_DURABLE -> .ntg/ledger.json)
        │     ├─► PILEDRIVER (Gemini 4 Argon High, READ_ONLY) — architecture, milestone graph, replans
        │     ├─► Direct Workers: JAGUAR / PUMA (Flash Low) or BOBCAT (Hydrogen Medium)
        │     ├─► BULLDOZER (Gemini 4 Hydrogen XHigh) — selective coordinator & primary recovery lead
        │     │     ├─► JAGUAR (Flash Low, READ_ONLY scout)
        │     │     ├─► PUMA (Flash Low, separate mechanical/formatting/config worker)
        │     │     ├─► BOBCAT (Hydrogen Medium, substantive implementation + local verification)
        │     │     └─► STRIX HALO (Hydrogen High, READ_ONLY reviewer; callable by Steamroller/Bulldozer/Bobcat)
        │     ├─► INSTINCT (Sonnet 5.5 High / Opus 5.5 High escalated, READ_ONLY) — autonomous alternate framing
        │     └─► ZEN (Opus 5.5 High / Argon High quota fallback, non-mutating) — summative GO / NO-GO gate
        │
        └─► NAVI (Gemini 4 Argon Medium) — isolated Linux desktop leaf (private HOME, `cu` MCP only)
```

**Retired completely:** `Excavator` (`agents/excavator.md`, `scripts/excavator-agy.mjs`, `hooks/excavator-shell-guard.py`) is permanently retired and replaced by **Bulldozer (Gemini 4 Hydrogen XHigh) + Instinct**.

---

## 2. Role Lineup, Model Routing & Authority Decoupling

### 2.1 Role & Model Catalog Policy (`ModelRouter`, `src/core/model-router.mjs`)

Model slugs are resolved dynamically against the installed AGY catalog (`agy models`), cached at session scope (#230), and fail closed if missing or ambiguous. Unreleased model slugs (such as `Carbon` or `Helix`) are never hardcoded.

| Role | Primary Model Policy | Fallback / Escalation | Provenance | Authority & Permissions |
|---|---|---|---|---|
| **Steamroller** | `Carbon (Medium)` (when exposed on catalog) -> `Gemini 4 Argon (Medium)` (`gemini-4-argon-medium`); **excludes** `gemini-pro-orchestrator-g1-pro` | None | `PO_CONFIRMED` | Interactive AGY orchestrator + `LedgerKernel` owner; classifies tracks, routes work, manages dynamic overrides, triggers Instinct/Zen/Navi |
| **Piledriver** | `Gemini 4 Argon (High)` | None | `PO_CONFIRMED` | `READ_ONLY` bounded architect, planner, and replan/NEEDS_DEEP advisor (no edits, no shell, no delegation) |
| **Bulldozer** | `Gemini 4 Hydrogen (XHigh)` | None | `PO_CONFIRMED` | Selective coordinator & primary recovery lead; read tools + subagent orchestration (`jaguar`, `puma`, `bobcat`, `strix-halo`) + **general `run_command` shell access** guarded across shell & file tools by `hooks/shell-safety-guard.py` (no direct ledger/hook/plugin mutation, no Zen invocation) |
| **Strix Halo** | `Gemini 4 Hydrogen (High)` | None | `PO_CONFIRMED` | `READ_ONLY` cross-caller reviewer (`view_file`, `grep_search`, `list_dir`, `find_by_name`); invocable by `steamroller`, `bulldozer`, and `bobcat` via unified `ReviewRequest`; returns `ACCEPT \| REVISE \| ESCALATE` |
| **Bobcat** | `Gemini 4 Hydrogen (Medium)` | None | `PO_CONFIRMED` | Substantive feature implementation, refactoring, stateful/API logic, bug fixes, and test authorship; file read/write + `run_command` (guarded) + `invoke_subagent` limited to `strix-halo` |
| **Jaguar** | `Gemini 3.8 Flash (Low)` | Reroute to `bobcat` / `bulldozer` | `PO_CONFIRMED` | `READ_ONLY` lightweight codebase scout under Lightweight Worker Harness (no edits, no shell, no delegation) |
| **Puma** | `Gemini 3.8 Flash (Low)` | Reroute to `bobcat` | `PO_CONFIRMED` | Separate lightweight mechanical, formatting & config worker under Lightweight Worker Harness (NOT merged into Bobcat; bounded text/config edits, no shell, no delegation) |
| **Zen** | `Claude Opus 5.5 (High)` | Quota fallback: `Gemini 4 Argon (High)` (`EXISTING_BASELINE_DEFAULT`) | `PO_CONFIRMED` / `EXISTING_BASELINE_DEFAULT` | Non-mutating summative verifier (`GO \| NO-GO`); enforced at execution boundary across shell & file tools via runner-injected `NTG_ACTIVE_ROLE=zen`; zero edits or delegation |
| **Instinct** | `Claude Sonnet 5.5 (High)` | Explicit escalation: `Claude Opus 5.5 (High)` | `EXISTING_BASELINE_DEFAULT` | `READ_ONLY` autonomous on-demand alternate-framing advisor (no edits, no shell, no delegation) |
| **Navi** | `Gemini 4 Argon (Medium)` | None | `EXISTING_BASELINE_DEFAULT` | Isolated desktop GUI leaf via private HOME & `cu` MCP dispatcher (`NEEDS_CONFIRMATION` before external/irreversible actions) |

### 2.2 Capability vs. Authority Decoupling (`DI-NTG2-01`)

> **Hard Invariant:** Model routing controls **capability/intelligence only**. Steamroller may dynamically override a role's model (fail-closed against the installed AGY catalog), but dynamic model overrides **NEVER** expand a role's tool permissions, mutation authority, delegation authority, or verification requirements.

When a task exceeds a lightweight worker's capability (`3.8 Flash Low` on Jaguar/Puma), Steamroller or Bulldozer cleanly reroutes the work to `bobcat` (`Hydrogen Medium`) or `bulldozer` (`Hydrogen XHigh`), or applies an authorized capability upgrade without altering authority boundaries.

---

## 3. Track Verification, Halo Binding & Replanning Policy

### 3.1 Tracks L / S / M

| Track | Use Case | Strix Halo Policy | Zen Policy | Persistence & Assurance Badge | Approval UX Policy |
|---|---|---|---|---|---|
| **Track L** (`Lightweight`) | Small, bounded, low-risk tasks | **REQUIRED** | **OMITTED by default** (Steamroller escalates to Zen if risk increases) | `.ntg/lightweight-runs.jsonl` (`HALO_LIGHTWEIGHT`) | `DESIGN_DEFAULT`: lightweight direct execution with mandatory Halo review; confirms before external/destructive actions or escalation to Track S/M |
| **Track S** (`Standard`) | Single-milestone / standard durable work | **CONDITIONAL** (complex logic or pre-Zen polish) | **REQUIRED** | `.ntg/ledger.json` (`ZEN_DURABLE`) | `CONFIRMED_REFINEMENT`: 1x initial plain-language plan approval on normal path (Material Replan & external/destructive confirmation gates trigger re-approval) |
| **Track M** (`Multi-Milestone`) | Complex / multi-milestone work | **REQUIRED** (formative pre-Zen quality review) | **REQUIRED (per milestone)** | `.ntg/ledger.json` (`ZEN_DURABLE`) | `CONFIRMED_REFINEMENT`: 1x initial plain-language plan approval on normal path (Material Replan & external/destructive confirmation gates trigger re-approval) |

### 3.2 Strict Distinction Between Halo & Zen (`DI-NTG2-05`)

- `LedgerKernel` and `LightweightLog` store `halo_reviews` and `zen_verdicts` in separate typed structures.
- **Halo `ACCEPT`** closes Track L (`HALO_LIGHTWEIGHT`) only when fresh and bound; it **never** substitutes for **Zen `GO`** on Track S/M or high-risk escalated work (`ZEN_DURABLE`).

### 3.3 Halo Review Binding & Staleness Invalidation

Every Halo review (`ReviewRequest` / `HaloReviewRecord`) binds to:
1. `candidate_id_or_run_id`
2. `reviewed_diff_digest` (code-computed digest of working tree / scope)
3. `acceptance_criteria_digest` (digest of milestone/task acceptance criteria)
4. `plan_version`
5. `evidence_basis` (test/verification outputs supporting the review)

Any change to delivered files/diff digest, acceptance criteria, `plan_version` (Tactical or Material Replan), or evidence basis **immediately invalidates** prior Halo `ACCEPT` as `STALE`. Stale Halo receipts cannot close Track L or satisfy Track M gates.

### 3.4 Tactical Replan vs. Material Replan

- **Tactical Replan (`tacticalReplan`)**: Autonomously adopted by Steamroller (often with Piledriver advice) when execution strategy, scope boundaries, or remaining milestone structure changes without altering user-approved goal, acceptance criteria, or decision invariants. Increments `plan_version` monotonically and **marks ALL existing Zen `GO` verdicts (and prior-version Halo receipts) `STALE`**, requiring full Zen revalidation (unchanged code need not be rewritten, only re-verified).
- **Material Replan (`materialReplan`)**: Changes user-approved `goal`, weakens/modifies `acceptance_criteria`, alters `decision_invariants`, or adds destructive side effects. Requires **explicit user re-approval** before adoption, increments `plan_version`, and marks all prior Zen `GO` verdicts and Halo receipts `STALE`.

---

## 4. LedgerKernel, LightweightLog & 1.x Compatibility

- **Clean-room core (`src/core/`)**:
  - `src/core/ledger-kernel.mjs`: thin authoritative ledger engine for Track S/M (`AuthoritativeLedger` alias retained for compatibility), enforcing `#201 A1/A2/A3/A7` invariants (candidate separation on replan, owner-token lock verification/recovery, code-computed `delivered_tree_digest`, explicit `OBSERVED` blocker resolution, criterion-covered Zen `GO`, and orchestration-level recovery safety cap `max_recovery_retries = 3`).
  - `src/core/lock-manager.mjs`: owner-token-backed `.ntg/ledger.json.lock` acquisition, integrity verification, and safe stale-lock recovery.
  - `src/core/lightweight-log.mjs`: sole internal writer for `.ntg/lightweight-runs.jsonl` (`HALO_LIGHTWEIGHT` Track L records).
  - `src/core/v1-compat.mjs`: Compatibility Adapter preserving 1.x `.ntg/ledger.json`, `plan.json`, and `plugin.json` semantics across full `load -> operate -> save -> reload` round-trips (`tests/test_v1_compat_roundtrip.mjs`). Any protected data/config migration runs exclusively through `v1-compat.mjs`'s internal host-process APIs, never through model-facing tools.

---

## 5. Model-Aware Harness & Observation-First Telemetry

### 5.1 Three-Layer Model-Aware Harness (`src/harness/`)

Clean-room design inspired by GJC/OmO principles (zero code or prompt text copied):
1. **Layer 1 — Model-Common Calibration (`model-calibration.mjs`)**: Preserves each model family's native reasoning and delegation traits without behavioral homogenization; intervenes strictly on observed cross-model friction (evidence classification `OBSERVED`/`INFERRED`/`UNKNOWN`, explicit interface errors, no silent assumption filling).
2. **Layer 2 — Role-Specific Directives (`role-directives.mjs`)**: Concise authority boundaries, tool allowlists/denylists, caller/callee contracts (including cross-caller `ReviewRequest` for Strix Halo), and Track L/S/M verification semantics without micro-managing reasoning steps.
3. **Layer 3 — Context & Tool Interface Optimization (`context-digest.mjs`)**: Auto-injects `ContextDigest` (`scope_map`, `git_diff_stat`, `changed_symbol_ranges`, `failure_summary`, `delivered_diff_digest`, `acceptance_criteria_digest`) into delegation and review packets.
4. **Lightweight Worker Harness (`lightweight-worker-harness.mjs`)**: Active from initial NTG 2.0 release for `jaguar` & `puma` (`3.8 Flash Low`) with strictly bounded inputs, explicit fact/edit schemas, context-capped file-reading helpers, and clean `REROUTE_REQUIRED` escalation when tasks exceed Flash Low capacity.

### 5.2 Observation-First Telemetry (`hooks/telemetry-guard.py`)

- Legacy hard-count blocking (`hooks/budget-guard.py`, `hooks.json` `role-budget-boundary`, `runner.mjs` `BULLDOZER_BUDGET_DEFAULTS` & `NTG_BUDGET_*`) is **completely removed** and never coexists with observation-first telemetry.
- `hooks/telemetry-guard.py` logs structured observations to `.ntg/telemetry.jsonl` evaluating:
  1. Output novelty (identical outputs vs. new information)
  2. Workspace state change (`OBSERVED` change)
  3. Task progress advancement
  4. Post-failure or post-edit retry legitimacy
- Repetition count is strictly a telemetry signal, **never** an automatic count-based block threshold. Selective minimal intervention occurs only when telemetry confirms non-progressing identical no-change looping.
- Orchestration-level recovery retry safety caps (`LedgerKernel.max_recovery_retries`, default `3`) remain strictly at the milestone retry boundary, completely separate from per-turn tool/read calls.

---

## 6. Universal Mutation Safety Guard

Because Bulldozer (`Hydrogen XHigh`) gains general `run_command` shell access and Excavator's wrapper is retired, `hooks/shell-safety-guard.py` enforces safety invariants unconditionally across **BOTH `run_command` AND file-mutation tools** (`write_to_file`, `replace_file_content`, `multi_replace_file_content`, `write_file`, `edit_file`) with **zero model-controlled bypass markers or shell exceptions**:

1. **Protected-path mutation invariant**: Unconditionally deny direct writes, edits, replacements, truncations, moves, or deletes targeting `.ntg/ledger.json`, `.ntg/ledger.json.lock`, `.ntg/lightweight-runs.jsonl`, `hooks.json`, `hooks/*.py`, or `plugin.json` from any model-facing tool call. Only `LedgerKernel`, `LightweightLog`, and `CompatibilityAdapter` (`src/core/v1-compat.mjs`) mutate protected paths via internal host-process Node FS APIs outside PreToolUse.
2. **Role-mutation authority invariant**: When runner-injected `NTG_ACTIVE_ROLE` is a non-mutating / `READ_ONLY` role (`zen`, `strix-halo`, `jaguar`, `piledriver`, `instinct`), deny file-mutation tools and mutating shell commands across both pathways. `zen` enforces strict read-only verification commands via both `hooks/shell-safety-guard.py` and `hooks/zen-shell-guard.py` (#201 A4).
3. **Privilege-escalation & credential-bypass prevention**: Deny `sudo -S`/`--stdin`, password-guessing loops, `su`, `pkexec`, localhost root SSH, shell-history credential mining (`.bash_history`/`.zsh_history`), and wrapper/pipe/subshell equivalents.
4. **Unauthorized persistent/destructive effect prevention**: Deny exploratory full-system upgrades (`apt/apt-get`, `pacman/yay/paru`, `dnf/yum`, `zypper`) and unauthorized destructive host/repo mutations.
5. **Environment & marker anti-spoofing**: Deny commands attempting to unset/override `NTG_ACTIVE_ROLE`, `NTG_SUPERVISOR_PID`, or `SKIP_LIVE_TESTS`.

---

## 7. Simple `/ntg` User Entry Flow

- `/ntg <task>` routes seamlessly across Track L (`DESIGN_DEFAULT` lightweight direct execution + Halo), Track S, and Track M (1x initial plain-language approval on normal path; Material Replan and destructive/external gates as explicit exceptions).
- `/ntg status`, `/ntg graph`, and `/ntg version` run cleanly via packaged `scripts/ntg-command.mjs` without requiring `$NTG` environment variables or exposing internal ledger/`result_ref` terminology in normal user communication (#200).

---

## 8. Decision Invariants (`DI-NTG2-00` .. `DI-NTG2-07`)

- `DI-NTG2-00`: Separate `m0` governing-spec verification (`tests/test_governing_spec.mjs`, decoupling `rules/orchestration.md` from `tests/test_role_guidance.mjs`) from `m2` agent-file updates (`agents/*.md`).
- `DI-NTG2-01`: Hybrid interactive `Steamroller` + `LedgerKernel`; dynamic model routing decoupled from role authority.
- `DI-NTG2-02`: Exact NTG 2.0 role & model lineup (`Steamroller` Carbon Medium -> Argon Medium excluding AGY Orchestrator; `Piledriver` Argon High; `Bulldozer` Hydrogen XHigh; `Strix Halo` Hydrogen High; `Bobcat` Hydrogen Medium; `Jaguar`/`Puma` 3.8 Flash Low separate; `Zen` Opus 5.5 High + Argon High fallback; `Instinct` Sonnet 5.5 / Opus 5.5 High; `Navi` Argon Medium).
- `DI-NTG2-03`: Complete retirement of Excavator and legacy role/budget/marker guards in `m2`; universal mutation safety across shell + file tools via `hooks/shell-safety-guard.py`.
- `DI-NTG2-04`: Bulldozer general `run_command` access under universal safety guard; unified cross-caller Strix Halo `ReviewRequest` (`steamroller`, `bulldozer`, `bobcat`).
- `DI-NTG2-05`: Strict separation of Halo (`HALO_LIGHTWEIGHT` on Track L) from Zen (`ZEN_DURABLE` on Track S/M); Halo binding & staleness invalidation; Tactical Replan full Zen GO revalidation.
- `DI-NTG2-06`: Model-Aware Harness (Model-Common Calibration + Role-Specific Directives + ContextDigest + Lightweight Worker Harness) + observation-first telemetry (`hooks/telemetry-guard.py`) completely replacing hard-count `budget-guard`.
- `DI-NTG2-07`: Ground-up clean-room runtime rewrite with verified 1.x `ledger.json`, `plan.json`, and `plugin.json` round-trip compatibility (`src/core/v1-compat.mjs`, `tests/test_v1_compat_roundtrip.mjs`).
