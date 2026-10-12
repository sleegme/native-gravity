# AGENTS.md

## Project intent

Native Gravity is a thin Antigravity-native orchestration plugin. Prefer Antigravity's native agent lifecycle, model tiers, workspaces, rules, and delegation primitives over custom runtime machinery.

## vNext architecture

vNext is the runtime (44G, #134). The authoritative contract is `docs/specs/vnext-architecture-contract.md`.

### Runner topology

The narrow exact-model runner (`scripts/spine.mjs`, role bodies loaded from `agents/`) is the default entry for multi-milestone work:

```text
User
  Steamroller — supervisor / authoritative ledger owner
    Piledriver — bounded planning, architecture and difficult decisions
    Bulldozer — exactly one bounded milestone
      Jaguar / Puma / Bobcat
                       Strix Halo — Bobcat-local gate
    Zen — independent milestone verification
    Steamroller ledger transition
```

- **Steamroller** is the sole supervisor, authoritative ledger writer and global completion authority. It does not implement project source or directly orchestrate workers. Ledger state, not conversation, is authoritative. It is runner-invoked, not natively selectable.
- **Piledriver** is advisory planning/architecture/deep decision only: no implementation, worker orchestration, project-state ownership or completion claims. Steamroller alone decides whether to adopt its proposal.
- **Bulldozer** receives one current-version milestone packet, delegates within that boundary and returns a pre-review candidate. It neither directly edits project source nor writes the ledger or claims project completion.
- NEEDS_DEEP goes through Bulldozer to Steamroller for possible Piledriver invocation. Bulldozer does not invoke Piledriver.
- **Zen** reviews every P0 milestone candidate independently for Steamroller, never as Bulldozer's child. Steamroller persists an immutable candidate/`result_ref` binding, then observes Zen's matching milestone, `plan_version` and `result_ref` before promotion.
- Worker READY and Strix ACCEPT are local signals. Bulldozer DONE is a pre-review candidate, not verified or global completion.
- Material replanning ends active execution/review, increments `plan_version`, marks old verdicts STALE and clears active/completed milestone state; retained milestones need fresh current-version review in dependency order.
- Global completion requires all current milestones verified, no blockers, no active execution/review and Steamroller's direct observation of evidence.

The runner owns exact model resolution and effort (Steamroller/Bulldozer: Gemini 3.8 Flash High; Piledriver: Gemini 3.1 Pro High); frontmatter does not guess exact slugs.

### Natively selectable primary

```text
User (native agent selection)
└─ Excavator  — autonomous troubleshooter / deep repair owner, Zen completion gate
```

Natively selected primaries own only their bounded work. Multi-milestone work, durable ledger state, replanning and global project completion belong to Steamroller through the runner. Excavator remains outside the P0 spine; its recovery reconnection is post-44G.

### Specialists

- **Bobcat** — ordinary implementation worker; Flash tier; may consult `strix-halo` when the parent-selected gate requires it.
- **Puma** — quick/writing worker for small, explicit, low-risk mechanical work; Flash tier; no nested delegation.
- **Jaguar** — read-only codebase discovery; Flash tier.
- **Strix Halo** — read-only Bobcat-local advice/check gate; Pro tier.
- **Zen** — shared independent non-mutating review gate; Pro tier; may run verification commands to gather its own evidence. Steamroller uses it for milestone verification, and Excavator only as its final completion reviewer.

## Routing principle

Choose by **kind of work**, not by apparent task size alone.

- factual discovery / locate existing behavior -> Jaguar
- small + clear + low-risk / writing / formatting / mechanical text/config -> Puma
- ordinary implementation -> Bobcat
- planning / architecture / ambiguity / trade-off -> Piledriver (via Steamroller under the runner)
- milestone verification / independent completion review -> Zen
- multi-milestone project work -> runner (Steamroller)
- difficult autonomous diagnosis + repair user workflow -> Excavator primary

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
- artifact-specific verification procedures live in reusable QA skills (`skills/`); task packets reference rather than re-derive them

Only Steamroller declares global project completion. Excavator owns completion of its explicitly bounded autonomous task only after its own verification and an observed Zen `VERDICT: GO` for the current artifact. A genuinely BLOCKED task may terminate without Zen when the generic BLOCKED gate is satisfied.

## Model-adaptive policy

Do not constrain every model according to the worst-observed model.

Excavator is expected to mutate project source. Model-specific guards must be reevaluated whenever a model is assigned a role with different authority.

Use targeted prompt/rule correction for role-specific failures. Do not add broad model-wide shell blacklists, custom coordination runtimes, or persistent state merely to force one model family to imitate another. A narrow role-scoped behavioral guard is acceptable when a reproduced failure cannot be controlled reliably by prose alone.

## Excavator completion review boundary

Excavator performs diagnosis, repair, and local verification itself. Zen is not part of the diagnostic loop; it is an independent final check against the supplied task contract and the current artifact.

The plugin `Stop` hook backstops this boundary. On a normal Excavator stop it requires an observed Zen `VERDICT: GO`; a newer Zen invocation without a verdict, `VERDICT: NO-GO`, or a later direct write/marked Excavator shell call forces the execution loop to continue. A later write or marked shell call makes an older GO stale and requires fresh verification plus a fresh Zen review.

The hook deliberately permits a verified BLOCKED termination and abnormal runtime termination rather than manufacturing an infinite completion loop.

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

## Validation required

Custom-primary and runner delegation paths are explicit runtime validation gates, not assumed capabilities. Before a release, verify:

1. The runner drives Steamroller -> Piledriver -> Bulldozer -> Zen end to end, promoting a milestone only on an observed matching Zen GO.
2. Multi-milestone runs promote milestones in dependency order; material replanning increments `plan_version` and revalidates retained milestones.
3. A Zen NO-GO leaves the milestone incomplete and a repaired candidate needs a fresh GO.
4. A fresh-context resume continues from the ledger, not conversation.
5. Bobcat can invoke strix-halo and no other child.
6. Excavator is selectable, can edit, invokes Zen, and cannot complete READY without the current Zen verdict.
7. Zen can run verification commands while common intentional source-mutation shell attempts are denied by the Zen marker guard.
8. Excavator-marked shell calls allow ordinary sudo diagnostics while rejecting the reproduced privilege-drift and full-upgrade paths without affecting other agents.

## Design rules

1. Native-first; keep the runner and ledger narrow, not a general workflow platform.
2. Explicit two-level hierarchy under the runner: Steamroller -> (Piledriver | Bulldozer).
3. Keep the internal graph shallow.
4. Fit roles to model behavior before adding corrective harness weight.
5. Use Puma for quick/writing work instead of burdening Bobcat with unnecessary review ceremony.
6. Keep Jaguar factual and Piledriver advisory.
7. Keep Strix Halo read-only and Zen non-mutating.
8. Do not reintroduce a model-wide 3.1 Pro mutation deny while Excavator uses that model family for implementation.
9. Guard Excavator by effect and privilege-acquisition behavior, not by banning sudo itself.
10. Keep Excavator autonomous through diagnosis and repair, but require an independent Zen gate before READY.
11. Keep explicit `inheritCustomizations: true` on native Excavator (#137) to preserve workspace instructions; inherited context is not an authority grant.
