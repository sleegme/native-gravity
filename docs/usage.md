# Usage

> v0.4 alpha

Install or reinstall the plugin from the checked-out repository:

```bash
agy plugin uninstall native-gravity
agy plugin install .
```

Use a clean reinstall when switching from v0.3.x so removed legacy agent and hook files cannot remain staged.

## Choose a primary mode

### Bulldozer

Use for normal multi-step work where you want orchestration and specialist routing.

Expected routing:

- discovery -> Jaguar
- quick/writing -> Puma
- implementation -> Bobcat
- difficult decision -> Steamroller
- independent final review -> Zen

### Piledriver

Use when you want a plan before execution. It should inspect enough current state to ground the plan, but must not implement project source.

Expected output: GOAL, ACCEPTANCE, TASK_GRAPH, OWNERSHIP_SUGGESTION, RISKS_AND_UNCERTAINTY, RECOMMENDED_VERIFICATION, PLAN_STATUS.

### Excavator

Use when the task is essentially "this is broken; dig until you find the cause and fix it." Excavator is allowed to edit directly and should complete a bounded diagnose -> repair -> verify loop.

## Bobcat vs Puma

Use Bobcat for ordinary behavior-bearing implementation. Bulldozer chooses `ADVISOR_GATE: REQUIRED | NONE`.

Use Puma for clearly small, explicit, low-risk work such as straightforward writing, formatting, presentation-only edits, or mechanical text changes. Puma has no Advisor gate and no nested delegation.

## Alpha validation

This checklist passed on AGY 1.1.21. Re-run it after an AGY runtime change:

Before trusting v0.4 for real work, confirm the current AGY runtime can:

1. select all three primary agents;
2. let Bulldozer invoke Bobcat/Puma/Jaguar/Steamroller/Zen;
3. let Bobcat invoke gravity-advisor — and observe that Bobcat attempts no other subagent (negative delegation case);
4. let Piledriver stop at plan status instead of editing project source;
5. let Excavator edit project source;
6. return actual subagent/Zen results instead of only launch acknowledgements.

If Excavator ends a task as `BLOCKED`, start a separate Bulldozer task for the open decision so Bulldozer can consult Steamroller. Do not treat Excavator as a Bulldozer child.
