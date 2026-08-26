# Architecture

Native Gravity v0.3.1 remains intentionally not a second agent runtime. It is a thin orchestration and behavioral-harness layer loaded into Antigravity's existing runtime.

```text
User
  |
  v
Antigravity Default agent / Host
(recommended: Claude Sonnet 4.6)
  + rules/harness.md
  + rules/orchestration.md
  |
  |-- gravity-worker / flash
  |      bounded implementation owner
  |        |
  |        `-- gravity-advisor / pro
  |               read-only ADVISE / CHECK gate when Host requires it
  |
  |-- gravity-explorer / flash
  |      read-only current-state discovery
  |
  |-- gravity-deep / pro
  |      diagnosis, ambiguity, trade-offs
  |
  `-- gravity-reviewer / pro
         independent read-only verification
```

## Why v0.3.1 is Worker-driven

The first real v0.3 harness exercise exposed a topology mismatch. Advisor correctly modeled the implementation problem but then began executing the work itself while delegated execution was still pending. The role prompt already prohibited source edits; the more important problem was structural ownership.

v0.3.1 therefore makes Worker the implementation owner and moves the nested delegation edge:

```text
v0.3:   Host -> Advisor -> Worker
v0.3.1: Host -> Worker -> Advisor
```

Advisor is now a read-only local consultant and gate. It can tell Worker what is wrong, but it cannot fix the problem itself.

The design invariant is:

> Advisor corrects through Worker, never instead of Worker.

## Risk-gated Advisor fast path

The local Pro-tier gate is not useful for every task. v0.3.1 therefore makes Advisor use Host-selected rather than universally mandatory.

Every Worker packet selects:

- `ADVISOR_GATE: REQUIRED`
- `ADVISOR_GATE: NONE`

The Host owns this classification. Worker cannot weaken or reinterpret it.

Use `REQUIRED` for substantive code/behavior/test/runtime/configuration work, multi-criterion acceptance, Reviewer repairs, and work where correctness depends on interpretation. If the classification is materially uncertain, use `REQUIRED`.

Use `NONE` for clearly low-risk mechanical work such as straightforward writing/rewrite, formatting, presentation-only changes, or text-only documentation edits with explicit supplied content. `NONE` skips the Pro-tier ritual but not verification: Worker still checks the current artifact against the Host contract.

There is intentionally no `OPTIONAL` value because it would transfer gate-selection authority back to Worker.

## Role and model separation

| Component | Contract | Current model policy |
| --- | --- | --- |
| Host | Global routing, gate selection, arbitration, final completion | active Antigravity session model; Sonnet 4.6 recommended |
| Worker | Own bounded implementation, edits, focused verification, Host-selected Advisor loop | `flash` / Gemini 3.7 Flash |
| Advisor | Read-only implementation advice and local acceptance gate when selected | `pro` / Gemini 3.1 Pro |
| Explorer | Read-only current-state discovery | `flash` / Gemini 3.7 Flash |
| Deep | Resolve diagnosis/design uncertainty | `pro` / Gemini 3.1 Pro |
| Reviewer | Independent final quality gate | `pro` / Gemini 3.1 Pro |

Role contracts remain separate from exact model identity. A future model swap should not require changing the graph unless runtime behavior demonstrates a new structural failure.

## Native-first boundary

Antigravity owns:

- the primary agent
- custom-agent discovery
- `invoke_subagent`
- subagent lifecycle
- workspace handling
- sessions
- tool permissions and sandboxing
- model-tier resolution
- plugin rule loading

Native Gravity owns:

- orchestration/routing rules
- specialized subagent role definitions
- task contracts passed through prompts
- evidence and completion discipline
- Host-selected local Advisor gate
- Deep escalation criteria
- independent Reviewer policy

No wrapper CLI, custom runner, durable mailbox, or replacement state machine is introduced.

## Host policy

Main remains policy, not a custom agent. Antigravity's Default agent is the Host.

For ordinary implementation, Host sends Worker an explicit bounded contract containing the useful subset of:

- `ROLE_REASON`
- `GOAL`
- `SCOPE`
- `NON_GOALS`
- `ACCEPTANCE`
- `EVIDENCE`
- `EDIT_POLICY`
- `ADVISOR_GATE`
- `EXPECTED_OUTPUT`

Host does not need to pre-decompose every edit. Worker owns execution inside that contract.

## Worker

Worker is the implementation owner and the only nested delegator.

Under `ADVISOR_GATE: REQUIRED`, Worker may invoke `gravity-advisor` only and uses Advisor in two modes:

- `ADVISE` — bounded implementation-local judgment
- `CHECK` — mandatory current-state local acceptance gate before Worker may report `READY`

Under `ADVISOR_GATE: NONE`, Worker does not invoke Advisor merely for confirmation; it performs bounded self-verification and may report local `READY` when the Host contract is evidenced.

Worker remains responsible for all source edits and focused verification across correction cycles.

## Advisor

Advisor is read-only and does not invoke subagents. It is not a universal mandatory hop; the Host decides whether a Worker task uses the local Advisor gate.

In `ADVISE` mode it returns bounded guidance or `NEEDS_DEEP`.

In `CHECK` mode it inspects the current artifact and returns:

- `VERDICT: ACCEPT`
- `VERDICT: REVISE`
- `NEEDS_DEEP`

`VERDICT: REVISE` must identify concrete acceptance-linked defects for Worker to repair. Advisor does not perform the repair.

`VERDICT: ACCEPT` authorizes only Worker's local `READY`; it is not global completion and does not replace Reviewer.

## Deep

Deep is defined by uncertainty, not generic complexity:

```text
large but mechanical edit -> Worker
small change with unknown race-condition cause -> Deep
```

Deep is read-only and returns diagnosis plus a bounded implementation direction. Host then routes implementation back to Worker.

## Explorer

Explorer is a direct Host read-only specialist for factual discovery: where behavior lives, which files/symbols participate, what implementation exists, and what current evidence is available.

## Reviewer

Reviewer is independent, read-only, and blocker-focused. It receives the original/current task contract and current artifact/evidence rather than persuasive self-assessment from Worker or Advisor by default.

Advisor CHECK and Reviewer serve different purposes:

- Advisor improves and gates the bounded implementation loop when the Host marks it REQUIRED.
- Reviewer independently evaluates delivered work for the Host.

## Correction flow

Required local gate:

```text
Host
  |
  v
Worker implementation + focused verification
  |
  v
Advisor CHECK
  |\
  | REVISE -> Worker repair -> CHECK again
  |
  ` ACCEPT
      |
      v
   Worker READY -> Host -> Reviewer when required
```

Fast path:

```text
Host -> Worker implementation + self-verification -> READY -> Host
```

Repeated materially similar local failures escalate instead of looping indefinitely. Final completion remains Host-owned, and required independent Reviewer approval remains separate from the local Advisor gate.
