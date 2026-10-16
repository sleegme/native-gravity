# Native Gravity

[한국어](docs/ko/README.md)

> **Version:** 1.1.0 · **Maturity:** alpha · **Validated runtime:** AGY 1.3.3

Native Gravity (NTG) keeps multi-step coding work in Google Antigravity (AGY)
honest about what's actually finished. You write a plan made of small steps,
each with acceptance criteria. NTG runs the steps, has a separate reviewer check
each result, and saves the verified progress so you can come back to it later.

**An agent saying "done" doesn't make a step done.** The step has to pass an
independent review against your criteria.

## Why add NTG to Antigravity?

If a direct coding conversation is enough, plain AGY is all you need. NTG adds
an explicit workflow for work that stretches across several steps or sessions:

- **Know what's finished.** Every completed step has passed an independent
  review. Rejected results stay unfinished.
- **Pick up where you left off.** A saved progress file, called a ledger, keeps
  the plan, results, blockers and next step.
- **Keep each step focused.** Your plan says which files a step may touch, what
  it should deliver and what it must leave alone.
- **Change the plan without trusting old reviews.** Once the plan changes, every
  step needs fresh verification, including the ones you kept.

You never pick or coordinate internal agents. Antigravity still provides the
models, tools, sessions and permissions, and NTG adds planning boundaries, saved
progress and independent review on top. It isn't a replacement coding
environment. [Status](docs/status.md) lists the observed behavior and its
evidence.

## Install

You need **Node.js 18+**, **Antigravity CLI (`agy`) 1.3.3** on your `PATH`, and
working model access. Version 1.1.0 isn't on npm, so install it from the
repository:

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin uninstall native-gravity
agy plugin install .
export NTG="$PWD"
```

Running uninstall and then install also handles upgrades, since it clears out
files that no longer belong to the plugin. Uninstall is harmless if the plugin
was never installed. `NTG` points at this checkout, so you can run its scripts
from your own project. Installing the plugin doesn't create a global CLI
command.

These install steps are backed by the
[existing release evidence](.omo/evidence/20-instinct-results.md).

## Start your first task

Go to your project directory and follow the
[worked example in Usage](docs/usage.md#first-task). It walks through writing
`plan.json`, creating the progress file and running the work:

```bash
node "$NTG/scripts/ntg-vnext.mjs" init --ledger .ntg/ledger.json --plan plan.json
node "$NTG/scripts/ntg-vnext.mjs" status --ledger .ntg/ledger.json
node "$NTG/scripts/ntg-vnext.mjs" run --ledger .ntg/ledger.json --all
```

`init` and `status` don't call models. `run` calls real models and uses model
quota; the [live validation](docs/status.md#live-validation) records execution,
rejection, repair and resume with real models.

For now NTG needs a plan file. It can't turn a one-sentence goal straight into
an adopted plan, but you can ask for planning advice (see
[Usage](docs/usage.md#ask-for-advice)). The product is alpha and has been
validated on one host with AGY 1.3.3. Crash recovery works only on Linux, and
only one session can own a progress file at a time.
[Usage](docs/usage.md#when-work-stops) explains what to do when work stops.

## Documentation

- [Usage](docs/usage.md): everyday workflows, examples and troubleshooting.
- [Architecture](docs/architecture.md): design choices and the overall shape.
- [Internals](docs/internals.md): implementation details for maintainers.
- [Navi](docs/navi.md): isolated, bounded Linux desktop tasks through Steamroller.
- [Specs](docs/specs/): technical contracts.
- [Status](docs/status.md): what works, known limits and the evidence.
- [Versioning](docs/versioning.md): release policy and compatibility history.
