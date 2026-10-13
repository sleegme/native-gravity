# Usage

[한국어](ko/usage.md) · [Product and installation](../README.md#install) · [Current status](status.md)

Use NTG from the directory of the project you want to change. Your inputs are a
goal, a plan and criteria for checking the result; you do not select internal
agents. A **milestone** is one bounded step in that plan. The **ledger** is the
saved progress file, not a chat transcript.

## Set up your project

Install using the [README procedure](../README.md#install). Keep that terminal's
`NTG` variable, or set it to the absolute path of your Native Gravity checkout:

```bash
export NTG="$HOME/work/native-gravity"
```

That path is an example; substitute your actual checkout. Change into your
target project using your normal terminal workflow. All `.ntg/` and plan paths
below are relative to the target project. Quoting `"$NTG/..."` also handles a
checkout path containing spaces. A plugin install alone does not expose global
`ntg-vnext` or `ntg-dag` commands.

## First task

Suppose your project already has a service in `src/server.js` and a test suite
using `tests/server.test.js`. Save the following as `plan.json` in that project.
These are illustrative project paths, not files shipped by NTG; change them and
the criteria to match your service and its test framework.

```json
{
  "goal": "Add a health-check endpoint to the example service",
  "constraints": ["No new dependencies"],
  "plan_version": "v1",
  "milestones": [
    {
      "id": "m1",
      "title": "Implement the endpoint",
      "objective": "Serve GET /health with {\"status\": \"ok\"}",
      "acceptance_criteria": ["GET /health returns 200 and a status field"],
      "non_goals": ["Metrics or readiness probes"],
      "dependencies": [],
      "bounded_scope": ["src/server.js"]
    },
    {
      "id": "m2",
      "title": "Cover it with a test",
      "objective": "Add one automated test for GET /health",
      "acceptance_criteria": ["A test asserts the 200 response and status field"],
      "non_goals": ["Full coverage of other routes"],
      "dependencies": ["m1"],
      "bounded_scope": ["tests/server.test.js"]
    }
  ]
}
```

The parser requires a non-empty `goal`, a non-empty `milestones` array and a
unique non-empty `id` for each milestone. Dependencies must refer to existing
IDs and have no cycles. Supply `objective`, `acceptance_criteria`, `non_goals`
and `bounded_scope` even though initialization accepts their omission: they
give execution and review a concrete task. `title`, `constraints` and
`plan_version` make the plan easier to understand and revise.

Create the progress file and inspect the next step:

```bash
node "$NTG/scripts/ntg-vnext.mjs" init --ledger .ntg/ledger.json --plan plan.json
node "$NTG/scripts/ntg-vnext.mjs" status --ledger .ntg/ledger.json
```

Both commands were run locally with the exact plan above. Relevant fields from
the output (an excerpt, not the complete response):

```json
{
  "state": {
    "goal": "Add a health-check endpoint to the example service",
    "plan_version": "v1",
    "next_action": "Ready to delegate initial milestone: m1",
    "completed_milestones": []
  },
  "next_milestone": "m1",
  "needs_alt": []
}
```

Now execute the plan:

```bash
node "$NTG/scripts/ntg-vnext.mjs" run --ledger .ntg/ledger.json --all
```

This calls real AGY models and consumes model usage. It was not rerun for this
documentation change; [existing live evidence](status.md#live-validation)
checks the execution/review flow. The health-check implementation itself is an
illustrative task, not a claimed live result.

NTG runs `m1`, independently reviews it against its acceptance criteria, then
runs `m2` only after `m1` is verified. Review returns `GO` (accepted) or `NO-GO`
(repair needed). The final response includes `global_completion` only when the
current plan is verified and no blockers remain. Model self-reports alone do
not complete the plan.

## Run one step or continue later

Run just the next eligible milestone:

```bash
node "$NTG/scripts/ntg-vnext.mjs" run --ledger .ntg/ledger.json
```

Or select an existing milestone whose dependencies are already complete:

```bash
node "$NTG/scripts/ntg-vnext.mjs" run --ledger .ntg/ledger.json --milestone m1
```

These model-consuming variants were source-checked, not rerun live here.
`--all` continues in dependency order; an explicit `--milestone` selects only
that milestone even if `--all` is also supplied.

After a normal exit, open a fresh terminal in the same project, set `NTG` to
your checkout again, inspect `status`, and repeat `run` or `run --all`.
Every call reads saved progress; you do not need the earlier chat. Do not
repeat `init` on an existing ledger.

## Change the plan

Save a revised plan as `plan-v2.json`, keeping the same shape as the example and
setting `plan_version` to `"v2"`. Then:

```bash
node "$NTG/scripts/ntg-vnext.mjs" replan --ledger .ntg/ledger.json --plan plan-v2.json
```

This local command was checked with a v2 copy of the example. It adopts the new
plan, clears current completion and marks old reviews stale. Retained steps
need fresh review in dependency order; unchanged code need not be rewritten.
Old evidence stays as history. Finish or recover an active invocation before
replanning.

## Ask for advice

For an unresolved design choice:

```bash
node "$NTG/scripts/ntg-vnext.mjs" plan --ledger .ntg/ledger.json --task "How should we test the health endpoint?"
```

For a repeated failure where another approach may help:

```bash
node "$NTG/scripts/ntg-vnext.mjs" alt --ledger .ntg/ledger.json --milestone m1 --task "Challenge our current diagnosis of the failing health endpoint"
```

Both call models; their syntax was source-checked, not rerun live here. Output
has `adopted: false`: advice is recorded but does not edit your plan or complete
work. Decide what to use, update your plan file, then use `replan`.

`status` reports `needs_alt` when the same failure class has at least three
attempts without new evidence. It does not automatically call a model.
`alt` defaults to Sonnet; adding `--escalate` explicitly selects Opus and may
change model usage cost. Either choice remains advisory.

## When work stops

Read the JSON output, especially `results`, `state.blockers` and
`state.next_action`.

| Outcome | What to do |
|---|---|
| Exit 0 | Command succeeded; inspect `global_completion` before calling the whole project complete |
| Exit 2: `NO-GO` | Read review repair needs, then repeat `run` for a fresh candidate and review |
| Exit 2: `BLOCKED` or `NEEDS_DEEP` | Resolve the reported blocker or ask for planning advice; revise the plan if needed |
| Exit 1: invalid model response | Inspect the error; retry the milestone if appropriate. Nothing is promoted from malformed output |
| Ledger is locked | Close the previous session normally; do not delete a live owner's lock |
| Process crashed during work | Use the recovery procedure below before resuming |

Crash recovery requires Linux with `/proc`, Python 3 with `os.pidfd_open`, and
a kernel supporting pidfds for orphan-executor termination. It refuses when it
cannot establish safe termination. After observing that the prior process was
interrupted, describe what happened:

```bash
node "$NTG/scripts/ntg-vnext.mjs" recover --ledger .ntg/ledger.json --evidence "Observed the previous supervisor exit during milestone execution"
```

Replace the evidence text with your actual observation. Killed-owner recovery
is covered by `tests/test_ntg_vnext.mjs`; the no-interruption refusal was run
locally. No shared session was interrupted. Recovery ends the interrupted invocation; it does not mark work
complete. Then inspect `status` and run again. It is not a general “unlock”
command: if no milestone was interrupted, it reports that instead of claiming
recovery succeeded.

`init`, `status`, `replan` and `recover` do not call models. `run`, `plan` and
`alt` do. Model calls use a 600-second default invocation timeout; the
`--timeout` option or `NTG_RUNNER_TIMEOUT_S` environment variable can set a
positive number of seconds.

## View progress as a graph

```bash
node "$NTG/scripts/dag-view.mjs" --ledger .ntg/ledger.json --width 80 --no-color
```

This local, read-only command was run against the example ledger. It draws
milestone dependencies and states without changing progress.

- `--ledger PATH` selects the ledger; `NTG_LEDGER` can supply the path instead.
- `--width N` fixes the width; otherwise it uses the terminal width.
- `--no-color` disables ANSI colors.
- `--watch` redraws when the ledger changes, for example in a side terminal pane. The watch variant was not rerun
  for this documentation change.

For an NTG-supplied display fixture rather than your own project:

```bash
node "$NTG/scripts/dag-view.mjs" --ledger "$NTG/tests/fixtures/dag-view/all-states.ledger.json" --width 80 --no-color
```

This fixture command was also run locally. Internal agent routing, model
overrides and maintainer release checks belong in [Internals](internals.md).
