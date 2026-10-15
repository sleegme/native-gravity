# Working on Native Gravity

## Product and governing specification

Build a small plugin around Antigravity's existing lifecycle, delegation,
workspace, rule, and model-tier facilities. Custom machinery is justified
only for the narrow runner and durable ledger, not a general workflow engine.
The vNext runtime (#134, slice 44G) is defined by
`docs/specs/vnext-architecture-contract.md`; consult it for authoritative
architecture decisions.

## Who owns what

Start project work with `ntg-vnext`. There is no native primary to select.
The default path for work spanning milestones is `scripts/spine.mjs`, which
loads role instructions from `agents/` and resolves exact models.

Steamroller supervises the project through that runner. It alone changes the
authoritative ledger and declares the project finished. It sends a single
milestone to Bulldozer instead of editing application sources or coordinating
specialists itself. On restart, use the ledger as authority, not chat history.

Piledriver supplies bounded proposals for planning, architecture, ambiguity,
and difficult trade-offs. It cannot implement, manage workers, own project
state, adopt its proposal, or announce completion. Steamroller chooses whether
to adopt the advice.

Bulldozer coordinates one milestone using the current packet version. Its
children are Jaguar, Puma, Bobcat, and Excavator. Bulldozer does not directly
modify application code, update the ledger, or announce project completion.
Its returned candidate still needs independent review.

Instinct offers a different framing when execution returns NEEDS_ALT. It is
runner-invoked advice, not a mandatory reviewer. It cannot implement, dispatch
workers, alter the ledger, adopt plans, or issue completion or review verdicts.
Record its response as advice; Steamroller decides what to use.

For NEEDS_DEEP, Bulldozer returns the question to Steamroller. Any subsequent
Piledriver call belongs to Steamroller, never Bulldozer.

Zen checks each P0 milestone for Steamroller independently of the execution
tree. Neither Bulldozer nor its children may call Zen. Persist the immutable
candidate with its assigned `result_ref` before requesting review. Promotion
needs a directly observed Zen GO for that candidate, milestone identifier,
and current `plan_version`.

Local signals have limited meaning: worker READY, Strix ACCEPT, and Bulldozer
DONE do not complete milestones or projects. To finish globally, Steamroller
must observe evidence for every current milestone, with no blocker and no
execution or review still active.

A material plan change first stops execution and review. Increment
`plan_version`, mark earlier verdicts STALE, and empty active and completed
milestone state. Retained work must earn new reviews under the new version,
following dependency order.

## Specialist selection

Route according to the operation, not just its size:

| Need | Recipient |
|---|---|
| Locate code or establish codebase facts | Jaguar, a read-only Flash worker |
| Explicit, small, low-risk edits, formatting, or writing | Puma, Flash, without child calls |
| Ordinary implementation | Bobcat, Flash |
| Hard diagnosis and repair within the milestone | Excavator, Flash |
| Planning or an unsettled architectural decision | Piledriver through Steamroller |
| Repeated failures needing a different causal framing | Instinct through Steamroller, using NEEDS_ALT |
| Independent milestone acceptance | Zen through Steamroller |
| Durable multi-milestone execution | Steamroller through the runner |

Excavator investigates, reproduces, determines the cause, repairs, and checks
the result within its assignment. It has no children and cannot call Zen.
It returns `ROOT_CAUSE`, `CHANGES`, `VERIFICATION_EVIDENCE`, `ROLLBACK`,
`RESIDUAL_RISK`, and `STATUS` to Bulldozer; READY or BLOCKED describes the
worker's local result, not project completion.

Strix Halo is Flash-tier, read-only advice for Bobcat. Bobcat can call
`strix-halo` and no other child. Corrections go back through Bobcat.
Bulldozer chooses `ADVISOR_GATE: REQUIRED | NONE` in Bobcat's assignment:
use REQUIRED for substantive behavior, code, APIs, state, lifecycle, tests,
or uncertain implementation. NONE is reserved for clearly mechanical,
low-risk work that still belongs with Bobcat. Most quick writing belongs
with Puma and does not need this advisor loop.

Zen uses Claude Sonnet 5.5 at High and has no mutation authority, although it
can run commands to independently check evidence.

Runner policy resolves exact models and effort rather than guessing slugs
from frontmatter: Steamroller and Bulldozer use Gemini 3.8 Flash at High;
Piledriver uses Claude Opus 5.5 at High. Zen is invoked natively on the same
policy table, resolving Claude Sonnet 5.5 at High. Instinct normally uses
Claude Sonnet 5.5 at High; switching it to Claude Opus 5.5 High requires
explicit escalation. Native workers retain their tier contracts.

## Evidence, convergence, and authority

Label statements OBSERVED, INFERRED, or UNKNOWN according to their support.
Read current artifacts and actual outputs before relying on another
agent's claim. A spawned worker, pending check, or plausible edit is not a
completed state transition. Hand back concise evidence tied to acceptance.
Change the diagnostic approach or escalate when similar failures stop
producing useful evidence. Honest BLOCKED termination requires the generic
harness gate, not merely an anticipated obstacle.

Reusable QA procedures belong under `skills/`. Reference those procedures
from assignments instead of rebuilding them in each packet.

Do not apply a weakest-model restriction to all models. Match the role and
authority to observed model behavior, and reconsider model-specific guards
when that authority changes. Correct targeted role instructions first;
do not add universal command blacklists, persistent coordination state, or
a custom runtime to make model families behave alike. A scoped backstop is
appropriate for a reproduced failure that prose cannot reliably control.
Excavator intentionally edits project sources; do not restore a blanket
Gemini mutation ban.

## Shell effects

Excavator marks every shell invocation with `NTG_EXCAVATOR=1 `. Its
PreToolUse check recognizes the marker rather than agent identity, leaving
other roles' commands alone. Relevant sudo inspection and repair remain
permitted. The denied effects are non-interactive password feeding or
guessing, credential extraction from shell history, alternate privilege
acquisition through su, pkexec, or localhost root SSH, and exploratory
whole-system upgrades.

Missing authorization must not become a new objective. Honor the user's
prohibitions, make claims proportionate to evidence, and abandon repetitive
diagnostic branches. Classify effects READ_ONLY, REVERSIBLE, or
PERSISTENT_OR_DESTRUCTIVE. Before persistent or destructive work, specify the
exact operation, justify it with evidence, arrange a backup when relevant,
and supply a rollback route. The guard limits reproduced drift; it neither
implements a general sandbox nor replaces the role instructions.

Zen marks all evidence-checking shell calls with `NTG_ZEN_VERIFY=1 `. Its
PreToolUse boundary denies common deliberate shell mutation while leaving
unmarked calls unaffected. Verification commands are allowed, direct file
mutation tools are absent. Treat this as a narrow behavioral control, not a
complete read-only sandbox or universal model restriction.

The removed plugin Stop gate belonged to Excavator's former native-primary
role. Today's repair worker checks its own work and returns to Bulldozer;
Steamroller separately owns Zen review. Likewise #137's former
`inheritCustomizations: true` choice no longer applies after worker demotion.
Worker definitions omit `inheritCustomizations`.

## Release evidence required

Exercise actual delegation paths rather than assuming configuration works:

1. Drive the runner across Steamroller, Piledriver, Bulldozer, and Zen.
   Promote only after observing Zen's matching GO.
2. Check dependency-ordered promotion across multiple milestones, then a
   material replan that versions the plan and rechecks retained work.
3. Demonstrate that Zen NO-GO leaves work incomplete and a repaired
   candidate needs a new GO.
4. Resume in a fresh context using durable ledger state.
5. Demonstrate Bobcat's Strix call and rejection of other child roles.
6. Delegate difficult repair from Bulldozer to Excavator; observe edits,
   zero child invocations including Zen, and the returned worker result.
   Confirm delegation permits Excavator but rejects non-worker roles.
7. Let Zen execute verification and demonstrate denial of common deliberate
   source mutations under its marker.
8. Let Excavator perform normal sudo diagnosis and demonstrate denial of
   reproduced privilege drift and system upgrades under its marker, without
   imposing those denials on other roles.

Keep the graph shallow: Steamroller's two explicit branches for planning
and milestone execution must not grow into an open-ended coordinator.
Jaguar remains factual; Piledriver and Instinct remain advisory.
Strix stays read-only, Zen stays non-mutating, and Excavator owns autonomous
repair only within the delegated milestone. Guard sudo by its effects and
privilege behavior, not by forbidding sudo itself.
