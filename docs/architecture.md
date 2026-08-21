# Architecture

```text
User
  |
  v
oma-main / Claude Sonnet 4.6
  |-- task contract + category routing
  |
  |-- oma-implementation-flash / Gemini Flash
  |     `-- quick, unspecified-low, ordinary work
  |
  |-- oma-implementation-pro / Gemini Pro
  |     `-- deep, ultrabrain, visual, artistry, unspecified-high, architect
  |
  |-- oma-explore / Gemini Flash
  |-- oma-librarian / Gemini Flash
  |
  `-- review packet
         |
         |-- primary: oma-review + Claude Opus 4.6 via `oma review`
         `-- fallback: oma-review native `model: pro`
```

The project deliberately separates four axes:

- **Role**: coordinator, implementation, review, research.
- **Category**: the behavioral mode for the task.
- **Model**: selected by native tier (`flash` / `pro`) or exact CLI slug at the boundary.
- **Reasoning**: controlled by the selected model tier/slug and explicit headless effort where supported.

## Why the Opus wrapper exists

Antigravity custom-agent frontmatter exposes `inherit`, `flash`, and `pro`. That is enough for Gemini workers but does not express an exact Claude Opus subagent. Headless mode can pin an exact model and a custom agent at the same time, so `oma review` uses that boundary to run the same read-only review harness with Opus. If the exact model is unavailable, the parent can invoke the review agent natively and get the Pro fallback.

## State envelope

`.oma/` is local coordination state and is gitignored:

- `task-contract.md`: stable goal/scope/acceptance/verification/category.
- `implementation-evidence.md`: worker summary plus verification evidence.
- `review-packet.md`: generated snapshot of contract, evidence, status, and diff.

This keeps the main conversation from carrying every implementation detail while preserving enough durable context to re-review fixes.
