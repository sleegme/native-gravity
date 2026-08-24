# Architecture

Native Gravity v0.2 is intentionally not a second agent runtime. It is a small set of behavioral contracts loaded into Antigravity's existing runtime.

```text
User
  |
  v
gravity-main / host model (recommended: Claude Sonnet 4.6)
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

## Role and model are separate

Role contracts are stable concepts; model assignments are current execution policy.

| Role | Contract | v0.2 model policy |
| --- | --- | --- |
| Main | Own and coordinate the task | `inherit` (recommended host: Sonnet 4.6) |
| Worker | Execute clear bounded subtasks | `flash` |
| Deep | Resolve uncertainty before execution | `pro` |
| Reviewer | Independently verify delivered work | `pro` |

Native Gravity does not pin exact subagent slugs because Antigravity custom subagents expose native model tiers. Future model changes should not require rewriting role definitions.

## Native-first boundary

Antigravity owns:

- custom-agent discovery
- `invoke_subagent`
- background/subagent lifecycle
- workspace handling
- session reuse and messaging
- tool permissions and sandboxing
- model-tier resolution

Native Gravity owns:

- role definitions
- delegation policy
- task contracts passed through prompts
- Deep escalation criteria
- review policy

No wrapper CLI, custom runner, durable mailbox, or state machine is introduced in v0.2.

## Main

Main interprets the request and chooses the minimum necessary orchestration. Main can perform trivial or integration-sensitive edits itself when delegation costs more than it saves.

For normal sequential work, use the same current workspace and pass explicit task context to subagents. Subagents should not be assumed to inherit the parent's entire conversation context.

## Worker

Worker is the default leaf executor. Clear implementation and focused discovery/research can both be expressed as bounded Worker prompts. A separate Explore/Librarian persona is unnecessary in v0.2.

Worker should stop rather than invent a solution when the real problem is uncertain.

## Deep

Deep is defined by uncertainty, not generic complexity:

```text
large but mechanical edit -> Worker
small change with unknown race-condition cause -> Deep
```

Deep is read-only and returns diagnosis plus implementation guidance. Main or Worker executes the chosen solution.

## Reviewer

Reviewer is independent, read-only, and blocker-focused. Main sends the current task contract, relevant change context, and verification evidence on demand rather than maintaining a persistent review packet.

Review is risk-gated. Trivial low-risk work does not need a mandatory extra model call.

## Correction loop

```text
Worker implementation
      ↓
Reviewer (when justified)
      ↓
NO-GO
      ↓
concrete blocker
      ↓
existing Worker session
      ↓
fix → re-review
```

If a repeated blocker reveals an incorrect diagnosis rather than an implementation mistake, route through Deep before retrying.
