# Native Gravity

[한국어](docs/ko/README.md)

Native Gravity is a small orchestration plugin for Google Antigravity. It borrows the separation-of-responsibility philosophy of OMO-style harnesses while keeping implementation deliberately close to Antigravity's native primitives.

> Status: **v0.2.1 / experimental**

## Core idea

```text
User
  │
  ▼
Antigravity Default agent
(recommended host model: Claude Sonnet 4.6)
  + Native Gravity orchestration rule
  │
  ├─ Worker   → AGY Flash tier
  ├─ Deep     → AGY Pro tier
  └─ Reviewer → AGY Pro tier
```

Native Gravity no longer replaces the primary agent in v0.2.1. The host stays Antigravity-native; the plugin contributes routing policy plus three small specialized subagents:

- **Worker** — executes clear, bounded subtasks.
- **Deep** — resolves ambiguity, diagnosis, and technical trade-offs before execution.
- **Reviewer** — independently verifies correctness and requirements.

Subagents stay on Antigravity's native `flash` / `pro` tiers rather than pinning exact model slugs.

## Why the Default agent hosts orchestration

Runtime validation of v0.2 found a compatibility blocker: when `gravity-main` was selected as a custom primary agent, `invoke_subagent` rejected every tested target, including Antigravity's built-in `research` agent. The Default agent successfully launched `research` in the same environment.

v0.2.1 therefore moves Main's behavior into a plugin rule and lets the Default agent remain the coordinator. This is a compatibility decision based on observed behavior, not a claim that custom-primary delegation is intentionally unsupported by Antigravity.

## Why plugin-only

Native Gravity does not ship a replacement runtime or wrapper CLI. Antigravity already provides agent discovery, `invoke_subagent`, subagent lifecycle, sessions, workspaces, tool permissions, monitoring, model tiers, and rules.

```text
Native Gravity decides:
- which role should handle the work
- what contract/prompt that role receives
- when deeper diagnosis or independent review is justified

Antigravity decides:
- how the primary agent and subagents run
- lifecycle and sessions
- model-tier resolution
- workspace/subagent execution
```

## Layout

```text
native-gravity/
├─ plugin.json
├─ AGENTS.md
├─ rules/
│  └─ orchestration.md
├─ agents/
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

Use Antigravity's **Default agent** as the primary agent. For the recommended v0.2.1 mapping, use Claude Sonnet 4.6 as the active host/session model.

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

## v0.2.1 boundaries

Not included:

- custom primary/Main agent
- replacement task/runtime engine
- shell wrapper CLI
- persistent coordination state or review-packet plumbing
- automatic quota-aware routing
- exact Claude/Opus subagent pinning
- direct AI Studio API execution

The direct AI Studio execution path remains planned for v0.3.

See [architecture](docs/architecture.md), [usage](docs/usage.md), and [status](docs/status.md).
