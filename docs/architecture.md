# Architecture

[한국어](ko/architecture.md) · [Usage](usage.md) · [Internals](internals.md)

## Design intent

Native Gravity makes multi-step work easy to follow by giving it three things: a
plan, saved progress and results that someone else has checked. Users bring the
goals and the boundaries. Choosing and coordinating internal agents is the
product's job, and adding internal roles should never mean more roles for users
to learn.

Implementation records call the current design vNext. It's the runtime that
ships today, not a second product mode or a future option you have to switch on.
The [contract](specs/vnext-architecture-contract.md) is the normative source.
This page explains why the structure looks the way it does instead of repeating
the contract's fields.

## Keep Antigravity native

Antigravity owns agent execution, sessions, workspaces, models and tool
permissions. NTG brings role contracts, work routing, milestone ordering and
ownership of progress. A narrow coordinator calls the critical roles with
explicit model policies, while specialists stay native Antigravity subagents.
That way the host keeps all its capabilities and NTG doesn't grow into a
general workflow platform.

## Separate execution from completion

```text
User's plan
  -> progress owner chooses one eligible step
  -> bounded execution produces a candidate
  -> independent review checks the candidate and criteria
  -> progress owner records verification or repair needs
  -> next step, or project completion
```

However confident the executor is, that confidence can't turn into completion.
Local checks during the work help with implementation, but the independent
milestone review is a separate authority. Keeping the two apart stops a
delegated "done" from quietly becoming a project-level success.

Every step carries its objective, its allowed scope, what it excludes and its
acceptance criteria. Work is routed by what kind of work it is, not only by how
big it looks: discovery, mechanical edits, ordinary implementation and hard
diagnosis each call for different execution behavior. The names and
permissions of those roles are implementation details, covered in
[Internals](internals.md#role-ownership-and-routing).

## Save progress outside conversation

The ledger records the adopted plan, dependencies, evidence, reviews, blockers
and the next action. A fresh process picks up from that state rather than from
conversation memory. Only one milestone runs or is under review at a time, and a
single owner writes the authoritative progress.

A review belongs to one specific candidate and plan version. If the candidate
changes, it needs a new review. A material replan takes away the old completion
authority: kept milestones are checked again in dependency order, and the old
evidence stays as history. Revalidating costs something, but it means an old
approval never gets applied to a new contract.

Planning advice and alternate-framing advice stay advisory. They can help a user
revise the plan, but advice on its own never adopts a plan or completes a step.

## Implemented design and remaining questions

Milestone execution, independent review, material replanning, resuming in a
fresh context, Linux crash recovery and alternate-framing advice are all
implemented. [Status](status.md) records how far each was validated and where
the limits are; none of it is a broad claim about reliability or performance.

There's no interface yet that turns a natural-language goal into an adopted
plan, so users write a plan file for now. Exact-model Zen is still an open
comparison question, not an announced feature or a setting users need. Model
profiles are provisional research and haven't changed deployed routing.

For the named topology, model resolution, packet validation and recovery
mechanisms, read [Internals](internals.md). The completed activation and
transition record lives in
[Internals' migration orientation](internals.md#activation-and-transition-record)
and the [Status history](status.md#release-and-migration-history). The
historical implementation slices in Specs aren't a pending roadmap.
