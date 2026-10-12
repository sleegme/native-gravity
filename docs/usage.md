# Usage

> - **Native Gravity**: 1.0.0
> - **Status**: alpha
> - **Compatibility**:
>   - AGY 1.3.3 — validated

Install or reinstall the plugin from the checked-out repository:

```bash
agy plugin uninstall native-gravity
agy plugin install .
```

Use a clean reinstall when upgrading so removed legacy agent and hook files cannot remain staged.

## `ntg-vnext` runner

vNext is the runtime. For multi-milestone work, write a plan (goal, constraints, `plan_version`, milestones with `acceptance_criteria`, `bounded_scope`, `non_goals`, `dependencies`) and drive it with the runner:

```bash
ntg-vnext init    --ledger .ntg/ledger.json --plan plan.json
ntg-vnext plan    --ledger .ntg/ledger.json --task "..."   # Piledriver advice; never auto-adopted
ntg-vnext run     --ledger .ntg/ledger.json [--milestone ID] [--all]
ntg-vnext replan  --ledger .ntg/ledger.json --plan plan-v2.json
ntg-vnext recover --ledger .ntg/ledger.json --evidence "observed interruption"
ntg-vnext status  --ledger .ntg/ledger.json
```

Each call reloads the ledger, so a fresh context resumes where the ledger says. `run` executes the next eligible milestone through Bulldozer, obtains an independent native Zen verdict, and promotes only on a matching GO; `--all` continues in dependency order. Exit code 2 means NO-GO, BLOCKED or NEEDS_DEEP (see the printed `results`). Global completion is declared only when every current-plan milestone has a current GO. `NTG_ZEN_MODEL` optionally pins Zen's model.

## Natively selectable primary

### Excavator

Use when the task is essentially "this is broken; dig until you find the cause and fix it." Excavator is allowed to edit directly and should complete a bounded diagnose -> repair -> verify loop. It ends with `READY` only after an observed Zen `VERDICT: GO` for the current artifact.

Bulldozer and Piledriver are runner-only roles. Multi-milestone work, durable ledger state, replanning and global completion belong to `ntg-vnext`; Piledriver advice is requested with `ntg-vnext plan`.

## Bobcat vs Puma

Use Bobcat for ordinary behavior-bearing implementation. Bulldozer chooses `ADVISOR_GATE: REQUIRED | NONE`.

When REQUIRED, Bobcat consults **Strix Halo** (`strix-halo`) as its read-only local advice/CHECK gate.

Use Puma for clearly small, explicit, low-risk work such as straightforward writing, formatting, presentation-only edits, or mechanical text changes. Puma has no Advisor gate and no nested delegation.

## Alpha validation

This checklist gates a release (see `AGENTS.md`). The runner paths (items 1-4) passed live on AGY 1.3.3 — see `.omo/evidence/138-vnext-only-results.md`; items 5-8 are enforced by deterministic tests with prior live observation. Re-run the whole checklist after an AGY runtime change:

1. the runner drives Steamroller -> Piledriver -> Bulldozer -> Zen end to end, promoting a milestone only on an observed matching Zen GO;
2. multi-milestone runs promote milestones in dependency order, and a material replan increments `plan_version` and revalidates retained milestones;
3. a Zen NO-GO leaves the milestone incomplete and a repaired candidate needs a fresh GO;
4. a fresh-context resume continues from the ledger, not conversation;
5. Bobcat invokes `strix-halo` and no other subagent (negative delegation case);
6. Excavator edits project source and cannot complete `READY` without the current Zen verdict;
7. Zen runs verification commands with the required `NTG_ZEN_VERIFY=1` marker while common intentional source-mutation shell attempts are denied;
8. Excavator-marked shell calls allow ordinary sudo diagnostics while rejecting privilege-drift and full-upgrade paths.

If Excavator ends a task as `BLOCKED`, take the open decision to Piledriver via `ntg-vnext plan`. Do not treat Excavator as a Bulldozer child.

## `gate_panel.py` (issue #112 gate-status panel)

`scripts/gate_panel.py` renders the NTG gate-status panel: for each transcript it shows which gate is armed (excavator, or none), the latest observed Zen verdict, the decision the Stop hook would return, the constraint behind it, and the evidence source. It reads the same transcript records the Stop hook enforces and replays its logic; it owns and mutates no state.

```bash
python3 scripts/gate_panel.py --transcript /path/to/transcript.jsonl
python3 scripts/gate_panel.py --event stop-event.json
python3 scripts/gate_panel.py --transcript a.jsonl --json
```

The layout is a fixed-width single-line-per-gate table so it fits horizontal-only panes; `--json` gives the same state to programmatic embedders.

Limit (per the #112 decision's escape clause): the AGY plugin surface offers agents / hooks / commands / skills / mcpServers but no Settings-tabs host for a plugin panel, and no such surface exists in this repository. This module is therefore the smallest useful version — a renderer a Settings tab (or any pane) can host — not a plugin-integrated Settings tab. When a host surface for plugin panels lands, it can consume this output directly.

## `ntg-dag` (ledger milestone graph)

`ntg-dag` renders the milestone dependency graph from a vNext ledger snapshot as Unicode boxes. It is read-only and does not modify the ledger.

```bash
node scripts/dag-view.mjs --ledger tests/fixtures/dag-view/all-states.ledger.json --width 80 --no-color
```

- `--ledger PATH`: ledger JSON path (or `NTG_LEDGER` env var)
- `--watch`: redraw in place when the ledger file changes (use in a herdr/tmux side pane for a live view)
- `--width N`: fixed width (default: TTY columns)
- `--no-color`: disable ANSI colors

After installation the `ntg-dag` bin also invokes the same script.
