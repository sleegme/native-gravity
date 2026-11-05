# Usage

[한국어](ko/usage.md) · [Product and installation](../README.md#installation) · [Current status](status.md)

Run NTG from the directory of the project you want to change. You bring a goal,
a plan and the criteria for checking the result; NTG picks the internal agents.
Two terms come up throughout. A **milestone** is one bounded step of your plan.
The **ledger** is the saved progress file, not a chat transcript.

## Running with /ntg

You can run NTG directly in an `agy` session with:

```text
/ntg <task>
```

- **Fresh task (no ledger exists):** When no ledger exists, `/ntg` drafts a milestone plan from your task, displays it, and waits for your confirmation before running anything. Once confirmed, it initializes `.ntg/ledger.json` and runs the plan through the real runner (`run --all`).
- **Existing task (ledger already exists):** When a ledger already exists, `/ntg` shows current status and resumes execution (`run --all`) without overwriting existing progress.
- **Packaged helper resolution:** Scripts are resolved from the installed plugin via the packaged helper (`scripts/ntg-command.mjs`), avoiding any need to set `NTG` or maintain a checkout path.
- **Real runner adherence:** The real runner (`ntg-vnext.mjs`) and independent Zen verifier govern execution and review; `/ntg` does not promise a different model or bypass runner authority.

## Set up your project

Install NTG with the [README procedure](../README.md#installation).
Then change into your target project the way you normally would. Every `.ntg/`
and plan path below is relative to that project. Commands (`ntg-vnext`, `ntg-dag`)
resolve directly from your environment or via the packaged helper in `/ntg`.

## First task

Say your project already has a service in `src/server.js` and a test suite in
`tests/server.test.js`. Save the following as `plan.json` in that project. NTG
doesn't ship these files; they're stand-ins, so adjust the paths and the
criteria to fit your own service and test framework.

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

A few fields are required: a non-empty `goal`, a non-empty `milestones` array,
and a unique, non-empty `id` for each milestone. Dependencies have to point at
IDs that exist, and they can't form a cycle. Initialization will accept a plan
without `objective`, `acceptance_criteria`, `non_goals` and `bounded_scope`, but
fill them in anyway. They're what gives execution and review a concrete task.
`title`, `constraints` and `plan_version` make the plan easier to read and to
revise later.

Create the progress file and check what comes next:

```bash
ntg-vnext init --ledger .ntg/ledger.json --plan plan.json
ntg-vnext status --ledger .ntg/ledger.json
```

With the plan above, the output includes these fields (an excerpt, not the full
response):

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

Now run the plan:

```bash
ntg-vnext run --ledger .ntg/ledger.json --all
```

> **Model usage:** `run`, `plan` and `alt` call real AGY models and use model
> quota. The health-check task here is only an illustration, not a recorded
> live result; the [live evidence](status.md#live-validation) covers the real
> execution and review flow.

NTG runs `m1` and has it independently reviewed against its acceptance criteria.
Only once `m1` is verified does it move on to `m2`. A review comes back as `GO`
(accepted) or `NO-GO` (needs repair). The final response includes
`global_completion` only when the current plan is fully verified and nothing is
blocking it. A model claiming it's finished is never enough to complete the
plan.

## Run one step or continue later

To run just the next milestone that's ready:

```bash
ntg-vnext run --ledger .ntg/ledger.json
```

Or pick a specific milestone whose dependencies are already done:

```bash
ntg-vnext run --ledger .ntg/ledger.json --milestone m1
```

`--all` keeps going in dependency order. If you pass `--milestone`, only that
milestone runs, even when `--all` is there too.

After a normal exit, you can come back any time. Open a new terminal in the same
project, check `status`, and repeat `run` or `run --all`. Each call reads the
saved progress, so you don't need the earlier chat. Don't run `init` again on a
ledger that already exists.

## Change the plan

Save the revised plan as `plan-v2.json`, in the same shape as the example, with
`plan_version` set to `"v2"`. Then run:

```bash
ntg-vnext replan --ledger .ntg/ledger.json --plan plan-v2.json
```

This adopts the new plan, clears the current completion state and marks the old
reviews as stale. Steps you kept have to be reviewed again, in dependency order,
though code that didn't change doesn't need rewriting. Old evidence stays on
record as history. If an invocation is still active, let it finish or recover it
before you replan.

## Ask for advice

When you're stuck on a design choice:

```bash
ntg-vnext plan --ledger .ntg/ledger.json --task "How should we test the health endpoint?"
```

When the same failure keeps coming back and a different angle might help:

```bash
ntg-vnext alt --ledger .ntg/ledger.json --milestone m1 --task "Challenge our current diagnosis of the failing health endpoint"
```

The output says `adopted: false`. Advice gets recorded, but it never edits your
plan or completes any work. You decide what to take from it, update your plan
file, and then run `replan`.

`status` reports `needs_alt` when the same kind of failure has had at least
three attempts with no new evidence. That's only a suggestion; it doesn't call a
model by itself. `alt` uses Sonnet by default. Adding `--escalate` switches to
Opus on purpose, which may cost more. Either way, the answer is still just
advice.

## When work stops

Read the JSON output, paying most attention to `results`, `state.blockers` and
`state.next_action`.

| Outcome | What to do |
|---|---|
| Exit 0 | The command worked. Check `global_completion` before you call the whole project done |
| Exit 2: `NO-GO` | Read what the review wants repaired, then run `run` again to get a fresh candidate and review |
| Exit 2: `BLOCKED` or `NEEDS_DEEP` | Fix the reported blocker or ask for planning advice, and revise the plan if you need to |
| Exit 1: invalid model response | Read the error and retry the milestone if it makes sense. Malformed output never gets promoted |
| Ledger is locked | Close the previous session normally. Don't delete a lock that a live session still owns |
| Process crashed during work | Follow the recovery steps below before you resume |

Crash recovery needs Linux with `/proc`, Python 3 with `os.pidfd_open`, and a
kernel with pidfd support so it can stop orphaned executors. If it can't be sure
they'll stop safely, it refuses to run. Once you've seen that the previous
process was interrupted, describe what happened:

```bash
ntg-vnext recover --ledger .ntg/ledger.json --evidence "Observed the previous supervisor exit during milestone execution"
```

Swap the evidence text for what you actually saw. Recovery from a killed owner
is covered by `tests/test_ntg_vnext.mjs`. Recovery closes out the interrupted
invocation, but it doesn't mark any work complete; afterwards, check `status`
and run again. It's not a general "unlock" command either. If no milestone was
interrupted, it returns an error instead of claiming it recovered something.

`init`, `status`, `replan` and `recover` never call models. `run`, `plan` and
`alt` do. Each model call times out after 600 seconds by default. To change
that, pass a positive number of seconds with `--timeout` or the
`NTG_RUNNER_TIMEOUT_S` environment variable.

## View progress as a graph

```bash
ntg-dag --ledger .ntg/ledger.json --width 80 --no-color
```

This read-only command draws your milestones, their dependencies and their
states. It never changes your progress.

- `--ledger PATH` picks the ledger. You can set `NTG_LEDGER` instead.
- `--width N` fixes the width. Without it, the terminal width is used.
- `--no-color` turns off ANSI colors.
- `--watch` redraws whenever the ledger changes, which is handy in a side
  terminal pane.

To try it on a display fixture that ships with NTG instead of your own project:

```bash
ntg-dag --ledger tests/fixtures/dag-view/all-states.ledger.json --width 80 --no-color
```

Internal agent routing, model overrides and maintainer release checks are
covered in [Internals](internals.md).

## Install details

You need **Node.js 18+**, **Antigravity CLI (`agy`) >= 1.3.0** on your `PATH`, and
working model access. Install or upgrade Native Gravity with a single command:

```bash
npx --yes native-gravity
```

You can also use `bunx native-gravity`, the curl installer (`curl -fsSL https://raw.githubusercontent.com/sleegme/native-gravity/v1.1.0/scripts/install.sh | sh`), or PowerShell (`irm https://raw.githubusercontent.com/sleegme/native-gravity/v1.1.0/scripts/install.ps1 | iex`).

Running the installer handles clean upgrades automatically (uninstalling the previous version before installing the new package).

Current release: version 1.1.0, alpha, validated on AGY 1.3.3.

Current limits: The product has been validated on one host. Crash recovery works only on Linux, and only one session can own a progress file at a time.

## Reporting issues

If an NTG execution fails or stops unexpectedly in an interactive terminal, `ntg-vnext` offers to report it directly after the command finishes. You can also generate a sanitized diagnostic report manually to file an issue at any time:

```bash
ntg-report-issue --ledger .ntg/ledger.json
```

This previews the issue, redacts detected secrets and user paths, writes a local markdown preview file (`issue-preview.md`), and prompts to submit the issue via GitHub CLI (`gh`) when run in an interactive terminal.

## More documentation

- [Usage](usage.md): everyday workflows, examples and troubleshooting.
- [Architecture](architecture.md): design choices and the overall shape.
- [Internals](internals.md): implementation details for maintainers.
- [Navi](navi/README.md): isolated, bounded Linux desktop tasks through Steamroller.
- [Specs](specs/): technical contracts.
- [Status](status.md): what works, known limits and the evidence.
- [Versioning](versioning.md): release policy and compatibility history.
