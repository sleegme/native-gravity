# Usage

> - **Native Gravity**: 0.4.0
> - **Status**: alpha
> - **Compatibility**:
>   - AGY 1.1.21 — validated
>   - AGY 1.1.24 — validated
>   - AGY 1.2.12 — validated w/ regression ([#64](https://github.com/sleegme/native-gravity/issues/64))

Install or reinstall the plugin from the checked-out repository:

```bash
agy plugin uninstall native-gravity
agy plugin install .
```

Use a clean reinstall when switching from v0.3.x so removed legacy agent and hook files cannot remain staged.

## `ntg-vnext` (default vNext runner)

vNext is the default runtime. For multi-milestone work, write a plan (goal, constraints, `plan_version`, milestones with `acceptance_criteria`, `bounded_scope`, `non_goals`, `dependencies`) and drive it with the runner:

```bash
ntg-vnext init    --ledger .ntg/ledger.json --plan plan.json
ntg-vnext plan    --ledger .ntg/ledger.json --task "..."   # Piledriver advice; never auto-adopted
ntg-vnext run     --ledger .ntg/ledger.json [--milestone ID] [--all]
ntg-vnext replan  --ledger .ntg/ledger.json --plan plan-v2.json
ntg-vnext recover --ledger .ntg/ledger.json --evidence "observed interruption"
ntg-vnext status  --ledger .ntg/ledger.json
```

Each call reloads the ledger, so a fresh context resumes where the ledger says. `run` executes the next eligible milestone through Bulldozer, obtains an independent native Zen verdict, and promotes only on a matching GO; `--all` continues in dependency order. Exit code 2 means NO-GO, BLOCKED or NEEDS_DEEP (see the printed `results`). Global completion is declared only when every current-plan milestone has a current GO. `NTG_ZEN_MODEL` optionally pins Zen's model.

## Choose a native primary

### Bulldozer

Use for one bounded request where you want specialist routing without a ledger. Bulldozer delegates and ends with `READY` only after an observed Zen GO.

Expected routing:

- discovery -> Jaguar
- quick/writing -> Puma
- implementation -> Bobcat
- independent final review -> Zen

Multi-milestone work, replanning and global completion belong to `ntg-vnext`.

### Piledriver

Use when you want a plan before execution. It should inspect enough current state to ground the plan, but must not implement project source. Under `ntg-vnext` the same role returns advisory JSON for Steamroller.

Expected output: GOAL, ACCEPTANCE, TASK_GRAPH, OWNERSHIP_SUGGESTION, RISKS_AND_UNCERTAINTY, RECOMMENDED_VERIFICATION, PLAN_STATUS.

### Excavator

Use when the task is essentially "this is broken; dig until you find the cause and fix it." Excavator is allowed to edit directly and should complete a bounded diagnose -> repair -> verify loop.

## Bobcat vs Puma

Use Bobcat for ordinary behavior-bearing implementation. Bulldozer chooses `ADVISOR_GATE: REQUIRED | NONE`.

When REQUIRED, Bobcat consults **Strix Halo** (`strix-halo`) as its read-only local advice/CHECK gate.

Use Puma for clearly small, explicit, low-risk work such as straightforward writing, formatting, presentation-only edits, or mechanical text changes. Puma has no Advisor gate and no nested delegation.

## Alpha validation

This checklist passed on AGY 1.1.21 and AGY 1.1.24. Re-run it after an AGY runtime change:

Before trusting 0.4.0 for real work, confirm the current AGY runtime can:

1. select all three native primary agents;
2. let Bulldozer invoke Bobcat/Puma/Jaguar/Zen;
3. let Bobcat invoke strix-halo — and observe that Bobcat attempts no other subagent (negative delegation case);
4. let Piledriver stop at plan status instead of editing project source;
5. let Excavator edit project source;
6. return actual subagent/Zen results instead of only launch acknowledgements.

If Excavator ends a task as `BLOCKED`, take the open decision to Piledriver (natively or via `ntg-vnext plan`). Do not treat Excavator as a Bulldozer child.
## `ntg-run` helper (AGY 1.2.x role attribution)

On AGY 1.2.x, `agy --agent` no longer writes the role body into the transcript (issue #64), so the primary review gate cannot see which primary role ran. `ntg-run` is a thin wrapper that prepends `NTG_ROLE: <role>` to the first prompt argument — the marker convention established in PR #71. The gate reads that marker and attributes the session correctly; nothing else changes about the run.

```bash
ntg-run --agent bulldozer -p "implement the thing"
ntg-run --agent piledriver -p "plan this" -- --agy-extra-flag value
```

Marker is only injected for the gated roles (`bulldozer`, `piledriver`) — the roles the gate enforces — and only when the prompt does not already carry an `NTG_ROLE:` line, so the helper stays out of the way of agents the gate does not enforce and never double-marks.

## `gate_panel.py` (issue #112 gate-status panel)

`scripts/gate_panel.py` renders the NTG gate-status panel: for each transcript it shows which gate is armed (primary = bulldozer/piledriver, excavator, or none), the latest observed Zen verdict, the decision the Stop hook would return, the constraint behind it, and the evidence source. It reads the same transcript records the Stop hooks enforce and replays their logic; it owns and mutates no state.

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
