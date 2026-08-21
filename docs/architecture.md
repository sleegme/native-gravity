# Architecture

oh-my-agy prefers Antigravity-native custom agents and subagent lifecycle features over rebuilding a large external runtime.

```text
User
  |
  v
oma-main / Claude Sonnet 4.6
  |-- task contract + category routing
  |
  |-- oma-implementation-flash / Gemini Flash
  |     `-- quick, unspecified-low, ordinary work, light writing
  |
  |-- oma-implementation-pro / Gemini Pro
  |     `-- deep, ultrabrain, visual-engineering,
  |         artistry, unspecified-high, architect
  |
  |-- oma-explore / Gemini Flash
  |-- oma-librarian / Gemini Flash
  |
  `-- implementation evidence
         |
         v
      review packet
         |
         |-- primary: Claude Opus 4.6 + oma-review
         `-- fallback: Gemini Pro + oma-review
```

## Four separate axes

OMA deliberately separates four concepts:

- **Role**: coordinator, implementation, review, research.
- **Category**: the behavioral mode for the task, such as `deep` or `ultrabrain`.
- **Model**: the actual model or Antigravity model tier used to perform the task.
- **Reasoning**: the amount and style of reasoning expected for that role/category.

Two categories may use the same model while still behaving differently. For example, `deep` emphasizes broad exploration, root-cause tracing, and complete delivery, while `ultrabrain` emphasizes difficult logic, architecture, and trade-off reasoning.

## Keep Main thin

`oma-main` interprets the request, writes a task contract, chooses a category, dispatches work, collects evidence, and decides what happens after review. Substantive source edits belong to implementation workers.

## Task contract

Before substantive implementation, Main writes `.oma/task-contract.md` with:

```text
Goal
Scope
Non-goals
Acceptance criteria
Verification expected
Selected category
```

The contract should remain stable during implementation unless the actual request changes.

## Evidence-based completion

A worker claiming completion is not enough. When applicable, OMA expects concrete evidence such as changed files, diff inspection, targeted tests, build/typecheck/lint results, runtime checks, and remaining risks or blockers.

Worker output is stored in `.oma/implementation-evidence.md`. `oma packet` combines it with the task contract and current worktree diff into `.oma/review-packet.md`.

## Review gate

Review is separate from implementation. The primary reviewer is Claude Opus 4.6, with Gemini Pro as the native fallback.

The reviewer focuses on material blockers only:

- unmet acceptance criteria
- correctness bugs
- regressions
- risky deletion or scope expansion
- public/API/behavior contract violations
- inadequate verification
- contradictions between evidence and the actual code

The final output is exactly `VERDICT: GO` or `VERDICT: NO-GO`.

## State envelope

`.oma/` is local coordination state and is gitignored:

```text
.oma/
├─ task-contract.md
├─ implementation-evidence.md
└─ review-packet.md
```

## Correction loop

```text
Implementation
    ↓
Review
    ↓
NO-GO
    ↓
blockers only
    ↓
same worker session
    ↓
fix
    ↓
re-review
```

Reuse the existing worker/reviewer session when practical. v0.1 treats roughly two materially different correction attempts as the normal cap before Main re-diagnoses the problem.

## Parallel execution

Fan-out is optional, not a default. Parallel workers are useful only when tasks are genuinely independent, do not compete for the same files, are cheap to merge, and save more time than spawn/coordination overhead costs.

## Quota view

The initial hypothesis is:

```text
Gemini Flash  = inexpensive general labor
Gemini Pro    = heavy implementation / difficult reasoning
Sonnet 4.6    = Main coordinator
Opus 4.6      = expensive final reviewer
```

v0.1 does not automate quota-aware routing. Real usage should determine later rebalancing.
