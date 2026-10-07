# Issue #17: Piledriver task-graph exploration

Date: 2026-10-07

Inspected baseline: `28f70c9` (`origin/main` at exploration time)

Scope: repository inspection and this evidence document only; no runtime changes or PR.

## Recommendation

Keep Piledriver's human-readable TASK_GRAPH and add an explicit, versioned node/dependency representation as a planning artifact.
Validate that representation statically first; put any bounded execution driver alongside Piledriver under the authorized execution owner, using native delegation.
Use current, artifact-bound Zen evidence for node promotion, preserve final integration review and human gates, and do not activate vNext or concurrent milestones through issue #17.

This is a design recommendation, not an implemented scheduler or a claim that native parallel execution has been validated.

## 1. What the textual TASK_GRAPH does today

**OBSERVED:** `agents/piledriver.md:33-43` requires a planning packet containing GOAL, ACCEPTANCE, TASK_GRAPH, OWNERSHIP_SUGGESTION, RISKS_AND_UNCERTAINTY, RECOMMENDED_VERIFICATION, and PLAN_STATUS. TASK_GRAPH is defined as "ordered tasks plus parallelizable groups and dependencies." Piledriver grounds the requested target before closing acceptance or the graph, distinguishes observed facts from inference and unknowns, and leaves discovery-dependent decisions unresolved rather than inventing runtime details.

Its graph is part of a plan, not permission to execute. `agents/piledriver.md`, sections "Task intake", "Planning children", and "Boundaries", restrict it to Jaguar discovery and Zen plan-readiness review. An execution request still produces a handoff plan. Current Zen GO is required for PLAN READY; a plan revision or a newer pending review invalidates older readiness.

**Search evidence:** regex `TASK_GRAPH|task.graph|task graph|DAG` over `rules/`, `scripts/`, and `docs/` found:

- `rules/`: no matches across the two rule files. Reading both shows contract, delegation, parallel non-conflicting work, evidence, correction, and human-boundary policy, but no TASK_GRAPH parser or graph scheduling protocol.
- `scripts/`: no matches across eight script files. This is a textual-search result, not proof that dependency handling is absent: `scripts/ledger.mjs` uses `milestones` and `dependencies`, discussed below.
- `docs/`: twelve matches in twelve files. Current references include `docs/architecture.md:32`, `docs/usage.md:37`, `docs/status.md:24`, `docs/ko/status.md:23`, and `docs/versioning.md:27`. The remaining matches are in the vNext contract or its isolated snapshot.

`docs/architecture.md` calls the packet "executable", but the inspected Piledriver definition and `scripts/ntg-run.mjs` do not define a machine-consumed TASK_GRAPH schema. Here, "executable" means sufficiently decided for an implementer to act, not automatically scheduled.

**Strengths (INFERRED):**

- Human-readable ordering, rationale, unresolved branches, and suggested ownership remain easy to inspect and revise.
- Flexible prose accommodates discovery, uncertain decisions, and tasks whose verification differs.
- Planning authority stays separate from implementation and completion authority.

**Limits (INFERRED from the inspected interfaces):**

- No stable node IDs, edge schema, graph-version binding, or runtime TASK_GRAPH consumer makes the textual packet directly schedulable.
- Parallel groups are suggested by the planner; there is no automatic ready-set discovery or concurrency bound for this packet. Manual parallel delegation already exists in policy.
- No mechanical TASK_GRAPH dependency verification rejects a dangling edge, cycle, or downstream launch before a prerequisite is verified. Zen can review such problems semantically, which is not the same as structural enforcement.
- Prose alone cannot durably correlate each planned unit with its attempts, candidate artifacts, evidence, and applicable verdict.

These limits apply to textual TASK_GRAPH, not to every NTG surface.

## 2. Executable-DAG shape and meaning

**PROPOSED:** represent a graph as a versioned plan whose tasks are nodes and whose prerequisite relationships are directed edges. Define `B.dependencies = [A]` to mean A must be verified before B may start. Keep prose explaining the goal, decisions, and unknowns alongside that representation; avoid two independently maintained sources of truth.

At minimum, each node needs:

| Field | Purpose |
| --- | --- |
| `id`, `dependencies` | Stable identity and explicit prerequisites within this plan version |
| `objective`, `bounded_scope`, `non_goals` | One coherent output with clear authority and stop conditions |
| `acceptance_criteria`, verification requirements | Observable completion and required evidence |
| Suggested role and applicable gate | Route by kind of work without granting new role authority |
| Input/output artifact references | Bind downstream work to actual prerequisite results |

Goal, constraints, authoritative sources, and `plan_version` belong to the graph-level contract. Execution state belongs to the execution owner, not to the planning document: pending, running, candidate awaiting review, verified, failed, or blocked, with attempt identity and evidence references. These names are illustrative, not a new NTG status protocol. The first three rows substantially overlap the existing milestone representation in `scripts/ledger.mjs:746-768`.

A bounded unit is not an arbitrary tiny edit or an entire open-ended project. It has one acceptance-linked result, a permitted scope, necessary inputs, and a clear return condition. A unit that needs unresolved discovery should depend on discovery and subsequent planning/adoption, rather than silently resolving unknown architecture inside a worker.

### Static verifier versus runtime scheduler

- **Static verifier:** checks the shape, unique IDs, existing dependency targets, self-edges and cycles; reports a topological order and potential parallel layers. It can also require contract fields. It cannot prove a dependency was actually completed or that the planner identified every semantic dependency.
- **Runtime scheduler:** computes the eligible set from current verified prerequisites, dispatches through authorized native execution paths, respects a concurrency cap and resource conflicts, records results, and blocks downstream work on failed or pending-review prerequisites.
- **Both:** structural validation before dispatch plus state-dependent verification during execution makes a graph executable in the operational sense. A static-only artifact is machine-verifiable and execution-ready, but is not itself a running scheduler.

Recommend the static verifier as the first increment. It offers dependency checks without creating a new coordination runtime. Operational scheduling should follow only when native invocation, result delivery, authority, and resource ownership have been validated.

Parallelism discovery is a ready-set calculation, not simply "no direct edge between two nodes." Eligible nodes must have all required prerequisites verified, available authority, and no conflicting write/resource claims. For example, after verified discovery A, implementation B and documentation C might be eligible together; integration D depends on both. B and C must still serialize if their outputs share mutable files or runtime state. Dispatch at most the configured number of eligible, non-conflicting units; a cap of one remains a valid dependency-aware execution mode.

## 3. Fit with NTG's current flow

**OBSERVED, default flow:** `AGENTS.md` and `rules/orchestration.md` define peer primary modes. Piledriver plans; Bulldozer owns orchestration, integration, verification, and global completion; Excavator owns its explicitly bounded repair task. Piledriver is not a Bulldozer child and cannot invoke implementation workers.

`scripts/ntg-run.mjs` is a thin wrapper: it consumes optional `--ledger` to acquire a ledger lock, adds an NTG_ROLE marker for gated roles when needed, spawns one `agy` process, forwards signals, and releases the lock on exit. It neither parses TASK_GRAPH nor selects or dispatches graph nodes. The lock is ownership exclusion, not a scheduler.

**OBSERVED, isolated vNext machinery:** NTG already contains a partial executable dependency-graph foundation:

- `scripts/ledger.mjs:625-697`, `validatePlan`, rejects duplicate milestone IDs, missing dependency targets, self-dependencies, and cycles.
- `scripts/ledger.mjs:806-850`, `delegate`, accepts a caller-selected milestone only when all dependencies are completed and no milestone is active. Initial `next_action` suggests the first dependency-free milestone, not all available parallel work.
- `scripts/spine.mjs:245-257`, `requestPlan`, returns advisory Piledriver output. Explicit supervisor adoption changes state.
- `scripts/spine.mjs:261-374`, `runMilestone`, executes a bounded Bulldozer contract, persists its candidate, requests independent Zen review, and records the matching verdict.
- `MinimalSpine` is explicitly isolated 44F machinery, not default activation. Its busy/current-milestone checks and the ledger's singular `current_milestone` serialize milestones. `package.json` does not include spine, runner, or ledger in the published file list.
- The spine warns that specialist-adapter checks are advisory for native runs: native delegation is not intercepted, and declared delegations are checked post hoc. A future scheduler cannot treat those checks as proof of every actual child launch.

**Recommendation (INFERRED):** the graph's definition belongs inside Piledriver's planning packet; its execution driver belongs alongside Piledriver, under the execution owner's authority. If choosing where the *executable machinery* sits, choose alongside.

Putting worker scheduling inside Piledriver would contradict its tools, planning-only boundary, and prohibition on implementation workers. A separate heavyweight NTG runtime would also conflict with `AGENTS.md`'s native-first design. Prefer a small validated contract and an execution-owner adapter around native delegation, not shell commands embedded in graph nodes or another agent lifecycle.

In default v0.4, an explicit user-authorized handoff gives Bulldozer the reviewed plan; Piledriver stops at readiness. The adapter would support Bulldozer rather than promote Piledriver into a runner. In an explicitly activated future vNext flow, Steamroller would adopt Piledriver's proposed graph, own its ledger, and issue bounded milestones to Bulldozer. `docs/specs/vnext-architecture-contract.md`, sections 1.1 and 2.1-2.3, defines that separation; it does not authorize silently changing the current topology.

Concurrent milestones would be a separate contract change: the present vNext contract hands off one milestone at a time, and the implementation stores one active milestone. Discovering potential parallelism can initially remain advisory, or guide non-conflicting worker units within a milestone, without rewriting that contract.

## 4. Per-node verification through Zen

**OBSERVED:** default Zen returns GO/NO-GO to the requesting primary and checks the complete governing contract, not worker confidence (`agents/zen.md`). The default planning packet does not associate a Zen verdict with each TASK_GRAPH node.

The contrast is not universally "whole-run review only": isolated vNext already reviews each milestone. Zen's packet includes `milestone_id`, `plan_version`, `result_ref`, verdict, and observed verification evidence. Changed artifacts require a new candidate and review. The spine checks these identifiers and observed evidence before recording GO; Zen neither writes the ledger nor promotes milestones.

**PROPOSED:** adopt that binding principle for reviewable graph nodes:

1. The execution owner supplies the original governing acceptance contract, the node's bounded contract, prerequisite artifacts, and the immutable candidate.
2. The owner records a result reference bound to node identity, graph/plan version, and attempt/candidate. Launch acknowledgement, worker READY, and Strix ACCEPT remain insufficient.
3. Zen independently checks node acceptance and returns evidence tied to that exact candidate. A required current GO permits owner-controlled promotion and unblocks dependents.
4. NO-GO leaves the node incomplete; repair produces a new candidate and a fresh review. Unknown material evidence remains explicit.

This permits localized defect attribution and recovery rather than rerunning unrelated verified work under an unchanged plan. Review granularity should follow independently meaningful acceptance boundaries, not every tool call; low-risk child readiness need not introduce extra Zen ceremony beyond existing policy.

All required nodes being green still does not establish full-run acceptance. A final integration/coverage check must verify that the graph covers the original goal and that composed outputs satisfy cross-node requirements. A missing node or semantic dependency can leave every enumerated node green while the user contract fails. Zen remains the independent gate, and the authorized primary/supervisor retains completion ownership.

## 5. Failure modes and recovery

| Failure | Required behavior | Existing evidence / remaining design |
| --- | --- | --- |
| Cyclic or dangling dependencies | Reject before dispatch; report the offending nodes/edges so Piledriver can revise the plan. Do not call an invalid graph "ready". | Isolated `validatePlan` already checks missing targets, self-edges, and cycles. Reporting a concrete cycle path would be a proposed usability addition. |
| Partial failure or NO-GO | Preserve verified independent results under the unchanged plan; block descendants; route repair only through the authorized owner. Resume from recorded evidence, not inferred success. | `runMilestone` records BLOCKED/NEEDS_DEEP or invocation failure; matching Zen NO-GO does not verify the milestone. Retry policy is not supplied by the DAG alone. |
| Interruption or duplicate dispatch | Record active attempts and exclusive ownership; inspect interrupted state before rerunning effects. A graph does not make mutations idempotent. | The current spine has a ledger lock, serialized execution, and `endInterruptedInvocation` requiring observed interruption evidence. Concurrent scheduling needs explicit per-unit ownership, not just a global cap. |
| Scope change makes the graph stale | Stop new dispatch; route material replanning to Piledriver; adopt a new version explicitly; reject late results and verdicts from older versions. | `materialReplan` refuses an active milestone, increments version, stales existing verification, clears completion, and preserves history (`scripts/ledger.mjs:1305-1448`). Retained milestones require fresh passes in dependency order. |
| Parallel units share mutable state | Serialize overlapping writers/resources or use a validated isolation and integration mechanism; graph independence alone is insufficient. | `rules/harness.md`, "Action discipline", permits parallelism only for non-conflicting scopes. Native concurrency behavior was not exercised in this exploration. |
| A prerequisite was omitted or acceptance weakened | Preserve source authority and original acceptance; review coverage and composition, not merely structural validity. | Harness coverage and review-basis rules already require this; a static verifier cannot infer missing semantic work. |

For material replans, do not promise selective preservation of GO: the inspected ledger deliberately invalidates all existing verification. Reuse evidence as history, then reverify under the new plan. More selective invalidation would need a separately justified contract.

**UNKNOWN:** the ledger's delegation comment identifies open blocker policy as issue #93: global stop versus blocking only affected milestones is not settled there. A future DAG proposal must make that policy explicit; it should not silently resolve it by assuming independent branches always continue. Exact concurrency limits, native child cancellation semantics, and isolation guarantees also remain unvalidated here.

## 6. What a DAG does not replace

- **Piledriver planning authority:** target grounding, requirement interpretation, acceptance, architecture decisions, uncertainty, and material replanning. A scheduler follows an adopted graph; it cannot broaden scope or invent missing decisions.
- **Zen review:** static acyclicity and successful process exits cannot replace independent, current artifact verification. Piledriver's plan-readiness GO is not implementation GO.
- **Human gates:** scope changes, new authorization, consequential external actions, and human-only steps stay subject to the original contract and harness boundaries. Eligibility is not permission.
- **Native lifecycle and role topology:** native agents, models, workspaces, tools, delegation, and current role permissions remain authoritative. A node label cannot grant a role new tools.
- **Execution-owner judgment and final integration:** routing, repair classification, evidence freshness, coverage closure, and completion ownership remain with the current authorized primary or explicitly activated supervisor.

## Evidence limits and next decision

This document is based on reads and repository searches, not a live DAG execution. No runtime tests, AGY invocations, or new scheduler benchmarks were run; no code behavior changed. References to isolated vNext describe inspected code and contracts, not an activation claim.

The smallest follow-up is a separate proposal for a versioned structured TASK_GRAPH contract and static validation, retaining human-readable planning output. Runtime dispatch and concurrency should be separate validated increments, reusing the existing milestone/Zen binding concepts where applicable rather than introducing a second ledger. This exploration does not settle issue #93 or authorize an implementation.
