# Architecture

[한국어](ko/architecture.md) · [Usage](usage.md) · [Internals](internals.md)

## Design intent

Native Gravity makes multi-step work understandable through a plan, saved
progress and independently checked results. Users supply goals and boundaries;
the product hides the choice and coordination of internal agents. More internal
roles should not mean more roles for the user to learn.

The current design is called vNext in implementation records. It is the shipped
runtime, not a second product mode or a future option users need to select.
The [contract](specs/vnext-architecture-contract.md) is the normative source;
this page explains why the structure exists rather than repeating its fields.

## Keep Antigravity native

Antigravity owns agent execution, sessions, workspaces, models and tool
permissions. NTG supplies role contracts, work routing, milestone sequencing
and progress ownership. A narrow coordinator invokes the critical roles with
explicit model policies; specialists remain native Antigravity subagents.
This preserves the host's capabilities without creating a general workflow
platform.

## Separate execution from completion

```text
User's plan
  -> progress owner chooses one eligible step
  -> bounded execution produces a candidate
  -> independent review checks the candidate and criteria
  -> progress owner records verification or repair needs
  -> next step, or project completion
```

The executor cannot turn its own confidence into completion. Local worker
checks help implementation, but the independent milestone review is a separate
authority. Keeping these responsibilities separate prevents a delegated “done”
claim from silently becoming a project-level success.

Each step carries its objective, permitted scope, exclusions and acceptance
criteria. Routing depends on the kind of work, not just its apparent size:
discovery, mechanical edits, ordinary implementation and difficult diagnosis
need different execution behavior. The names and permissions of those roles
are implementation detail in [Internals](internals.md#role-ownership-and-routing).

## Save progress outside conversation

The ledger records the adopted plan, dependencies, evidence, reviews, blockers
and next action. A fresh process resumes from that state instead of relying on
conversation memory. Only one milestone executes or undergoes review at a
time, and one owner writes authoritative progress.

Review belongs to a specific candidate and plan version. A changed candidate
needs a new review. A material replan invalidates prior completion authority:
retained milestones are checked again in dependency order, while old evidence
remains history. This costs revalidation but avoids applying an old approval
to a new contract.

Planning and alternate-framing advice remain advisory. They may help the user
revise a plan, but advice alone neither adopts it nor completes a step.

## Implemented design and remaining questions

Milestone execution, independent review, material replanning, fresh-context
resume, Linux crash recovery and alternate-framing advice are implemented.
Their validation scope and limitations are recorded in [Status](status.md);
they are not broad reliability or performance claims.

A natural-language goal-to-adopted-plan interface is not implemented. Users
currently write a plan file. Exact-model Zen is an unresolved comparison
question, not an announced feature or a required user setting. Model profiles
are provisional research, not deployed routing changes.

For named topology, model resolution, packet validation and recovery mechanisms,
read [Internals](internals.md). For the completed activation/transition record,
read [Internals' migration orientation](internals.md#activation-and-transition-record)
and [Status history](status.md#release-and-migration-history). The historical
implementation slices in Specs are not a pending roadmap.
