# Native Gravity

[한국어](docs/ko/README.md)

> **Version:** 1.1.0 · **Maturity:** alpha · **Validated runtime:** AGY 1.3.3

Native Gravity (NTG) helps you carry multi-step coding work through Google
Antigravity (AGY) without losing track of what is actually finished. You write
a plan with small steps and acceptance criteria. NTG runs those steps, has a
separate reviewer check the result, and saves the verified progress so you can
continue later.

**A step is not done just because the agent says it is.** It must pass
independent review against your criteria.

## Why add NTG to Antigravity?

Use plain AGY when a direct coding conversation is enough. NTG adds an explicit
workflow for work that spans several steps or sessions:

- **Know what is finished.** Completed steps have an independent review;
  rejected results remain unfinished.
- **Pick up where you left off.** A saved progress file, called a ledger,
  records the plan, results, blockers and next step.
- **Keep each step focused.** Your plan states the allowed files, what to
  deliver and what not to change.
- **Revise the plan without trusting stale reviews.** Changed plans require
  fresh verification, even for retained steps.

You do not choose or coordinate internal agents. Antigravity still provides
the models, tools, sessions and permissions. NTG adds planning boundaries,
saved progress and independent review, not a replacement coding environment.
See [Status](docs/status.md) for the observed behavior and its evidence.

## Install

You need **Node.js 18+**, **Antigravity CLI (`agy`) 1.3.3** on `PATH`, and
working model access. Version 1.1.0 is not published to npm; use the repository:

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin uninstall native-gravity
agy plugin install .
export NTG="$PWD"
```

The uninstall/install pair also handles upgrades, removing files that no longer
belong to the plugin. Uninstall is safe when the plugin was not installed.
`NTG` points to this checkout, so you can run its scripts from your own project.
Plugin installation does not create a global CLI command.

Installation was verified in the [existing release evidence](.omo/evidence/20-instinct-results.md).
For this documentation change, plugin validation passed; uninstall/install were
not rerun against the shared installation.

## Start your first task

Open your project directory and follow the [worked example in Usage](docs/usage.md#first-task).
It shows how to write `plan.json`, create the progress file and run the work:

```bash
node "$NTG/scripts/ntg-vnext.mjs" init --ledger .ntg/ledger.json --plan plan.json
node "$NTG/scripts/ntg-vnext.mjs" status --ledger .ntg/ledger.json
node "$NTG/scripts/ntg-vnext.mjs" run --ledger .ntg/ledger.json --all
```

`init` and `status` were checked locally with that example. `run` invokes real
models and consumes model usage; it was not rerun for this documentation change.
The existing [live validation](docs/status.md#live-validation) covers execution,
rejection, repair and resume.

NTG currently needs a plan file; it does not turn a one-sentence goal directly
into an adopted plan. Planning advice is available in [Usage](docs/usage.md#ask-for-advice).
The product is alpha and has been validated on one host with AGY 1.3.3.
Crash recovery is Linux-specific, and only one session may own a progress file
at a time. See [Usage](docs/usage.md#when-work-stops) for the practical steps.

## Documentation

- [Usage](docs/usage.md) — real workflows, examples and troubleshooting.
- [Architecture](docs/architecture.md) — design choices and overall structure.
- [Internals](docs/internals.md) — implementation and maintainer details.
- [Specs](docs/specs/) — technical contracts.
- [Status](docs/status.md) — implemented capabilities, limits and evidence.
- [Versioning](docs/versioning.md) — release policy and compatibility history.
