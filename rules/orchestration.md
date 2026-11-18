---
trigger: always_on
name: orchestration
description: "NTG 2.0 (Season 2) orchestration contract — hybrid Steamroller + LedgerKernel control plane, role lineup, authority-decoupled model routing, Track L/S/M verification, Halo binding & staleness, tactical/material replanning, Model-Aware Harness, observation-first telemetry, and universal mutation safety boundaries"
---

# NTG 2.0 (Season 2) Orchestration Contract

This is the routing, authority, and verification contract for the Native Gravity 2.0 (Season 2) runtime. It is authored cleanly from `docs/specs/ntg-2.0-architecture-contract.md` and governs how work moves between roles. Generic evidence and contract invariants live in `rules/harness.md`; both apply together.

## Topology

```text
User (/ntg)
  Steamroller — interactive AGY orchestrator & LedgerKernel owner (Carbon Medium -> Argon Medium; AGY Orchestrator excluded)
    Track L (HALO_LIGHTWEIGHT -> .ntg/lightweight-runs.jsonl)
      Jaguar / Puma (3.8 Flash Low, Lightweight Worker Harness) or Bobcat (Hydrogen Medium)
      Strix Halo (Hydrogen High) — REQUIRED completion gate (Zen OMITTED unless escalated)
    Track S / Track M (ZEN_DURABLE -> .ntg/ledger.json)
      Piledriver (Argon High, READ_ONLY) — architecture, milestone graph, replans, NEEDS_DEEP
      Jaguar / Puma / Bobcat — direct workers when bounded
      Bulldozer (Hydrogen XHigh) — selective coordinator, primary recovery lead, guarded general shell
        Jaguar (3.8 Flash Low) / Puma (3.8 Flash Low) / Bobcat (Hydrogen Medium)
        Strix Halo (Hydrogen High) — callable by Steamroller, Bulldozer, or Bobcat
      Instinct (Sonnet 5.5 High / Opus 5.5 High escalated, READ_ONLY) — autonomous alternate framing
      Zen (Opus 5.5 High / Argon High fallback, non-mutating) — independent summative GO / NO-GO gate
    Navi (Argon Medium) — isolated Linux desktop leaf (private HOME, `cu` MCP only)
```

Excavator is **COMPLETELY RETIRED** and replaced by **Bulldozer (Hydrogen XHigh) + Instinct**. The graph stays shallow (no unbounded coordination runtime).

## Routing by kind of work

| Work kind | Route |
|---|---|
| Factual discovery, locate existing behavior | `jaguar` (`Gemini 3.8 Flash Low`, `READ_ONLY`, Lightweight Worker Harness) |
| Small, clear, low-risk mechanical / formatting / config edits | `puma` (`Gemini 3.8 Flash Low`, kept separate from `bobcat`) |
| Substantive implementation, stateful/API logic, bug fixes, tests | `bobcat` (`Gemini 4 Hydrogen Medium`) |
| Cross-caller implementation / quality review | `strix-halo` (`Gemini 4 Hydrogen High`, `READ_ONLY`; callable by `steamroller`, `bulldozer`, `bobcat`) |
| Complex milestones, multi-worker synthesis, failure recovery | `bulldozer` (`Gemini 4 Hydrogen XHigh`, selective coordinator + general shell under universal guard) |
| Planning, architecture, ambiguity, replan / `NEEDS_DEEP` | `piledriver` (`Gemini 4 Argon High`, `READ_ONLY` advisory via `steamroller`) |
| Alternate causal framing / second-leg recovery | `instinct` (`Claude Sonnet 5.5 High` / `Opus 5.5 High` escalated, `READ_ONLY` autonomous via `steamroller`) |
| Independent summative verification | `zen` (`Claude Opus 5.5 High` / `Gemini 4 Argon High` quota fallback, non-mutating via `steamroller`) |
| Linux desktop observation & bounded interaction | `navi` (`Gemini 4 Argon Medium`, isolated private HOME leaf via `steamroller`) |

## Steamroller — interactive orchestrator & kernel owner

Steamroller operates as an interactive AGY orchestrator coupled with `LedgerKernel` (`src/core/ledger-kernel.mjs`) and `LightweightLog` (`src/core/lightweight-log.mjs`). It autonomously:
- Classifies work into **Track L**, **Track S**, or **Track M**;
- Routes work directly to lightweight/implementation workers (`jaguar`, `puma`, `bobcat`) or delegates complex/recovery milestones to `bulldozer` (`Hydrogen XHigh`);
- Judges high-risk escalation (requiring `zen` even for small high-risk tasks);
- Selects `instinct` invocation timing and failure retry counts within `LedgerKernel`'s orchestration-level hard safety cap (default `3`);
- Applies dynamic model capability overrides via `ModelRouter` (`src/core/model-router.mjs`), validated fail-closed against the installed AGY catalog.

**Authority Decoupling Invariant:** Dynamic model routing controls capability/intelligence only and **NEVER** expands a role's tool permissions, mutation authority, delegation authority, or verification requirements.

## Valid `LedgerKernel` transitions

| Transition | Preconditions and effects |
|---|---|
| Initialize / adopt plan | Record `goal`, `constraints`, `plan_version`, `milestones`, `decision_invariants` before delegation; active/completed start empty |
| Delegate / retry | `current_milestone === null`; select incomplete milestone with completed dependencies; set `current_milestone`; issue current-version packet |
| Receive candidate | Matching `milestone_id` and `plan_version`; assign `result_ref` and code-computed `delivered_tree_digest`; persist candidate before Zen review |
| `BLOCKED` / `NEEDS_DEEP` / invocation failure | Record redacted evidence, blockers, or escalation needs; clear `current_milestone`; do not promote |
| Zen `NO-GO` | Record matching verdict and `repair_needs`; clear `current_milestone`; leave milestone incomplete |
| Zen `GO` / promote | Matching `milestone_id`, `plan_version`, `result_ref`, and criterion-covered `OBSERVED` evidence; move to `completed_milestones`, clear `current_milestone` |
| Tactical Replan | Autonomously adopted when strategy/scope/remaining milestones change without altering goal/acceptance/invariants; increment `plan_version`, mark ALL existing Zen `GO` verdicts and Halo receipts `STALE`, clear `completed_milestones`, `current_milestone`, `_active_candidates`, and `active_candidate`, requiring full Zen revalidation |
| Material Replan | Changes goal, acceptance criteria, decision invariants, or destructive side effects; requires explicit user re-approval; ends active execution/review, increments `plan_version`, marks ALL existing Zen `GO` verdicts and Halo receipts `STALE`, clears active/completed state |
| Resolve blocker | Remove blocker only on `OBSERVED` resolution evidence; removal never promotes a milestone |

An empty `current_milestone` means no execution or review is active. Duplicate or mismatched packets never authorize transitions. Global completion requires every current-plan milestone completed with a valid non-stale Zen `GO`, no active blockers, matching `plan_version`, and directly observed evidence.

## Track verification & Halo vs. Zen distinction

| Track | Halo Policy | Zen Policy | Storage & Badge |
|---|---|---|---|
| **Track L** | `REQUIRED` | `OMITTED` by default (escalate if high-risk) | `.ntg/lightweight-runs.jsonl` (`HALO_LIGHTWEIGHT`) |
| **Track S** | `CONDITIONAL` | `REQUIRED` | `.ntg/ledger.json` (`ZEN_DURABLE`) |
| **Track M** | `REQUIRED` | `REQUIRED` (per milestone) | `.ntg/ledger.json` (`ZEN_DURABLE`) |

`LedgerKernel` and `LightweightLog` store `halo_reviews` and `zen_verdicts` in separate typed structures. Halo `ACCEPT` closes Track L (`HALO_LIGHTWEIGHT`) only when fresh and bound; it **never** satisfies Track S/M or high-risk Zen `GO` requirements (`ZEN_DURABLE`).

### Halo review binding & staleness invalidation

Every Strix Halo `ReviewRequest` (from `steamroller`, `bulldozer`, or `bobcat`) and `HaloReviewRecord` (`ACCEPT | REVISE | ESCALATE`) binds to:
- `candidate_id_or_run_id`
- `reviewed_diff_digest`
- `acceptance_criteria_digest`
- `plan_version`
- `evidence_basis`

Any change to delivered files/diff digest, acceptance criteria, `plan_version`, or evidence basis invalidates prior Halo `ACCEPT` as `STALE`. Stale Halo `ACCEPT` verdicts cannot be reused.

## Bulldozer, workers & Strix Halo

- **Bulldozer (`Gemini 4 Hydrogen XHigh`)**: Accepts one current-version milestone packet, coordinates `jaguar`, `puma`, `bobcat`, and `strix-halo`, and holds **general `run_command` shell access** guarded universally across shell and file-mutation tools by `hooks/shell-safety-guard.py`. Leads root-cause failure recovery (replacing retired Excavator) alongside `instinct`. Cannot mutate protected ledger/hook/plugin paths, invoke Zen, or issue `result_ref`.
- **Jaguar (`Gemini 3.8 Flash Low`)**: `READ_ONLY` codebase scout under Lightweight Worker Harness. Tasks needing deep cross-cutting reasoning reroute cleanly to `bobcat` / `bulldozer`.
- **Puma (`Gemini 3.8 Flash Low`)**: Separate mechanical, formatting, and config worker under Lightweight Worker Harness (NOT merged into `bobcat`). Substantive code/state/test tasks reroute to `bobcat`.
- **Bobcat (`Gemini 4 Hydrogen Medium`)**: Substantive implementation, refactoring, stateful/API logic, bug fixes, and test authorship (`run_command` guarded; `invoke_subagent` limited to `strix-halo`).
- **Strix Halo (`Gemini 4 Hydrogen High`)**: `READ_ONLY` cross-caller reviewer (`steamroller`, `bulldozer`, `bobcat`) returning `ACCEPT | REVISE | ESCALATE`.

## Model-Aware Harness & observation-first telemetry

- **Layer 1 (Model-Common Calibration)**: Preserves native model family traits; targets only cross-model friction (evidence classification `OBSERVED`/`INFERRED`/`UNKNOWN`, interface clarity, no silent assumption filling).
- **Layer 2 (Role-Specific Directives)**: Authoritative role boundaries, tool scopes, and Track L/S/M contracts without micro-management.
- **Layer 3 (`ContextDigest` & Tool Optimization)**: Auto-injects `scope_map`, `git_diff_stat`, `changed_symbol_ranges`, `failure_summary`, and digest bindings into packets.
- **Lightweight Worker Harness**: Bounds `jaguar`/`puma` (`3.8 Flash Low`) inputs, caps read contexts, enforces explicit fact/edit schemas, and emits clean reroute signals when tasks exceed Flash Low capacity.
- **Observation-first telemetry (`hooks/telemetry-guard.py`)**: Replaces retired hard-count `hooks/budget-guard.py` completely. Records telemetry in `.ntg/telemetry.jsonl` evaluating output novelty, `OBSERVED` workspace state change, task progress, and post-failure/edit retry context. Repetition count is never a count-only auto-block threshold. Orchestration-level milestone recovery caps (`LedgerKernel.max_recovery_retries`, default `3`) remain strictly at the milestone retry boundary.

## Universal mutation safety guard & sole writers

`hooks/shell-safety-guard.py` enforces unconditionally across **BOTH `run_command` AND file-mutation tools** (`write_to_file`, `replace_file_content`, `multi_replace_file_content`, `write_file`, `edit_file`) with **zero model-controlled bypass markers or shell exceptions**:
1. **Protected paths**: Direct writes, edits, truncations, moves, or deletes targeting `.ntg/ledger.json`, `.ntg/ledger.json.lock`, `.ntg/lightweight-runs.jsonl`, `hooks.json`, `hooks/*.py`, or `plugin.json` are unconditionally denied for all model-facing tool calls. Sole authoritative writers are `LedgerKernel` (`src/core/ledger-kernel.mjs`), `LightweightLog` (`src/core/lightweight-log.mjs`), `LockManager` (`src/core/lock-manager.mjs`), and the 1.x Compatibility Adapter (`src/core/v1-compat.mjs`) via internal host-process APIs.
2. **Role-mutation authority**: Non-mutating / `READ_ONLY` roles (`zen`, `strix-halo`, `jaguar`, `piledriver`, `instinct` via runner-injected `NTG_ACTIVE_ROLE`) are denied file-mutation tools and mutating shell commands across both pathways. `zen` additionally enforces strict read-only verification commands via `hooks/zen-shell-guard.py` (`NTG_ACTIVE_ROLE=zen` or `NTG_ZEN_VERIFY=1`).
3. **Privilege & destructive prevention**: Denies `sudo -S`/`--stdin`, password loops, `su`, `pkexec`, localhost root SSH, shell-history credential mining, exploratory full-system upgrades, and destructive host/repo operations.
4. **Anti-spoofing**: Denies attempts to unset or override `NTG_ACTIVE_ROLE`, `NTG_SUPERVISOR_PID`, or `SKIP_LIVE_TESTS`.

## Exact-model policy table (`ModelRouter`)

| Role | Model policy | Effort | Invocation |
|---|---|---|---|
| `steamroller` | `Carbon` (when exposed) -> `Gemini 4 Argon` (excludes `gemini-pro-orchestrator-g1-pro`) | `Medium` | Interactive / `ModelRouter` |
| `piledriver` | `Gemini 4 Argon` | `High` | `ModelRouter` / runner |
| `bulldozer` | `Gemini 4 Hydrogen` | `XHigh` | `ModelRouter` / runner |
| `strix-halo` | `Gemini 4 Hydrogen` | `High` | Native / cross-caller `ReviewRequest` |
| `bobcat` | `Gemini 4 Hydrogen` | `Medium` | Native worker |
| `jaguar` | `Gemini 3.8 Flash` | `Low` | Native worker (Lightweight Harness) |
| `puma` | `Gemini 3.8 Flash` | `Low` | Native worker (Lightweight Harness) |
| `zen` | `Claude Opus 5.5` (quota fallback: `Gemini 4 Argon`) | `High` | Native invocation (`NTG_ACTIVE_ROLE=zen`) |
| `instinct` | `Claude Sonnet 5.5` (escalated: `Claude Opus 5.5`) | `High` | `ModelRouter` / runner |
| `navi` | `Gemini 4 Argon` | `Medium` | Isolated desktop leaf |

`listInstalledModels()` caches `agy models` at runner session scope (#230).
