# Architecture (NTG 2.0)

[한국어](ko/architecture.md) · [Usage](usage.md) · [Internals](internals.md)

## Design intent

Native Gravity 2.0 (Season 2) shifts from a static headless spine to an **interactive Antigravity-native Steamroller control plane** paired with a thin deterministic **`LedgerKernel`** (`src/core/ledger-kernel.mjs`) and **`LightweightLog`** (`src/core/lightweight-log.mjs`). Users provide natural-language goals or plans and criteria; Steamroller selects tracks and internal roles transparently without surfacing internal state or jargon.

The canonical Season 2 contract is [specs/ntg-2.0-architecture-contract.md](specs/ntg-2.0-architecture-contract.md) (superseding [specs/vnext-architecture-contract.md](specs/vnext-architecture-contract.md) on `feat/ntg-2.0.0`).

## Hybrid control plane & track routing

```text
User goal (/ntg)
  -> Steamroller (Carbon Medium -> Gemini 4 Argon Medium)
       ├─ Track L (HALO_LIGHTWEIGHT)  : Direct / Lightweight workers -> Fresh Bound Strix Halo (ACCEPT) [+ Zen if high-risk] -> .ntg/lightweight-runs.jsonl
       ├─ Track S (ZEN_DURABLE)       : 1x approval -> Direct/Bobcat (+ conditional Halo) -> Independent Zen GO -> .ntg/ledger.json
       └─ Track M (ZEN_DURABLE)       : 1x approval -> Bulldozer (Hydrogen XHigh) [Jaguar/Puma/Bobcat + required Halo] -> Independent Zen GO -> .ntg/ledger.json
```

- **Track L** eliminates unnecessary ceremony on small low-risk changes while still binding fresh `Strix Halo` verification (`reviewed_diff_digest`, `acceptance_criteria_digest`, `plan_version`, `evidence_basis`). Steamroller escalates high-risk Track L tasks to Zen on judgment.
- **Track S / M** keep durable `ZEN_DURABLE` assurance. After **one initial plain-language confirmation**, execution runs continuously; re-approval is requested only on a **Material Replan** (which changes user goal, acceptance criteria, or invariants) or confirmation gates, whereas **Tactical Replans** adapt remaining milestones seamlessly while incrementing `plan_version` and invalidating all stale verdicts.

## Authority vs. capability decoupling

Model routing (`src/core/model-router.mjs`) optimizes intelligence/latency per task without ever altering immutable role boundaries (`ROLE_AUTHORITY_TABLE`):

- **Steamroller** (`Gemini 4 Argon Medium`; orchestrator model `gemini-pro-orchestrator-g1-pro` excluded from default routing): supervisor and ledger owner.
- **Piledriver** (`Gemini 4 Argon High`, `READ_ONLY`): bounded architecture, planning, and replan advice (`NEEDS_DEEP`).
- **Bulldozer** (`Gemini 4 Hydrogen XHigh`): selective milestone coordinator and primary recovery lead (replacing retired **Excavator** alongside **Instinct**), holding guarded general `run_command` shell access enforced by `hooks/shell-safety-guard.py`.
- **Strix Halo** (`Gemini 4 Hydrogen High`, `READ_ONLY`): unified cross-caller quality reviewer callable by Steamroller, Bulldozer, and Bobcat via `ReviewRequest` (`ACCEPT | REVISE | ESCALATE`). Halo never replaces Zen `GO` on durable tracks.
- **Bobcat** (`Gemini 4 Hydrogen Medium`): substantive code, API/stateful logic, and test implementation + local verification.
- **Jaguar** (`Gemini 3.8 Flash Low`, `READ_ONLY`) and **Puma** (`Gemini 3.8 Flash Low`, separate mechanical/formatting worker): governed by Lightweight Worker Harness, emitting `REROUTE_REQUIRED` cleanly to Bobcat or Bulldozer when complexity exceeds `3.8 Flash Low`.
- **Instinct** (`Claude Sonnet 5.5 High` / escalated `Claude Opus 5.5 High`, `READ_ONLY`): on-demand alternate framing (`NEEDS_ALT`) and second-leg recovery advisor.
- **Zen** (`Claude Opus 5.5 High` with `Gemini 4 Argon High` quota fallback): non-mutating summative verification gate (`NTG_ACTIVE_ROLE=zen` enforced across shell and file-mutation tools).
- **Navi** (`Gemini 4 Argon Medium`): isolated Linux desktop leaf running in a private `HOME` with `cu` MCP (`NEEDS_CONFIRMATION` for external/irreversible effects).

## Model-Aware Harness, Safety & Telemetry

`src/harness/` pairs model-common Layer 1 calibration (preserving native strengths such as Hydrogen multi-step test-driven iteration and Argon architectural synthesis) with Layer 2 role directives and Layer 3 auto-injected `ContextDigest`. `hooks/shell-safety-guard.py` enforces protected state/hook paths and role mutation locks universally across both shell commands and file-mutation tools with zero bypass markers, while `hooks/telemetry-guard.py` records observation-first tool telemetry in `.ntg/telemetry.jsonl`.

For exact APIs, lock protocols, and test gates, see [Internals](internals.md) and [Status](status.md).
