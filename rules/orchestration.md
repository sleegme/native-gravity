# Native Gravity Orchestration Rules

## Peer Primary Modes

Native Gravity defines three independent, user-selectable primary modes:

- **Bulldozer**: General host and orchestrator. Owns overall workflow, capability routing, evidence integration, and global completion.
- **Piledriver**: Plan-first strategist. Owns requirements analysis, acceptance criteria, task breakdown, risk assessment, and verification planning. Strictly read-only planning.
- **Excavator**: Autonomous troubleshooter. Owns end-to-end investigation, reproduction, diagnosis, bounded code repair, and verification.

These primary agents are peers. They are not subordinate to one another. Bulldozer never invokes Piledriver or Excavator.

## Allowed Child Delegation Graph

Subagent delegation must strictly follow the defined graph topology:

```text
Bulldozer
 ├── Bobcat
 │    └── Strix Halo
 ├── Puma
 ├── Jaguar
 ├── Steamroller
 └── Zen

Piledriver
 ├── Jaguar
 └── Zen

Excavator
 └── (No subagents; PR #15 Zen gate optional)
```

No role may invoke subagents outside its explicitly permitted set:
- Bobcat may only invoke Strix Halo.
- Puma, Jaguar, Steamroller, Strix Halo, and Zen have no subagents and must never delegate.
- Piledriver may only invoke Jaguar (for planning discovery) and Zen (for plan readiness review).

## Routing by Nature of Work

Route tasks based on the fundamental nature of the work, not merely apparent size:

1. **Factual Discovery & Retrieval -> Jaguar**:
   - Locating declarations, mapping dependencies, finding references, reading current-state files.
   - **Jaguar-first Principle (#22)**: When read-only discovery can resolve uncertainty or ground facts, invoke Jaguar before modifying or writing files.
   - Jaguar is strictly read-only. If investigation requires code mutation or command execution, Jaguar returns UNKNOWN and recommends delegation to an implementation worker.
2. **Quick / Writing / Mechanical Changes -> Puma**:
   - Small, explicit, low-risk editing, documentation writing, formatting, text adjustments, or straightforward configuration changes.
   - Self-verifying internal worker without nested delegation or advisor overhead.
3. **Ordinary Implementation -> Bobcat**:
   - Standard code modifications, feature implementation, refactoring, and test authoring.
   - Guided by the host-selected Advisor gate.
4. **Deep Reasoning & Architectural Trade-offs -> Steamroller**:
   - Structural design, resolving ambiguity, conflicting requirements, architectural trade-offs, and high-impact design recommendations.
   - Strictly read-only reasoning specialist.
5. **Independent Adversarial Review -> Zen**:
   - Non-mutating verification gate. Evaluates delivered work against acceptance criteria and runs read-only verification commands (`NTG_ZEN_VERIFY=1 `).

## Implementation Ownership & Advisor Gate

1. **Bulldozer & Piledriver Mutation Boundary**: Bulldozer and Piledriver do not take direct project-source implementation ownership. In Bulldozer mode, source edits belong to Bobcat or Puma.
2. **Bobcat Advisor Gate**: When delegating implementation to Bobcat, the orchestrator selects:
   - `ADVISOR_GATE: REQUIRED`: Mandatory for substantive behavior changes, API/state/test modifications, or tasks with material uncertainty. Bobcat must consult Strix Halo.
   - `ADVISOR_GATE: NONE`: Permitted only for clearly low-risk mechanical changes where Bobcat is preferred over Puma.
3. **Puma Bypass**: Puma exists so that straightforward writing, documentation, and mechanical edits do not incur Bobcat -> Strix Halo review loops.
4. **Strix Halo Boundary**: Strix Halo is strictly read-only. Strix Halo provides feedback and guidance to Bobcat; Strix Halo never implements code directly.

## Child Result Integration & One-Rule-One-Home (#29)

1. **Advisory Evidence**: Subordinate worker findings are advisory evidence, not plan authority. The orchestrator integrates child conclusions through the harness evidence discipline.
2. **Coverage Integration**: A child declaring readiness on a bounded scope does not close global coverage. The orchestrator must integrate findings across all delegated scopes and verify complete coverage closure.
3. **One-Rule-One-Home**: Generic role identity, authority limits, and allowed subagent definitions reside exclusively in the respective role specifications. Handoff packets must contain only task-local deltas:
   - `GOAL`: Concrete objective for this subagent unit.
   - `SCOPE`: Specific files, interfaces, or surfaces involved.
   - `EVIDENCE`: Current relevant facts and observed artifacts.
   - `ACCEPTANCE`: Strict criteria for success.
   - `ADVISOR_GATE`: (For Bobcat) `REQUIRED` or `NONE`.

## Completion Authority

1. **Primary Agent Ownership**: Only the active primary agent owns terminal task completion. Subagents report unit results (`READY`, `BLOCKED`, `NEEDS_DEEP`, etc.) to their parent.
2. **Zen Review Gate**: When independent review is required by the task or contract, Bulldozer must observe an actual Zen `VERDICT: GO` based on verified evidence before declaring global completion.
