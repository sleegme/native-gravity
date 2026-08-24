# Architecture

Native Gravity v0.2.1 is intentionally not a second agent runtime. It is a small orchestration policy loaded into Antigravity's existing runtime.

```text
User
  |
  v
Antigravity Default agent / host model
(recommended: Claude Sonnet 4.6)
  + rules/orchestration.md
  |
  |-- gravity-worker   / flash
  |      clear bounded execution
  |
  |-- gravity-deep     / pro
  |      diagnosis, ambiguity, trade-offs
  |
  `-- gravity-reviewer / pro
         independent read-only verification
```

## Host and subagent roles are separate

The primary coordinator is Antigravity's Default agent. Native Gravity defines only the policy used by that host and three specialized subagent contracts.

| Component | Contract | v0.2.1 model policy |
| --- | --- | --- |
| Host | Own and coordinate the task | active Antigravity session model; Sonnet 4.6 recommended |
| Worker | Execute clear bounded subtasks | `flash` |
| Deep | Resolve uncertainty before execution | `pro` |
| Reviewer | Independently verify delivered work | `pro` |

Native Gravity does not pin exact subagent slugs because Antigravity custom subagents expose native model tiers. Future model changes should not require rewriting role definitions.

## Why v0.2.1 removed gravity-main

The v0.2 bootstrap uncovered a runtime compatibility blocker. With `gravity-main` selected as a custom primary agent, calls through `invoke_subagent` failed for:

- plugin `gravity-deep`
- plugin `gravity-worker`
- a workspace custom `gravity-worker-test`
- built-in `research`

The same environment's Default agent successfully invoked built-in `research`.

The observed error was `subagent "<name>" not found or not allowed to be invoked`. That evidence does not distinguish discovery from authorization internally, and it does not prove that custom-primary delegation is intentionally unsupported. v0.2.1 simply avoids replacing the native primary agent while issue #3 continues runtime validation.

## Native-first boundary

Antigravity owns:

- the primary agent
- custom-agent discovery
- `invoke_subagent`
- background/subagent lifecycle
- workspace handling
- session reuse and messaging
- tool permissions and sandboxing
- model-tier resolution
- plugin rule loading

Native Gravity owns:

- orchestration/routing rules
- specialized subagent role definitions
- task contracts passed through prompts
- Deep escalation criteria
- review policy

No wrapper CLI, custom runner, durable mailbox, or state machine is introduced in v0.2.1.

## Host policy

The former Main behavior now lives in `rules/orchestration.md`. The host interprets the request and chooses the minimum necessary orchestration. It may perform trivial or integration-sensitive work directly when delegation costs more than it saves.

When delegation is useful, the host passes an explicit envelope: `ROLE_REASON`, `GOAL`, `SCOPE`, `NON_GOALS`, `ACCEPTANCE`, `EVIDENCE`, `EDIT_POLICY`, and `EXPECTED_OUTPUT`.

## Worker

Worker is the default leaf executor. Clear implementation and focused discovery/research can both be expressed as bounded Worker prompts.

Worker ends with one terminal signal:

- `DONE`
- `BLOCKED`
- `NEEDS_DEEP`

## Deep

Deep is defined by uncertainty, not generic complexity:

```text
large but mechanical edit -> Worker
small change with unknown race-condition cause -> Deep
```

Deep is read-only and returns diagnosis plus a concrete implementation contract. The host or Worker executes the chosen solution.

## Reviewer

Reviewer is independent, read-only, and blocker-focused. The host sends the task goal/scope, acceptance criteria, change context, and verification evidence on invocation.

Review is risk-gated. Trivial low-risk work does not need a mandatory extra model call.

## Correction loop

```text
Worker implementation
      ↓
Reviewer (when justified)
      ↓
NO-GO
      ↓
classify blocker
  ├─ implementation defect → existing Worker session → fix → re-review
  └─ wrong diagnosis       → Deep → new implementation contract
```
