# Native Gravity

[한국어](docs/ko/README.md)

> - **Native Gravity**: 1.1.0
> - **Status**: alpha
> - **Validated runtime**: AGY 1.3.3

## What is Native Gravity?

Native Gravity (NTG) is a thin orchestration plugin for Google Antigravity.
You describe your work as a small plan file, and the `ntg-vnext` CLI executes
it milestone by milestone using Antigravity's own agents — with one hard rule:
**no milestone counts as done until an independent reviewer agent has checked
the delivered artifact against your acceptance criteria.** The concrete
benefit on multi-step coding work: durable, honest state. You can stop a
session, resume later from a fresh context, and the ledger says exactly what
is verified, what was rejected, and what comes next.

## Why use it over plain AGY?

Plain AGY agents are already good at coding. On multi-step work, though, the
conversation *is* the state: completion is self-reported and resuming depends
on chat history. NTG adds a small, verified layer on top. The behaviors below
were observed in live validation on AGY 1.3.3
([evidence](.omo/evidence/134-vnext-activation.md)) — they are behavioral
guarantees, not performance claims:

- **Independent verification instead of self-certification.** A separate
  reviewer agent (Zen) checks every milestone's artifact against the plan's
  acceptance criteria and returns GO or NO-GO. A deliberately tampered
  artifact was rejected with NO-GO in live testing, and the repaired
  candidate needed a fresh GO.
- **Durable state instead of conversation.** An authoritative JSON ledger —
  not the chat transcript — records the plan version, milestone states,
  evidence and blockers. A fresh process resumed work from the ledger alone,
  and a material replan invalidated old verdicts and forced re-review.
- **Bounded scope per milestone.** Each milestone runs as a packet with
  explicit scope, non-goals and acceptance criteria, so one step cannot
  silently absorb the next. Work is delegated by kind of work (discovery,
  writing, implementation, diagnosis, review) to fitting specialist agents.
- **Fail-closed, not optimistic.** Empty or malformed model responses, more
  than one result packet, or prose mixed ambiguously with JSON are recorded as
  invocation failures and never promoted; a stale lock left by
  a killed session is recovered only after its dead owner is verified.

## What works today

- Multi-milestone execution in dependency order (`ntg-vnext run --all`), with
  promotion only on an observed matching Zen GO.
- Plan revision (`ntg-vnext replan`) with `plan_version` increment and
  revalidation of retained milestones.
- NO-GO repair cycles: a rejected candidate stays incomplete until a repaired
  one earns a fresh GO.
- Fresh-context resume and crash recovery (`ntg-vnext recover`).
- Advisory planning (`ntg-vnext plan`) and alternate-framing advice
  (`ntg-vnext alt`) — recorded as evidence, never auto-adopted.
- A read-only ledger graph viewer (`ntg-dag`).

Known limitations are listed [below](#requirements-and-known-limitations).

## Install

Prerequisites:

- Node.js 18+
- Antigravity CLI (`agy`) 1.3.3 on `PATH`, with working model access

Native Gravity 1.1.0 is **not published to npm**. Install from the repository:

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin uninstall native-gravity  # safe if it was not installed
agy plugin install .
```

When upgrading, use a clean reinstall (uninstall, then install) so files
removed from the repository do not remain staged.

## Quick start

NTG does not accept a one-sentence goal yet — **you write a small plan file**,
and the CLI runs it. A minimal valid `plan.json`:

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

Each milestone needs a unique `id`; `dependencies` must reference existing
ids and form no cycles. `goal` and a non-empty `milestones` array are the only
required fields; `title`, `objective`, `acceptance_criteria`, `non_goals` and
`bounded_scope` make the milestone contract precise and are strongly
recommended.

Then create a ledger and start. The package is not published to npm yet, so
there is no global `ntg-vnext` command: run the script from your Native Gravity
checkout (below, `$NTG` is the path of that checkout). Elsewhere in these docs,
`ntg-vnext <command>` means `node $NTG/scripts/ntg-vnext.mjs <command>`.

```bash
node $NTG/scripts/ntg-vnext.mjs init   --ledger .ntg/ledger.json --plan plan.json
node $NTG/scripts/ntg-vnext.mjs status --ledger .ntg/ledger.json   # shows the next milestone
node $NTG/scripts/ntg-vnext.mjs run    --ledger .ntg/ledger.json --all
```

`init`, `status` and `recover` are local and free. `run`, `plan` and `alt`
invoke real AGY models and consume model usage.

## Example: an ordinary coding task

Using the plan above, `init` accepts the plan and reports what is next:

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

`ntg-vnext run --all` then executes `m1`, has the independent reviewer check
it against "GET /health returns 200 and a status field", promotes it only on a
GO, does the same for `m2`, and declares global completion when both are
verified. If review rejects a milestone (exit code 2), the printed `results`
say what was missing; repair and `run` again to earn a fresh GO. The full
command reference is in [Usage](docs/usage.md).

## How it works

```text
You -> ntg-vnext -> one bounded milestone at a time
                      -> implementation through specialist agents
                      -> independent verification of the artifact
                      -> ledger promotion only on GO
                 -> global completion when every milestone is verified
```

The ledger is the single source of truth; every call reloads it, so any new
process picks up exactly where the ledger says. Internally NTG composes
Antigravity agents (a supervisor, a planner, milestone executors, specialists
and an independent reviewer) with exact model assignments — you never select
them yourself. The full graph and role boundaries are in
[Architecture](docs/architecture.md).

Native Gravity does not replace the Antigravity runtime: Antigravity owns
execution, sessions, models and permissions, while NTG supplies role
contracts, routing policy and the ledger. Details are in
[Internals](docs/internals.md).

## Requirements and known limitations

- **Alpha software.** Validated on one host with AGY 1.3.3; revalidate the
  compatibility gate when the AGY runtime changes (see
  [Internals](docs/internals.md)).
- **You author the plan.** There is no natural-language goal-to-plan UI;
  `ntg-vnext plan` produces advisory planning help but never writes your plan
  for you.
- **Model usage costs.** `run`, `plan` and `alt` call real AGY models.
- **Known failure mode.** A model occasionally prefixes prose before its JSON
  result packet; this fails closed as an invocation failure
  ([#136](https://github.com/sleegme/native-gravity/issues/136)) — retry the
  milestone. Nothing is promoted on a malformed response.
- **Crash recovery is Linux-specific.** `recover` verifies dead owners and
  terminates orphaned executors via `/proc` and `pidfd`; on other platforms it
  refuses rather than guessing.
- **One session per ledger.** The runner holds an exclusive lock per ledger
  for the session lifetime; close the previous session before resuming
  elsewhere ([Internals](docs/internals.md)).

## Further reading

- [Usage](docs/usage.md) — full command reference, Excavator worker, `ntg-dag`
- [Architecture](docs/architecture.md) — roles, ledger and completion semantics
- [Internals](docs/internals.md) — ledger locking/recovery, role ownership
  detail, AI Studio A/B lane, compatibility history
- [Status](docs/status.md) — current runtime state and validation evidence
- [Versioning](docs/versioning.md) — versioning policy and compatibility matrix
- [vNext architecture contract](docs/specs/vnext-architecture-contract.md) —
  the authoritative specification
