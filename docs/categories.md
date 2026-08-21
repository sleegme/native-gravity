# Categories and routing

v0.1 keeps OMO-like category semantics but maps them onto a much smaller Antigravity agent set.

A category is not merely a model selector. It also changes how the worker explores, reasons, implements, and verifies the task.

## Default routing

| Category | Default worker | Intent |
| --- | --- | --- |
| `quick` | Flash | tiny, obvious, low-risk work |
| `unspecified-low` | Flash | contained moderate work without a specialist category |
| `deep` | Pro | broad exploration, root cause, autonomous full delivery |
| `ultrabrain` | Pro | hard logic, architecture, trade-offs, difficult debugging |
| `visual-engineering` | Pro | UI/frontend with a design-system-first workflow |
| `artistry` | Pro | creative work where quality depends on exploration |
| `unspecified-high` | Pro | substantial cross-module work without a better category |
| `architect` | Pro | advisory system design, migration cost, boundaries, trade-offs |
| `writing` | Flash by default | docs/prose; promote to Pro when complexity or stakes justify it |

## Category intent

### `quick`

Small fixes, simple configuration changes, obvious one- or two-file edits, and other low-risk work. Avoid unnecessary abstractions and broad exploration.

### `unspecified-low`

Contained general work that is larger than `quick` but does not require a specialist mode. Flash is the default; escalate if the actual code reveals significantly more complexity.

### `deep`

Goal-oriented work that requires broad code-path exploration, dependency tracing, root-cause diagnosis, and complete delivery rather than a partial proof of concept.

### `ultrabrain`

Use when difficult reasoning itself is central: complex logic, architecture decisions, competing designs, hard debugging, invariants, and constraints. `deep` is delivery-oriented; `ultrabrain` is reasoning-oriented.

### `visual-engineering`

Frontend/UI work. Inspect existing theme tokens, shared components, representative screens, spacing, typography, and color conventions before creating new primitives.

### `artistry`

Work where creative quality matters materially. Consider distinct directions before choosing one, while preserving product scope and constraints.

### `unspecified-high`

Substantial cross-module work that is clearly high complexity but does not fit another specialist category.

### `architect`

Advisory by default. Survey module boundaries, data flow, ownership, migration cost, compatibility, and failure modes. Compare at least two viable designs and recommend one. Do not edit source unless implementation is explicitly requested.

### `writing`

README files, technical documentation, migration guides, and similar prose. Flash is the default; promote to Pro for high-stakes or technically complex documents.

## Passing the category

Main includes the category in the worker prompt:

```text
CATEGORY: <name>
```

It also passes the task contract: Goal, Scope, Non-goals, Acceptance criteria, and Verification expected. A category never replaces the task contract.

## New category != new agent

Add a new agent only when the task needs materially different tools, permissions, lifecycle, context isolation, or responsibility. Otherwise, add behavior to an existing implementation worker instead of expanding the persona set.
