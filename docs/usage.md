# Usage

> - **Native Gravity**: 1.1.0
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

vNext is the runtime. For multi-milestone work, write a plan (goal, constraints, `plan_version`, milestones with `acceptance_criteria`, `bounded_scope`, `non_goals`, `dependencies`) and drive it with the runner. A minimal valid plan example is in the [README quick start](../README.md#quick-start).

```bash
ntg-vnext init    --ledger .ntg/ledger.json --plan plan.json
ntg-vnext plan    --ledger .ntg/ledger.json --task "..."   # Piledriver advice; never auto-adopted
ntg-vnext run     --ledger .ntg/ledger.json [--milestone ID] [--all]
ntg-vnext replan  --ledger .ntg/ledger.json --plan plan-v2.json
ntg-vnext recover --ledger .ntg/ledger.json --evidence "observed interruption"
ntg-vnext alt     --ledger .ntg/ledger.json --task "..." [--milestone ID] [--escalate]   # Instinct advice; never auto-adopted
ntg-vnext status  --ledger .ntg/ledger.json
```

Each call reloads the ledger, so a fresh context resumes where the ledger says. `run` executes the next eligible milestone through Bulldozer, obtains an independent native Zen verdict, and promotes only on a matching GO; `--all` continues in dependency order. Exit code 2 means NO-GO, BLOCKED or NEEDS_DEEP (see the printed `results`). Global completion is declared only when every current-plan milestone has a current GO. `NTG_ZEN_MODEL` optionally pins Zen's model.

`alt` requests an Instinct alternate-framing advisory (NEEDS_ALT) and prints its advisory JSON with `adopted: false`. The advice is recorded as advisory evidence only — it never adopts a plan or changes completion state. `status` reports per-failure-class `needs_alt` recommendations: NEEDS_ALT is recommended when the same failure class has at least 3 attempts without new evidence. `--escalate` is the only path to the Opus tier; without it Instinct runs on Sonnet.

## Excavator worker

Excavator is a Bulldozer worker for the hard case: "this is broken and nobody knows why." Bulldozer delegates a bounded diagnose -> reproduce -> root-cause -> repair -> verify loop to Excavator when the milestone carries a difficult broken-behavior problem; ordinary implementation stays with Bobcat. Excavator edits directly inside its delegated scope, has no nested delegation, and never invokes Zen. It returns a worker result (ROOT_CAUSE `CONFIRMED | LIKELY | SPECULATIVE`, CHANGES, VERIFICATION_EVIDENCE, ROLLBACK, RESIDUAL_RISK, STATUS `READY | BLOCKED`) to Bulldozer; STATUS is a local worker signal, not milestone or project completion.

No natively selectable primary remains; `ntg-vnext` is the entry for project work. Bulldozer, Piledriver and Instinct are runner-only roles. Multi-milestone work, durable ledger state, replanning and global completion belong to `ntg-vnext`; Piledriver advice is requested with `ntg-vnext plan`, Instinct advice with `ntg-vnext alt`.

## Bobcat vs Puma vs Excavator

Use Bobcat for ordinary behavior-bearing implementation. Bulldozer chooses `ADVISOR_GATE: REQUIRED | NONE`.

When REQUIRED, Bobcat consults **Strix Halo** (`strix-halo`) as its read-only local advice/CHECK gate.

Use Puma for clearly small, explicit, low-risk work such as straightforward writing, formatting, presentation-only edits, or mechanical text changes. Puma has no Advisor gate and no nested delegation.

Use Excavator for difficult broken-behavior diagnosis and repair inside one milestone — it investigates, reproduces, fixes the root cause and verifies the result itself.

## Alpha validation

This checklist gates a release (see `AGENTS.md`). The runner paths (items 1-4) passed live on AGY 1.3.3 — see `.omo/evidence/138-vnext-only-results.md`; items 5-8 are enforced by deterministic tests with prior live observation. Re-run the whole checklist after an AGY runtime change:

1. the runner drives Steamroller -> Piledriver -> Bulldozer -> Zen end to end, promoting a milestone only on an observed matching Zen GO;
2. multi-milestone runs promote milestones in dependency order, and a material replan increments `plan_version` and revalidates retained milestones;
3. a Zen NO-GO leaves the milestone incomplete and a repaired candidate needs a fresh GO;
4. a fresh-context resume continues from the ledger, not conversation;
5. Bobcat invokes `strix-halo` and no other subagent (negative delegation case);
6. Bulldozer delegates a bounded diagnose+repair to Excavator, which edits, invokes no subagents (never Zen) and returns a worker result, while Bulldozer delegation validation accepts Excavator and rejects non-worker roles;
7. Zen runs verification commands with the required `NTG_ZEN_VERIFY=1` marker while common intentional source-mutation shell attempts are denied;
8. Excavator-marked shell calls allow ordinary sudo diagnostics while rejecting privilege-drift and full-upgrade paths.

If a milestone ends `BLOCKED` on an open decision, take it to Piledriver via `ntg-vnext plan`. Excavator is a Bulldozer worker: its `STATUS` is a local signal inside the milestone, and only Steamroller promotes or completes.

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

See [Internals](internals.md) for ledger locking/recovery, role ownership detail, the Google AI Studio A/B lane, and the compatibility validation history.
