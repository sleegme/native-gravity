# Native Gravity orchestration policy

Use Antigravity's default primary agent as the host. Native Gravity does not replace the primary agent in v0.2.1.

## Routing

Choose the minimum necessary orchestration:

- Use `gravity-worker` when the work is clear, bounded, and executable without substantial diagnosis. This includes ordinary implementation, repetitive changes, focused codebase discovery, and explicit read-only research.
- Use `gravity-deep` when the correct action is uncertain: unknown root cause, ambiguous or conflicting requirements, architecture/API trade-offs, reconstruction of existing intent, or repeated materially different failed attempts.
- Use `gravity-reviewer` for independent verification of substantive, risky, or user-requested completed work. Trivial low-risk changes may be self-verified by the host.

Task size alone does not trigger Deep.

## Delegation contract

When invoking a Native Gravity subagent, include the information it cannot inherit automatically. Use these named fields in the prompt:

- **ROLE_REASON** — why this agent role is being invoked
- **GOAL** — what must be accomplished
- **SCOPE** — files, components, or areas in play
- **NON_GOALS** — explicit exclusions to prevent scope creep
- **ACCEPTANCE** — concrete criteria the result must satisfy
- **EVIDENCE** — relevant current context, findings, or prior output
- **EDIT_POLICY** — read-only, edit-allowed, or specific constraints
- **EXPECTED_OUTPUT** — what the agent should return

Prefer `Workspace: inherit` for normal sequential work so agents inspect the same current checkout. Use isolated workspaces only when genuinely useful for parallel independent work.

## Return handling

- Worker should end with exactly one terminal signal: `DONE`, `BLOCKED`, or `NEEDS_DEEP`.
- Deep returns diagnosis, evidence, approaches, recommendation, risks/assumptions, and a concrete implementation contract. Deep does not implement the solution.
- Reviewer reports material blockers only and ends with exactly `VERDICT: GO` or `VERDICT: NO-GO`.

If Worker returns `NEEDS_DEEP`, consult Deep before another implementation attempt.

## Correction loop

On a review blocker, classify it before acting:

- **Implementation defect** — send the concrete blocker back to the existing Worker session when practical.
- **Wrong diagnosis** — consult Deep before another implementation attempt.

Spawn a replacement Worker only when the existing session cannot continue.

## Completion

Delegation is not completion. Inspect the current files and relevant verification evidence before reporting the task done. If independent review was required, do not report completion before a Reviewer `VERDICT: GO`.
