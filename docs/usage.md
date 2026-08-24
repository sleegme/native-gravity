# Usage

Native Gravity v0.2 is used directly as an Antigravity plugin rather than through a separate wrapper CLI.

## Install

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin install .
```

Open `/agents` in Antigravity and select `gravity-main`.

For the recommended v0.2 setup, use Claude Sonnet 4.6 as the active host/session model. `gravity-main` itself uses `model: inherit`.

## Normal flow

```text
user request
   ↓
Main decides whether delegation helps
   ↓
clear bounded work ─────────────→ Worker
uncertain diagnosis/trade-off ──→ Deep → Main/Worker
   ↓
implementation
   ↓
independent review when risk justifies it
   ↓
Reviewer → GO / NO-GO
```

## Delegation prompts

Because subagents start with their own context, Main should explicitly pass:

- goal
- scope
- non-goals
- acceptance criteria
- relevant evidence/current state
- whether editing is allowed
- expected output

For normal sequential work, `Workspace: inherit` keeps agents on the same checkout.

## Worker

Use Worker for clear bounded implementation, repetitive edits, focused codebase discovery, or explicit read-only research.

If the correct solution is unclear, Worker should return the uncertainty rather than performing an unsolicited redesign.

## Deep

Use Deep when the task requires diagnosis or deciding what should be done before implementation. Deep is read-only by contract.

Examples:

- unknown failure root cause
- conflicting requirements
- architecture/API trade-offs
- reconstructing existing code intent
- repeated failed approaches

## Reviewer

Reviewer is not an implementation agent. Main should include the task contract, relevant change/diff context, and verification evidence in its invocation prompt. Reviewer inspects current files and returns only material blockers plus `VERDICT: GO` or `VERDICT: NO-GO`.

Review is risk-gated; trivial changes may be verified by Main without a dedicated Reviewer call.

## What v0.2 intentionally does not have

- wrapper CLI
- review packet shell scripts
- persistent coordination state
- Explore/Librarian agents
- large category matrix
- custom quota router
