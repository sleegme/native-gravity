# Status

[한국어](ko/status.md) · [Usage](usage.md) · [Internals](internals.md)

- **Native Gravity**: 1.1.0
- **Status**: alpha
- **Compatibility**:
  - AGY 1.3.3 — validated (runner live probes: #134, #138; delegation probes: #113/#56; Instinct NEEDS_ALT live call: #20)

See [Versioning Policy](versioning.md) for versioning rules and lifecycle definitions.

## What works today

- Run a plan file milestone by milestone in dependency order; a milestone counts
  as done only after an independent review accepts it (GO).
- A rejected milestone (NO-GO) stays unfinished until a repaired result earns a
  fresh GO.
- Revise the plan with `replan`; retained milestones are reviewed again under the
  new plan version.
- Resume from the saved ledger in a fresh process, without the earlier
  conversation.
- Recover after a crash on Linux.
- Ask for planning advice (`plan`) or a different framing of a repeated failure
  (`alt`); advice is recorded but never adopted automatically.
- View the milestone graph read-only (`scripts/dag-view.mjs`).

How to use each of these is in [Usage](usage.md).

## Limits and not yet available

- **Alpha:** validated on one host with AGY 1.3.3; this is not a broad
  reliability or performance claim.
- **You write the plan file.** Turning a natural-language goal directly into an
  adopted plan is not implemented.
- **Model usage:** `run`, `plan` and `alt` call real models.
- **Crash recovery is Linux-only** and refuses when it cannot verify safe
  termination. One session owns a ledger at a time.
- **Not published to npm:** install from the repository; no global command is
  created by the plugin install.
- Exact-model selection for the independent reviewer is an open comparison
  question, not a planned feature. [Model profiles](model-profiles/README.md)
  are provisional research, not deployed routing.

## Live validation

Validated on AGY 1.3.3 (evidence: `.omo/evidence/113-live-probe-results.md`, `.omo/evidence/56-activation-readiness.md`, `.omo/evidence/134-live-probe/`, `.omo/evidence/138-vnext-only-results.md`; activation receipts: [`134-vnext-activation.md`](../.omo/evidence/134-vnext-activation.md)):

- runner end-to-end: multi-milestone dependency-order execution with an independent Zen GO per milestone, fresh-context resume after an observed interrupted invocation, material replan with `plan_version` increment and fresh current-version review, and a live Zen NO-GO -> repair -> fresh GO cycle (a deliberately tampered artifact was rejected and the repaired candidate needed a fresh GO)
- specialist delegation: Bulldozer -> Jaguar / Puma / Bobcat and the nested Bobcat -> Strix Halo (`ACCEPT`) gate, observed with transcript-level `invoke_subagent` dispatches
- Bulldozer -> Excavator worker: one live `ntg-vnext run` milestone delegated a bounded diagnose+repair of a broken fixture in `~/.cache` to Excavator (`invoke_subagent` `TypeName: excavator` observed in the Bulldozer transcript; Excavator returned its worker result without invoking Zen), and Steamroller's matching Zen GO promoted the milestone to global completion; evidence: `.omo/evidence/20-instinct-results.md`
- runner exact-model resolution: piledriver `gemini-3.1-pro-high`, bulldozer/steamroller `gemini-3.8-flash-high`, instinct `claude-sonnet-5-5-high` (`claude-opus-5-5-high` only on explicit escalation)
- Instinct NEEDS_ALT: one live `ntg-vnext alt` call on Sonnet against a small ledger, returning the advisory JSON with `adopted: false`; evidence: `.omo/evidence/20-instinct-results.md`
- native Excavator (pre-demotion, #137): actual interactive NO-GO -> repair -> fresh GO, followed in the same session by a direct write after GO -> fresh independent review -> READY. Actual terminal Stop events allowed completion after fresh GO. Stale-verdict rejection was separately replayed against the captured post-write transcript; it was not a live premature-READY attempt. That completion path is removed with the native primary. Evidence: `.omo/evidence/137-excavator-validation.md`.

Deterministic guard coverage: `tests/test_excavator_shell_guard.py`, `tests/test_zen_shell_guard.py`. Guard behavior and its limits are described in [Internals](internals.md#behavioral-guards).

## Not established

Pending live revalidation:

- `multi_replace_file_content` is declared by no current agent and was not observed live (no action needed unless a future agent declares it)
- `manage_task` is present on the live tool surface but declared by no agent

## Release and migration history

Maintainer history, kept for traceability. None of it is a mode users choose;
current role mechanics are in [Internals](internals.md).

### 1.1.0 — Excavator demotion to Bulldozer worker

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
`inheritCustomizations` field. OQ-3 is resolved by this placement.

### 1.1.0 — Instinct (#20) and Bulldozer relay rule (#136)

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
strict packet parser is unchanged: it accepts only one unambiguous JSON object
and rejects malformed, multiple or ambiguous-narration output.

### 1.0.0 — single runtime structure (#138)

The current runtime (called vNext in implementation records) became the only
structure. The pre-vNext (v0.4) topology and its compatibility paths are
removed: Bulldozer and Piledriver are runner-only (`mainAgent: false`), the
Bulldozer/Piledriver Stop review gate (`hooks/primary-review-gate.py`) and the
`ntg-run` role-attribution wrapper are gone, and the `docs/specs/vnext/`
pre-activation mirror is deleted. At 1.0.0 Excavator was still the only
natively selectable primary with its Zen completion gate; the 1.1.0 Excavator
demotion supersedes that. `docs/specs/plan-review-contract.md` (native
Piledriver plan-readiness review) is removed with the flow it defined. These
deleted paths are historical and intentionally not linked.

### Activation (44G, #134)

The vNext runtime was activated. Released `agents/` and `rules/` carry the
vNext contracts; the runner loads role bodies from `agents/` and `ntg-vnext`
is the multi-milestone entry. Steamroller is runner-only; Bulldozer and
Piledriver are invoked by the runner with exact models and bounded packets.
Activation evidence: `.omo/evidence/134-vnext-activation.md`.

OQ-6 (#137) kept explicit `inheritCustomizations: true` on the then-native
Excavator primary to preserve workspace instructions. The controlled AGY 1.3.3
probe propagated a workspace rule for true and omission, but not false.
Inherited context is not an authority grant. The Excavator demotion supersedes
that decision: no natively selectable primary remains and the worker carries
no `inheritCustomizations` field. Bulldozer and Piledriver remain runner-only
and do not carry the field. Instinct is implemented (#20, see above).

Naming: the Bobcat advisor codename is finalized as **Strix Halo** (`strix-halo`).
