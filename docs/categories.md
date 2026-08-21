# Categories

v0.1 keeps OMO-like category semantics but maps them onto a much smaller Antigravity agent set.

| Category | Worker | Intent |
| --- | --- | --- |
| `quick` | Flash | tiny, obvious, low-risk work |
| `unspecified-low` | Flash | contained moderate work |
| `deep` | Pro | broad exploration, root cause, autonomous full delivery |
| `ultrabrain` | Pro | hard logic, architecture, trade-offs, difficult debugging |
| `visual-engineering` | Pro | UI/frontend with design-system-first workflow |
| `artistry` | Pro | unusually creative work where quality depends on exploration |
| `unspecified-high` | Pro | substantial cross-module work without a better category |
| `architect` | Pro | advisory system design, multiple viable designs and trade-offs |
| `writing` | Flash by default | docs/prose; promote to Pro when complexity or stakes justify it |

The category is passed to the implementation worker as `CATEGORY: <name>`. The worker's system prompt defines how that category changes exploration, implementation, and verification behavior.

Do not add a new agent merely because a new category is useful. Add a new agent only when the task needs materially different tools, permissions, lifecycle, or context isolation.
