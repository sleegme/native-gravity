# DAG visualization research

## Recommendation

Use a **Mermaid `flowchart`**, generated from the isolated vNext ledger state, and commit the output as a fenced `mermaid` block in a markdown file. It needs no runtime, renders natively on GitHub, diffs as text, and fits the native-first rule in `AGENTS.md`. Add a D3 or cytoscape live view later, if needed, reading the same JSON.

## 1. Option comparison (general knowledge, not source-cited)

| Option | Static in docs | Live view | Cost here |
|---|---|---|---|
| Mermaid flowchart | Yes; GitHub renders fenced blocks | Weak; interaction is limited | Text output, no runtime |
| Graphviz DOT | Via SVG or PNG render step | Weak | Needs the `dot` binary; SVG is not diffable |
| D3 / cytoscape.js | Needs a rendered artifact | Strong | JS bundle or app; new dependency |

## 2. Existing tooling

No existing renderer or DAG visualizer was found. `mermaid|graphviz|cytoscape|d3.|dagre|visualiz|dag` across the repo matched only design docs and one probe transcript — no renderer. Omo runtime skills cover imagegen/bun/memory only.

## 3. Can the 113 live-probe JSONL drive a renderer?

No — `results.jsonl` records invocations and dispatches, not milestone dependency edges. The renderer should read ledger state (`scripts/ledger.mjs` `delegate()`/`validatePlan`, spine `get state()`): `milestones[]`, `completed_milestones`, `current_milestone`, `verification[id].verdict/is_stale`.

Limit: Piledriver's TASK_GRAPH is prose only, no structured schema — renderer works only for ledger-backed plans post-adoption.

## 4. Sketch: ledger JSON → Mermaid

Input (ledger state): `milestones[{id, dependencies[]}]`, `completed_milestones`, `current_milestone`, `verification`.

Rules: DONE if completed and not stale; ACTIVE if current; STALE if stale; else PENDING. Edges `dep --> id`.

```mermaid
flowchart LR
  m0["one<br/>DONE"]
  m1["two<br/>ACTIVE"]
  m2["three<br/>PENDING"]
  m0 --> m1
  m1 --> m2
  classDef done fill:#d4f7d4
  classDef active fill:#ffe8b0
  classDef pending fill:#eeeeee
  class m0 done
  class m1 active
  class m2 pending
```

## 5. Decisions needed

1. Static vs interactive.
2. Embedded mermaid block vs external SVG renderer (mermaid-cli).
3. Generator home: new `scripts/` file or skill.
4. Whether pre-adoption TASK_GRAPH prose also needs rendering (would need structured schema first).
