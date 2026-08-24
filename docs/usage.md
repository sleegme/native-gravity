# Usage

Native Gravity v0.2.2 is used directly as an Antigravity plugin rather than through a separate wrapper CLI.

## Install

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin install .
```

When upgrading from an older installation, especially v0.2, use a clean reinstall so removed files do not remain in the staged plugin directory:

```bash
agy plugin uninstall native-gravity
agy plugin install .
```

Use Antigravity's **Default agent** as the primary agent. For the recommended v0.2.2 setup, use Claude Sonnet 4.6 as the active host/session model.

The plugin rule supplies Native Gravity's routing policy; `gravity-worker`, `gravity-deep`, and `gravity-reviewer` remain callable custom subagents.

## Normal flow

```text
user request
   ↓
Antigravity Default agent + Native Gravity rule
   ↓
clear bounded work ─────────────→ Worker
uncertain diagnosis/trade-off ──→ Deep → host/Worker
   ↓
implementation
   ↓
independent review when risk justifies it
   ↓
Reviewer → GO / NO-GO
```

## Delegation prompts

Because subagents start with their own context, the host should explicitly pass these named fields:

- `ROLE_REASON`
- `GOAL`
- `SCOPE`
- `NON_GOALS`
- `ACCEPTANCE`
- `EVIDENCE`
- `EDIT_POLICY`
- `EXPECTED_OUTPUT`

For normal sequential work, `Workspace: inherit` keeps agents on the same checkout.

## Worker

Use Worker for clear bounded implementation, repetitive edits, focused codebase discovery, or explicit read-only research.

Worker ends with exactly one terminal signal:

- `DONE` — task complete with concrete verification evidence
- `BLOCKED` — cannot proceed safely because of a specific blocker
- `NEEDS_DEEP` — the correct action is uncertain and needs diagnosis

## Deep

Use Deep when the task requires diagnosis or deciding what should be done before implementation. Deep is read-only by contract.

Examples:

- unknown failure root cause
- conflicting requirements
- architecture/API trade-offs
- reconstructing existing code intent
- repeated failed approaches

Deep returns a concrete implementation contract for the host or Worker rather than editing source itself.

## Reviewer

Reviewer is not an implementation agent. The host should include the task goal/scope, acceptance criteria, relevant change/diff context, and verification evidence in its invocation prompt.

Reviewer inspects current files and returns only material blockers plus `VERDICT: GO` or `VERDICT: NO-GO`.

Review is risk-gated; trivial changes may be verified by the host without a dedicated Reviewer call.

## Runtime note

v0.2.1 intentionally stopped using `gravity-main` as a custom primary agent. During v0.2 validation, that configuration failed to invoke both custom subagents and the built-in `research` subagent, while the Default agent successfully invoked `research` in the same environment.

v0.2.2 keeps the same native-host architecture. Issue #3 tracks the remaining runtime validation, especially Deep escalation and Reviewer correction routing.

## What v0.2.2 intentionally does not have

- custom primary/Main agent
- wrapper CLI
- review packet shell scripts
- persistent coordination state
- Explore/Librarian agents
- large category matrix
- custom quota router
