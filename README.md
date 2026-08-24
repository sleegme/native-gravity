# Native Gravity

[한국어](docs/ko/README.md)

Native Gravity is a small orchestration plugin for Google Antigravity. It borrows the separation-of-responsibility philosophy of OMO-style harnesses while keeping implementation deliberately close to Antigravity's native primitives.

> Status: **v0.2 / experimental**

## Core idea

```text
User
  │
  ▼
Claude Sonnet 4.6
Gravity Main
  │
  ├─ Worker   → AGY Flash tier
  ├─ Deep     → AGY Pro tier
  └─ Reviewer → AGY Pro tier
```

The four roles are intentionally small:

- **Main** — owns the task and coordinates execution.
- **Worker** — executes clear, bounded subtasks.
- **Deep** — resolves ambiguity, diagnosis, and technical trade-offs before execution.
- **Reviewer** — independently verifies correctness and requirements.

`gravity-main` uses `model: inherit`, so select Claude Sonnet 4.6 as the host/session model when using the recommended v0.2 setup. Subagents stay on Antigravity's native `flash` / `pro` tiers rather than pinning exact model slugs.

## Why plugin-only

Native Gravity does not ship a replacement runtime or wrapper CLI in v0.2. Antigravity already provides custom agents, `invoke_subagent`, subagent lifecycle, session reuse, workspaces, tool permissions, and monitoring.

```text
Native Gravity decides:
- which role should handle the work
- what contract/prompt that role receives
- when deeper diagnosis or independent review is justified

Antigravity decides:
- how agents run
- lifecycle and sessions
- model-tier resolution
- workspace/subagent execution
```

## Layout

```text
native-gravity/
├─ plugin.json
├─ AGENTS.md
├─ agents/
│  ├─ gravity-main.md
│  ├─ gravity-worker.md
│  ├─ gravity-deep.md
│  └─ gravity-reviewer.md
└─ docs/
```

## Install

With Antigravity CLI installed, clone this repository and install the plugin directory:

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin install .
```

Then select `gravity-main` from `/agents`. For the recommended v0.2 mapping, use Claude Sonnet 4.6 as the active host model.

## Routing policy

```text
clear + bounded
→ Worker

unclear root cause / ambiguous requirements / architecture trade-off
→ Deep

substantive or risky completed work that needs independent verification
→ Reviewer
```

Task size alone does not trigger Deep. A large mechanical edit can still be Worker work; a two-line race-condition fix can require Deep if the cause is uncertain.

Review is risk-gated rather than mandatory for every trivial action.

## v0.2 boundaries

Not included:

- replacement task/runtime engine
- shell wrapper CLI
- persistent `.oma/` state or review-packet plumbing
- automatic quota-aware routing
- exact Claude/Opus subagent pinning
- direct AI Studio API execution

The direct AI Studio execution path remains planned for v0.3.

See [architecture](docs/architecture.md), [usage](docs/usage.md), and [status](docs/status.md).
