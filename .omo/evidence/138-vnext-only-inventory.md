# #138 vnext-only — v0.4 remnant inventory (Milestone 1)

Base: main @ 0bbea4a (PR #135). Lane worktree: `/home/sleeg/work/native-gravity-vnext-only`, branch `feat/138-vnext-only`.
PO direction: vNext is the only structure; do not keep the v0.4 structure or compatibility paths.

## Remove

| Path | What it does | Reason |
|---|---|---|
| `docs/specs/vnext/**` (23 files) | 44D-44F isolated mirror of AGENTS/agents/rules/docs/hooks/tests | Stale pre-activation draft (e.g. steamroller "NON-ACTIVATED DRAFT", `mainAgent: true`). All 23 differ from the real paths, and the real paths are the activated copies. Nothing needs folding back. |
| `docs/specs/pre-vnext-v0.4-behavior-baseline.md` | Frozen v0.4 behavior baseline | Compat reference for a structure we no longer keep. |
| `docs/model-policy-v0.3.3.md` | v0.3.3 model policy | Pre-v0.4 history. |
| `docs/review/issue56-09preview-validation.md`, `docs/review/issue59-12x-validation.md` | v0.4 native-primary validation reports | Validate removed native-primary paths. Git history keeps them. |
| `hooks/primary-review-gate.py` + its `hooks.json` entry + `tests/test_primary_review_gate.py` | Stop gate for natively selected Bulldozer/Piledriver | Exists only for native Bulldozer/Piledriver. Under the runner, the Zen gate is enforced by the spine/ledger (an observed matching GO). |
| `scripts/ntg-run.mjs`, `bin.ntg-run`, `files` entry, `tests/test_ntg_run.mjs` | Injects the NTG_ROLE marker for the gated native roles and holds the ledger lock | Only serves the primary-review-gate. `ntg-vnext` supersedes it. `ledger-lock.mjs` stays because the spine uses it. |
| `agents/bulldozer.md` `## INTERACTIVE MODE` + "native selection remains" lines; frontmatter becomes `mainAgent: false` | v0.4 native primary orchestrator mode | PO: no native orchestration mode. Bulldozer becomes runner-only. |
| `agents/piledriver.md` `## INTERACTIVE MODE` + same lines; `mainAgent: false` | Plan-first packet gated by Zen plan review | Same reason. Piledriver becomes advisory-only under Steamroller. |
| `rules/orchestration.md` `## Interactive primaries` (Bulldozer/Piledriver parts) | Native-primary routing | Same reason. |
| `AGENTS.md` "Natively selectable primaries" tree, validation items 5 and 7, v0.4 role/model paragraph, baseline pointer | v0.4 topology text | Rewrite as vNext-only. |
| Role-body pointers to `pre-vnext-v0.4-behavior-baseline.md` (bulldozer/piledriver/steamroller) | Reference reading | The target file is deleted. |

## Rewrite

| Path | Change |
|---|---|
| `README.md`, `docs/usage.md`, `docs/status.md`, `docs/architecture.md`, `docs/ko/{README,usage,status,architecture}.md` | Drop "Why v0.4 changes direction", the `ntg-run` sections, "v0.4 history", the baseline links and native Bulldozer/Piledriver usage. Fix the stale "Native Gravity: 0.4.0" header to the new version. |
| `docs/specs/vnext-architecture-contract.md` | Remove the "frozen baseline" header, the §7.1 conditional-supersede table and the "non-activated / before 44G" wording. Mark the PRESERVE sections as vNext invariants, without v0.4 provenance. |
| `docs/versioning.md` | Drop the v0.4 role-attribution (#64 / NTG_ROLE) section that served the primary-review-gate. Add a matrix row for the new version. |
| `docs/specs/plan-review-contract.md` | Re-scope to Zen's plan review of Piledriver advice under Steamroller, or remove it if it only defines the native PLAN READY flow. Decided while implementing; reported in the PR. |
| `VERSION` / `package.json` version | Breaking change, see Q1. |

## Keep

- `agents/{steamroller,zen,jaguar,puma,bobcat,strix-halo}.md`, plus the MACHINE-INVOCATION parts of bulldozer and piledriver: these are the vNext spine and its specialists.
- `hooks/zen-shell-guard.py`: the Zen verification boundary that vNext relies on.
- `hooks/excavator-shell-guard.py`, `hooks/excavator-review-gate.py`: Excavator's Zen completion gate (see Q2).
- `scripts/{ntg-vnext,spine,runner,ledger,ledger-lock,telemetry,dag-view,gate_panel.py,npm-install}.mjs` and their tests: the vNext runtime and its tooling. The panel's primary-gate rows go if they read primary-review-gate state.
- `scripts/studio-runner.mjs` + test: the AI Studio A/B lane over `runner.mjs`, which is not v0.4-specific.
- `scripts/agy-compat-check.mjs`: a host probe, not v0.4-specific.
- `docs/specs/44b-runner-spike.md`: the vNext runner spike history.
- `.omo/evidence/**`: historical evidence. Not rewritten.

## OQ-6 (#137)

If Bulldozer and Piledriver stop being natively selectable, `inheritCustomizations: true` on them becomes moot: the runner invokes them with exact models and bounded packets, not through native customization inheritance. I would drop it from both frontmatters. OQ-6 then applies only to Excavator (Q2).

## Questions for lead

- Q1 version: `docs/versioning.md` defines A as an architecture/paradigm shift, and its own example is "multi-primary peer topologies, 0.x -> 1.0.0". Removing the native primaries is that kind of shift. Recommend `1.0.0` (maturity alpha); the alternative is `0.5.0`.
- Q2 Excavator: the brief does not name it. Recommend keeping it natively selectable as an autonomous troubleshooter with its Zen gate, since it is not a v0.4 orchestration mode. That also keeps OQ-6 open for Excavator only.
