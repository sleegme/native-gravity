# Status

- **Native Gravity**: 1.1.0
- **Status**: alpha
- **Compatibility**:
  - AGY 1.3.3 — validated (vNext runner live probes: #134, #138; delegation probes: #113/#56; Instinct NEEDS_ALT live call: #20)

See [Versioning Policy](versioning.md) for versioning rules and lifecycle definitions.

## State

### Excavator demotion to Bulldozer worker (this release)

Excavator is no longer a natively selectable primary. It is a specialist
worker that only Bulldozer invokes, for difficult diagnose -> reproduce ->
root-cause -> repair -> verify work inside one milestone (owner decision).
No natively selectable primary remains; the entry is `ntg-vnext`. Excavator
returns a worker result (ROOT_CAUSE `CONFIRMED | LIKELY | SPECULATIVE`,
CHANGES, VERIFICATION_EVIDENCE, ROLLBACK, RESIDUAL_RISK, STATUS
`READY | BLOCKED`) to Bulldozer; STATUS is a local signal like other workers'.
It keeps its investigation depth, root-cause discipline and
`NTG_EXCAVATOR=1` shell guard, has no nested delegation and never invokes
Zen — the native-primary Zen completion gate (`hooks/excavator-review-gate.py`
Stop hook) is removed with the primary, along with its display-only
`scripts/gate_panel.py` (issue #112 history stays in `.omo/evidence`).
Bulldozer delegation validation accepts Excavator as a milestone worker and
rejects non-worker roles. #137's `inheritCustomizations: true` decision
applied to the native primary and is superseded; the worker carries no
`inheritCustomizations` field.

### Instinct (#20) and Bulldozer relay rule (#136)

Instinct is the heterogeneous alternate-framing advisory, runner-only and
advisory: it returns one bare JSON object (current framing, why it may be
wrong, materially different hypotheses with evidence basis and a
discriminating test, recommendation, unknowns) and has no implementation,
orchestration, ledger or completion authority. `ntg-vnext alt` invokes it with
a bounded NEEDS_ALT packet (failure class/signature, current hypothesis,
attempt count, evidence, tier-B replan context) and records the result as
advisory evidence (`adopted: false`) only. Exact-model resolution targets
Claude Sonnet 5.5 / High; Claude Opus 5.5 / High is selected only on explicit
`--escalate`, with the usual fail-closed slug resolution (OQ-4 resolved).
`status` recommends NEEDS_ALT per failure class when the same class has at
least 3 attempts without new evidence (contract §2.9); recommendations never
auto-run paid calls.

#136: Bulldozer's MACHINE-INVOCATION MODE now requires specialist/worker
reports to be relayed only inside packet fields (`verification_evidence`,
`delegations` findings), never as text before or after the JSON object; the
strict packet parser is unchanged: it accepts only one unambiguous JSON object and rejects malformed, multiple or ambiguous-narration output.

### vNext-only (1.0.0, #138)

vNext is the only structure. The pre-vNext (v0.4) topology and its compatibility paths are removed: Bulldozer and Piledriver are runner-only (`mainAgent: false`), the Bulldozer/Piledriver Stop review gate (`hooks/primary-review-gate.py`) and the `ntg-run` role-attribution wrapper are gone, and the `docs/specs/vnext/` pre-activation mirror is deleted. At 1.0.0 Excavator was still the only natively selectable primary with its Zen completion gate; the Excavator demotion (this release) supersedes that. `docs/specs/plan-review-contract.md` (native Piledriver plan-readiness review) is removed with the flow it defined.

### vNext activation (44G, #134)

vNext is the runtime. Released `agents/` and `rules/` carry the vNext contracts; the runner loads role bodies from `agents/` and `ntg-vnext` is the multi-milestone entry. Steamroller is runner-only; Bulldozer and Piledriver are invoked by the runner with exact models and bounded packets. Activation evidence: `.omo/evidence/134-vnext-activation.md`.

OQ-6 (#137) kept explicit `inheritCustomizations: true` on the then-native Excavator primary to preserve workspace instructions. The controlled AGY 1.3.3 probe propagated a workspace rule for true and omission, but not false. The Excavator demotion supersedes that decision: no natively selectable primary remains and the worker carries no `inheritCustomizations` field. Bulldozer and Piledriver remain runner-only and do not carry the field. Instinct is implemented (#20, see above).

### Guards and boundaries in force

- Zen has verification-only `run_command` plus a marker-scoped `PreToolUse` guard (`NTG_ZEN_VERIFY=1`) for common intentional shell mutation paths.
- Excavator has a marker-scoped shell guard (`NTG_EXCAVATOR=1`) that preserves ordinary sudo while rejecting stdin-password privilege acquisition, alternate local privilege paths, shell-history credential mining, and broad system upgrades.
- Excavator has no nested delegation and never invokes Zen: it returns a worker result to Bulldozer, and milestone verification is Steamroller's Zen gate. The native-primary Zen completion gate (plugin `Stop` hook) is removed with the primary.
- Deterministic coverage: `tests/test_excavator_shell_guard.py`, `tests/test_zen_shell_guard.py`.
- The Zen and Excavator shell guards are behavioral backstops, not complete shell or privilege sandboxes. AGY runtimes do not expose reliable custom-agent identity in `PreToolUse` payloads; both guards scope from the explicit `NTG_ZEN_VERIFY=1` / `NTG_EXCAVATOR=1` shell markers.

### Live validation status

Validated on AGY 1.3.3 (evidence: `.omo/evidence/113-live-probe-results.md`, `.omo/evidence/56-activation-readiness.md`, `.omo/evidence/134-live-probe/`, `.omo/evidence/138-vnext-only-results.md`):

- runner end-to-end: multi-milestone dependency-order execution with an independent Zen GO per milestone, fresh-context resume after an observed interrupted invocation, material replan with `plan_version` increment and fresh current-version review, and a live Zen NO-GO -> repair -> fresh GO cycle
- specialist delegation: Bulldozer -> Jaguar / Puma / Bobcat and the nested Bobcat -> Strix Halo (`ACCEPT`) gate, observed with transcript-level `invoke_subagent` dispatches
- Bulldozer -> Excavator worker: one live `ntg-vnext run` milestone delegated a bounded diagnose+repair of a broken fixture in `~/.cache` to Excavator (`invoke_subagent` `TypeName: excavator` observed in the Bulldozer transcript; Excavator returned its worker result without invoking Zen), and Steamroller's matching Zen GO promoted the milestone to global completion; evidence: `.omo/evidence/20-instinct-results.md`
- runner exact-model resolution: piledriver `gemini-3.1-pro-high`, bulldozer/steamroller `gemini-3.8-flash-high`, instinct `claude-sonnet-5-5-high` (`claude-opus-5-5-high` only on explicit escalation)
- Instinct NEEDS_ALT: one live `ntg-vnext alt` call on Sonnet against a small ledger, returning the advisory JSON with `adopted: false`; evidence: `.omo/evidence/20-instinct-results.md`
- native Excavator (pre-demotion, #137): actual interactive NO-GO -> repair -> fresh GO, followed in the same session by a direct write after GO -> fresh independent review -> READY. Actual terminal Stop events allowed completion after fresh GO. Stale-verdict rejection was separately replayed against the captured post-write transcript; it was not a live premature-READY attempt. That completion path is removed with the native primary. Evidence: `.omo/evidence/137-excavator-validation.md`.

Pending live revalidation:

- `multi_replace_file_content` is declared by no current agent and was not observed live (no action needed unless a future agent declares it)
- `manage_task` is present on the live tool surface but declared by no agent

Naming:

- Bobcat advisor codename finalized as **Strix Halo** (`strix-halo`)
