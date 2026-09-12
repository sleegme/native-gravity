# AGENTS.md

## Migration-stack scope (44D; not activated)

This branch prepares vNext only. The v0.4 sections below continue to describe
the released/default runtime; they do not govern an explicitly isolated vNext
validation context. In that context, use the vNext topology section below and
`docs/specs/vnext-architecture-contract.md`, especially sections 2-5 and 7.3.
Do not combine the two topologies or infer that this branch activates vNext.
44G must validate and activate the runtime and its topology documentation
together. If validation fails, neither is activated. Keep this PR Draft.

## Project intent

Native Gravity is a thin Antigravity-native orchestration plugin. Prefer Antigravity's native agent lifecycle, model tiers, workspaces, rules, and delegation primitives over custom runtime machinery.

## v0.4 architecture

v0.4 separates **user-selectable primary modes** from **internal specialists** and maps models to roles that fit their observed behavior instead of forcing every model through one Host shape.

### User-selectable primary agents

```text
User
├─ Bulldozer  — general Host / orchestrator
├─ Piledriver — plan-first strategist
└─ Excavator  — autonomous troubleshooter / deep repair owner
```

These three are peers. Piledriver and Excavator are not children of Bulldozer.

- **Bulldozer** owns general orchestration, routing, integration, verification, and final completion.
- **Piledriver** owns planning only: requirements, acceptance, task graph, dependencies, risks, and verification strategy. It may use Jaguar for read-only planning discovery and Zen for final plan-readiness review, but it does not implement project source.
- **Excavator** owns a bounded difficult problem end-to-end: investigate, reproduce, diagnose, repair, and verify. It is intentionally allowed to implement directly.

### Internal specialists

```text
Bulldozer
├─ Bobcat
│  └─ Strix Halo
├─ Puma
├─ Jaguar
├─ Steamroller
└─ Zen

Piledriver
├─ Jaguar  — planning discovery only
└─ Zen     — final plan-readiness review only
```

- **Bobcat** — ordinary implementation worker; Flash tier; may consult `strix-halo` when the Host-selected gate requires it.
- **Puma** — quick/writing worker for small, explicit, low-risk mechanical work; Flash tier; no nested delegation.
- **Jaguar** — read-only codebase discovery; Flash tier.
- **Steamroller** — read-only deep reasoning for architecture, ambiguity, trade-offs, and difficult decisions; Pro tier.
- **Strix Halo** — read-only Bobcat-local advice/check gate; Pro tier.
- **Zen** — independent non-mutating final review gate; Pro tier; may run verification commands to gather its own evidence. It reviews delivered work for Bulldozer and plan readiness for Piledriver.

## Routing principle

Choose by **kind of work**, not by apparent task size alone.

- factual discovery / locate existing behavior -> Jaguar
- small + clear + low-risk / writing / formatting / mechanical text/config -> Puma
- ordinary implementation -> Bobcat
- architecture / ambiguity / trade-off -> Steamroller
- independent completion review -> Zen
- plan-first user workflow -> Piledriver primary
- difficult autonomous diagnosis + repair user workflow -> Excavator primary

## Primary-mode boundaries

Bulldozer, Piledriver, and Excavator are independent entry points.

- Do not make Bulldozer spawn Piledriver or Excavator merely because their specialty is relevant.
- Piledriver returns a plan packet; it does not claim implementation completion. Its only children are Jaguar for bounded read-only planning discovery and Zen for final plan-readiness review.
- Excavator may edit because direct autonomous repair is the point of the role.
- Bulldozer remains the normal orchestration mode and delegates project edits to Bobcat or Puma.

## Bobcat Advisor gate

Bulldozer selects `ADVISOR_GATE: REQUIRED | NONE` for Bobcat.

- `REQUIRED` for substantive code/behavior/API/state/lifecycle/test work or materially uncertain implementation.
- `NONE` for clearly low-risk mechanical work when Bobcat is still the chosen worker.
- Puma exists specifically so most quick/writing work does not need to enter the Bobcat -> Strix Halo loop.

Bobcat may invoke `strix-halo` only. Strix Halo corrects through Bobcat, never instead of Bobcat.

## Evidence and completion

Across all roles:

- separate OBSERVED, INFERRED, and UNKNOWN
- verify current artifacts rather than trusting prior-agent claims
- do not treat a launched subagent, started test, or plausible patch as a completed transition
- keep handoffs compact and acceptance-linked
- converge or escalate instead of repeating materially similar loops

Bulldozer alone owns global completion in orchestrated mode. Piledriver owns only plan readiness and requires an observed current Zen `VERDICT: GO` before `PLAN READY`. Excavator owns completion of its explicitly bounded autonomous task.

## Model-adaptive policy

Do not constrain every model according to the worst-observed model.

v0.4 changes the role/model map, so the v0.3.3 global Gemini 3.1 Pro mutation deny is no longer valid: Excavator is expected to mutate project source. Model-specific guards must be reevaluated whenever a model is assigned a role with different authority.

Use targeted prompt/rule correction for role-specific failures. Do not add broad model-wide shell blacklists, custom coordination runtimes, or persistent state merely to force one model family to imitate another. A narrow role-scoped behavioral guard is acceptable when a reproduced failure cannot be controlled reliably by prose alone.

## Excavator shell boundary

Excavator is allowed to use `sudo` when privileged inspection or repair is relevant to its bounded task. The safety boundary is not "no sudo"; it is preventing missing authorization or broad side effects from becoming a new objective.

Excavator prefixes every shell command with `NTG_EXCAVATOR=1 `. The plugin's `PreToolUse` hook uses that explicit marker to reject a narrow set of reproduced failure modes while leaving other agents untouched:

- non-interactive sudo password injection or guessing
- alternate privilege-acquisition paths such as `su`, `pkexec`, or root SSH to localhost
- mining interactive shell history as an authentication source
- full-system upgrades used as exploratory troubleshooting

The guard deliberately does **not** block ordinary `sudo` diagnostics or task-relevant privileged repair. Excavator must still honor user-provided prohibitions, keep conclusions proportional to evidence, stop materially repetitive branches, and distinguish READ_ONLY, REVERSIBLE, and PERSISTENT_OR_DESTRUCTIVE effects. Persistent or destructive changes require an exact change description, backup where applicable, rollback path, and evidence-backed justification before execution.

This is a role-specific backstop for observed Excavator drift, not a general privilege sandbox or a replacement for the role prompt.

## Zen verification boundary

Zen may execute shell commands only to independently reproduce or verify evidence. It has no direct file-mutation tools.

Zen prefixes every verification command with `NTG_ZEN_VERIFY=1 `. The plugin's `PreToolUse` hook uses that explicit marker to reject common intentional shell-mediated mutation paths while leaving other agents' shell calls untouched.

This is a behavioral backstop for a known role-boundary failure, not a complete read-only shell sandbox. Do not generalize it into a model-wide mutation deny.

## Compatibility validation required

Earlier Native Gravity testing found that an Antigravity custom primary agent could fail to invoke subagents even when the Default agent could. v0.4 therefore treats **custom-primary delegation paths** as explicit runtime validation gates, not assumed capabilities.

Before calling v0.4 stable, verify:

1. Bulldozer is selectable as a primary agent.
2. Bulldozer can invoke Bobcat, Puma, Jaguar, Steamroller, and Zen.
3. Bobcat can invoke strix-halo and no other child.
4. Piledriver is selectable, remains planning-only, can invoke Jaguar and Zen but no implementation worker, and observes the current Zen verdict before `PLAN READY`.
5. Excavator is selectable, can edit, and is not blocked by a model-wide mutation guard.
6. Puma handles quick/writing work without ritual Advisor use.
7. Zen completion is based on an actually observed verdict.
8. Zen can run independent verification commands while common intentional source-mutation shell attempts are denied by the Zen marker guard.
9. Excavator-marked shell calls allow ordinary sudo diagnostics while rejecting the reproduced privilege-drift and full-upgrade paths without affecting other agents.

## Design rules

1. Native-first.
2. Primary modes are peers, not a hierarchy.
3. Keep the internal graph shallow.
4. Fit roles to model behavior before adding corrective harness weight.
5. Use Puma for quick/writing work instead of burdening Bobcat with unnecessary review ceremony.
6. Keep Jaguar factual and Steamroller decisional.
7. Keep Strix Halo read-only and Zen non-mutating.
8. Do not reintroduce a model-wide 3.1 Pro mutation deny while Excavator uses that model family for implementation.
9. Guard Excavator by effect and privilege-acquisition behavior, not by banning sudo itself.

## vNext topology preparation (isolated migration context only)

Prepared from `docs/specs/pre-vnext-v0.4-behavior-baseline.md` and
`docs/specs/vnext-architecture-contract.md`; legacy topology above is retained
for released-runtime context, not used as the authority for this preparation.

```text
User
  Steamroller
    Piledriver (planning, architecture, deep decisions when needed)
    Bulldozer (exactly one bounded milestone)
      Jaguar / Puma / Bobcat
                       Strix Halo (Bobcat-local gate)
    Zen (independent candidate verification)
    Steamroller ledger transition
```

- Steamroller is the sole supervisor, authoritative ledger writer and global
  completion authority. It does not implement project source or directly
  orchestrate workers. Ledger state, not conversation, is authoritative.
- Piledriver is advisory planning/architecture/deep decision only: no
  implementation, worker orchestration, project-state ownership or completion
  claims. Steamroller alone decides whether to adopt its proposal.
- Bulldozer receives one current-version milestone packet, delegates within
  that boundary and returns its result. It neither directly edits project
  source nor writes the authoritative ledger or claims project completion.
- NEEDS_DEEP goes through Bulldozer to Steamroller for possible Piledriver
  invocation. Bulldozer does not directly invoke Piledriver or Zen.
- Zen reviews independently for Steamroller, never as Bulldozer's child.
  Every P0 milestone requires current GO; there is no optional-review path.
  Steamroller first persists an immutable candidate/result_ref binding, then
  observes Zen's matching milestone, plan_version and result_ref before
  promoting the milestone and updating next_action.
- Worker READY and Strix ACCEPT are local signals, not milestone completion.
  Bulldozer DONE is a pre-review candidate, not verified or global completion.
- Material replanning ends active execution/review, increments plan_version,
  marks old verdicts STALE and clears active/completed milestone state.
  Retained milestones need fresh current-version review in dependency order;
  history remains evidence, never current completion authority.
- Global completion requires all current milestones verified, no blockers,
  no active execution/review and Steamroller's direct observation of evidence.

The minimum spine is connected in 44E. Jaguar, Puma and Strix Halo reconnect
in 44F without broader authority. Excavator remains a separate selectable
primary outside P0; recovery reconnection is post-44G. Instinct is future work.
This preparation does not implement those slices or grant missing capabilities.

Preserve native-first, shallow delegation, routing by work kind, model-adaptive
roles, OBSERVED/INFERRED/UNKNOWN, actual-result verification, compact handoffs,
coverage closure, effect classification and anti-bypass discipline. Keep
NTG_ZEN_VERIFY=1 and NTG_EXCAVATOR=1 guard behavior until validated replacements
are specified. The narrow runner owns exact model resolution and effort;
frontmatter must not guess exact model slugs.

Before activation, resolve and verify frontmatter authority and OQ-6
inheritCustomizations behavior. `agy plugin validate` or agent discovery alone
cannot prove these runtime boundaries. Unresolved authority blocks activation;
do not treat UNKNOWN, omitted fields or defaults as grants.
