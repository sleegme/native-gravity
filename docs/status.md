# Status

- **Native Gravity**: 1.0.0
- **Status**: alpha
- **Compatibility**:
  - AGY 1.3.3 — validated (vNext runner live probes: #134, #138; delegation probes: #113/#56)

See [Versioning Policy](versioning.md) for versioning rules and lifecycle definitions.

## State

### vNext-only (1.0.0, #138)

vNext is the only structure. The pre-vNext (v0.4) topology and its compatibility paths are removed: Bulldozer and Piledriver are runner-only (`mainAgent: false`), the Bulldozer/Piledriver Stop review gate (`hooks/primary-review-gate.py`) and the `ntg-run` role-attribution wrapper are gone, and the `docs/specs/vnext/` pre-activation mirror is deleted. Excavator remains the only natively selectable primary with its Zen completion gate. `docs/specs/plan-review-contract.md` (native Piledriver plan-readiness review) is removed with the flow it defined.

### vNext activation (44G, #134)

vNext is the runtime. Released `agents/` and `rules/` carry the vNext contracts; the runner loads role bodies from `agents/` and `ntg-vnext` is the multi-milestone entry. Steamroller is runner-only; Bulldozer and Piledriver are invoked by the runner with exact models and bounded packets. Activation evidence: `.omo/evidence/134-vnext-activation.md`.

Open: OQ-6 (`inheritCustomizations` semantics) is a PO decision narrowed to Excavator (#137); Bulldozer and Piledriver no longer carry the field. Excavator recovery reconnection and Instinct remain post-44G.

### Guards and boundaries in force

- Zen has verification-only `run_command` plus a marker-scoped `PreToolUse` guard (`NTG_ZEN_VERIFY=1`) for common intentional shell mutation paths.
- Excavator has a marker-scoped shell guard (`NTG_EXCAVATOR=1`) that preserves ordinary sudo while rejecting stdin-password privilege acquisition, alternate local privilege paths, shell-history credential mining, and broad system upgrades.
- Excavator invokes Zen only as its independent final completion reviewer. A plugin `Stop` hook blocks normal Excavator completion when Zen review is missing, pending, NO-GO, or stale after a later direct write/marked Excavator shell call. Verified BLOCKED and abnormal runtime termination remain allowed so the gate does not manufacture a completion loop.
- Deterministic coverage: `tests/test_excavator_shell_guard.py`, `tests/test_excavator_review_gate.py`, `tests/test_zen_shell_guard.py`, `tests/test_gate_panel.py`.
- The Zen and Excavator shell guards are behavioral backstops, not complete shell or privilege sandboxes. AGY runtimes do not expose reliable custom-agent identity in `PreToolUse` payloads; the Excavator review gate scopes itself from structured transcript identity/system-prompt evidence and the `NTG_EXCAVATOR=1` shell marker.

### Live validation status

Validated on AGY 1.3.3 (evidence: `.omo/evidence/113-live-probe-results.md`, `.omo/evidence/56-activation-readiness.md`, `.omo/evidence/134-live-probe/`, `.omo/evidence/138-vnext-only-results.md`):

- runner end-to-end: multi-milestone dependency-order execution with an independent Zen GO per milestone, fresh-context resume after an observed interrupted invocation, material replan with `plan_version` increment and fresh current-version review, and a live Zen NO-GO -> repair -> fresh GO cycle
- specialist delegation: Bulldozer -> Jaguar / Puma / Bobcat and the nested Bobcat -> Strix Halo (`ACCEPT`) gate, observed with transcript-level `invoke_subagent` dispatches
- runner exact-model resolution: piledriver `gemini-3.1-pro-high`, bulldozer/steamroller `gemini-3.8-flash-high`

Pending live revalidation:

- Excavator's live edit -> Zen GO -> READY and NO-GO -> non-READY termination were observed on AGY 1.3.1 (`.omo/evidence/agy-1-3-1/side-probe.md`). A full NO-GO repair loop and post-GO-write re-review still need live revalidation; deterministic review-gate tests cover these conditions.
- `multi_replace_file_content` is declared by no current agent and was not observed live (no action needed unless a future agent declares it)
- `manage_task` is present on the live tool surface but declared by no agent

Naming:

- Bobcat advisor codename finalized as **Strix Halo** (`strix-halo`)
