# Issue #16: bounded Ralph-style convergence for NTG

- Date: 2026-10-07
- Basis: repository `28f70c9`, default v0.4 role contracts
- Status: exploration and recommendation, not implementation or policy approval

## Decision for the PO

Recommend an **opt-in Bulldozer-internal convergence driver**, with the existing
`Stop` completion gate as its continuation/checkpoint boundary and `ntg-run`
providing launch-time limits and cancellation. Do not add a Ralph role or a
wrapper that repeatedly launches primary heads.

The semantic loop already belongs to Bulldozer: integrate work, verify it, obtain
Zen review, route concrete NO-GO findings, and obtain a fresh review after repair.
Issue #16 would make that behavior explicitly bounded and resistant to premature
stops, not transfer completion ownership to a new coordinator.

Suggested pilot limits are three repair cycles, 60,000 aggregate model tokens,
and 20 minutes for the whole execution. These numbers are proposals, not approved
defaults. Strict token enforcement and headless continuation are unresolved
runtime capabilities; neither can be claimed from the existing wrapper.

The requested `.omo/evidence/64-policy-decision-brief.md` is absent in this
checkout. This brief therefore uses a decision-first structure with observed
facts, proposed behavior, and validation dependencies kept separate.

## 1. Concrete meaning of convergence

For a single authorized task, freeze GOAL, SCOPE, NON_GOALS, ACCEPTANCE, material
SOURCE_OF_TRUTH/DECISION_RULE, and COVERAGE/COVERAGE_BASIS. Preserve the original
acceptance contract through every worker and reviewer handoff.

```text
initial implementation/integration
  -> acceptance-relevant local verification
  -> independent Zen review of current candidate
       GO    -> check freshness, coverage and idle state -> READY
       NO-GO -> classify findings -> bounded authorized repair/evidence work
                 -> re-verify -> fresh Zen review -> repeat or terminate
```

The task continues in its existing native session without the user saying
"continue" after each NO-GO. A review request is pending, not a verdict. Zen
remains the final independent gate; it does not implement the repair.

Define one repair cycle as authorization of a concrete post-review correction
packet, followed by relevant verification and fresh review. Evidence-only
corrections also count. Charge the cycle before dispatch. The initial candidate
and review consume time and tokens but are not a repair cycle. Three repair
cycles permit the initial review plus at most three correction reviews.
Duplicate hook calls, waiting for a child, and transport retries do not create
extra repair allowances; all consume the same total time/token budget.

"Clean" means the complete governing acceptance contract is evidenced satisfied,
not zero comments, a worker READY, or a certain number of passes. Stop immediately
on the first current, applicable Zen GO with complete verification and coverage.

## 2. Placement in the actual role graph

**OBSERVED:** `AGENTS.md`, `agents/piledriver.md`, `agents/bulldozer.md`,
`agents/excavator.md`, and `docs/architecture.md` define three peer primaries.
Piledriver -> Bulldozer -> Zen is a possible workflow handoff, not a parent-child
hierarchy.

```text
optional Piledriver planning -> current Zen plan GO -> explicit execution handoff
Bulldozer [bounded driver, global execution owner]
  -> Bobcat -> Strix Halo when ADVISOR_GATE requires it
  -> Puma for explicit low-risk mechanical corrections
  -> Jaguar for missing factual evidence
  -> Steamroller for a wrong decision or architecture
  -> Zen for independent integrated completion review
Excavator [separate bounded repair primary] -> Zen final completion review
```

`rules/orchestration.md`, "Correction routing", already routes implementation
defects to Bobcat, mechanical defects to Puma, decision defects to Steamroller,
and evidence gaps to verification. Keep those choices inside Bulldozer.
Bulldozer has no shell or direct implementation authority: verification work
must be assigned to a capable authorized worker; Zen performs only permitted
independent read-only checks. Do not create Bobcat <-> Zen repair loops.

| Placement | Assessment |
| --- | --- |
| New Ralph role | Reject: duplicates primary completion authority and deepens the deliberately shallow graph. |
| Bulldozer-internal driver | Recommend: already owns routing, integration, NO-GO correction, and global completion. Adds bounds rather than a new owner. |
| Wrapper around existing heads | Reject as the semantic owner: risks replaying mutating work, implicitly executing a planning handoff, and treating primary peers as nested workers. Keep the wrapper limited to run controls. |

Piledriver may revise a plan after Zen NO-GO, but this proposal does not authorize
it to implement that plan. Excavator already repairs directly and requests Zen
after local verification. A later separately validated extension could apply the
same budget policy to Excavator; Bulldozer must not spawn it as a repair fallback.
The isolated vNext Steamroller/ledger architecture is not activated by this
recommendation; Zen's vNext packet is not the default v0.4 completion protocol.

## 3. Stops, budgets, and distinguishable failures

### Success gate

Require all of the following before recording `CONVERGED` and permitting READY:

- acceptance-relevant checks actually completed with inspected results;
- material coverage is closed against an established coverage basis;
- the primary observed GO from the current Zen review, correlated to its child
  and request, for the current contract and candidate/evidence revision;
- no newer review request, material mutation, or changed verification basis
  invalidates that result;
- no active child or pending verification can still change the result.

NO-GO is a repair input while bounded remediation remains available. Neither
NO-GO nor missing review evidence becomes GO because retries ran out. A new
review invalidates an older GO until its verdict is observed. A post-GO change
requires relevant verification and another review.

### Guardrails

Enforce the earliest limit, shared across workers, advisors, verification, and
Zen: illustrative `max_repair_cycles=3`, `max_tokens=60000`,
`max_elapsed_ms=1200000`. No counter resets after a new child, compaction,
transport retry, or review request. Reserve room for the final review before
authorizing repair; do not spend the entire budget creating an unreviewable
candidate. Unknown cost is not free.

Tokens mean aggregate model input plus output, including repeated context and
all descendants. A hard token cap needs trusted usage accounting plus bounded
in-flight reservations/native per-call ceilings across the child tree. Merely
adding usage after a call can overshoot. If the runtime cannot provide that
contract, refuse strict token-bounded mode before work begins rather than
advertising an unenforced limit. A separately labeled iteration/time-only pilot
is possible, but is a different policy choice.

The launch wrapper needs a whole-run deadline watchdog; each command/review
timeout must fit the remaining deadline. `Stop` alone cannot bound a hung command
or a primary that never stops. At exhaustion, prohibit new dispatch, cancel or
quiesce active work through native lifecycle facilities, preserve current
artifacts/evidence, and report incomplete acceptance. Validate descendant
cancellation before calling the time cap hard.

### Failure classes and response

| Finding class | Allowed next step |
| --- | --- |
| Repairable implementation defect | Smallest Bobcat correction, required Advisor gate when substantive, then verification and fresh Zen. |
| Explicit low-risk mechanical defect | Puma correction, verification, then fresh Zen. |
| Evidence gap or stale verdict | Obtain missing current evidence/review; do not redesign merely to produce a pass. |
| Decision/architecture error | Steamroller reasoning before another materially similar patch; preserve acceptance. |
| Contradictory acceptance or unresolved policy choice | Show the conflict and request a decision; do not silently weaken the contract. |
| Verified authority/capability/external dependency boundary | Finish independent in-scope work, then apply the generic BLOCKED gate. |
| Runtime/transport/provenance failure | Record the actual error; do not treat absent output as NO-GO or replay a mutating primary blindly. |
| Repeated unchanged findings | Change diagnosis while budget permits; terminate STALLED when no materially new evidence or repair path emerges. |

### Terminal taxonomy

| Outcome | Meaning and report |
| --- | --- |
| `CONVERGED` | Current verified acceptance and Zen GO; primary may report READY. |
| `BUDGET_EXHAUSTED` | Include `ITERATIONS`, `TOKENS`, or `TIME`, spent/limit, unfinished criteria, last findings and candidate reference. Not READY. |
| `STALLED` | Two materially similar unsuccessful cycles with unchanged blocker fingerprints and no relevant artifact/evidence progress; stop that approach, not declare impossibility. Not READY. |
| `BLOCKED` | Verified preventing condition and no safe relevant action remains in scope/authority/capability, as required by `rules/harness.md`. Not READY. |
| `NEEDS_DECISION` | Contract/policy choice needed; report exact alternatives and evidence. Not READY. |
| `CANCELLED` | Human cancellation; no automatic restart or success claim. |
| `RUNTIME_ERROR` | Abnormal termination, unsupported required enforcement, invalid state, or unestablished provenance. Preserve evidence; no success inference from process exit. |

These are proposed driver outcomes, not new currently parsed role sentinel
lines. Budget exhaustion and stagnation do not automatically satisfy the generic
BLOCKED gate. Non-success outcomes need an explicit incomplete handoff rather
than falsely printing READY or manufacturing BLOCKED. Human continuation, a
changed contract, or a budget increase must be an explicit new authorization,
not a background reset.

## 4. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Infinite repairs of an unfixable or contradictory task | Freeze acceptance, bound correction dispatch and elapsed time, fingerprint blockers, stop materially repetitive branches, surface verified conflicts. |
| Context bloat hides acceptance or burns the budget | Retain original contract, current candidate/evidence references, latest findings, and a compact bounded cycle ledger. Archive raw output by reference; do not replay full histories or omit unresolved findings during compaction. |
| False confidence after N passes | N measures expenditure, not correctness. No majority vote, reviewer shopping, weaker tests, or acceptance edits. Keep failed evidence visible and require independent current Zen GO. |
| GO becomes stale or belongs to another review | Correlate sender/request/contract/candidate; invalidate after changes and new review requests. Inspect current integrated artifacts, not just worker reports. |
| Restart repeats edits or external effects | Continue the same native session; checkpoint authorized dispatch once. Inspect state after interruption rather than relaunching the original prompt. |
| Hook races or caps missed between stops | One state writer/atomic checkpoint, idempotent event cursor, dispatch-time reservations, launch watchdog and native child cancellation. Missing enforcement is a capability error. |
| Scope or authority grows during repair | Preserve non-goals and role tools. Denied effects remain denied; iteration allowance never grants privilege, external-write, or deployment authority. |

## 5. Integration sketch: runner and hook boundaries

### Existing behavior, not assumptions

- `scripts/ntg-run.mjs` launches one `agy` process with inherited stdio, injects
  `NTG_ROLE` only for Bulldozer/Piledriver, optionally holds a `--ledger` lock,
  forwards SIGINT/SIGTERM/SIGHUP, and propagates exit status. It neither loops
  nor parses review results, tracks usage, or imposes a deadline.
- Root `hooks.json` registers `Stop` for primary/Excavator review gates and
  `PreToolUse` for marked Zen/Excavator shell guards. Hook `timeout: 10` bounds
  each hook execution, not the task. No usage/completion hook is registered.
- `hooks/primary-review-gate.py` reconstructs the latest Zen request and
  provenance-bound verdict from the transcript. Pending review continues;
  READY/PLAN READY without current GO continues. A non-READY stop can terminate,
  and malformed/missing event evidence or abnormal termination permits stop.
  Thus it is a completion backstop, not a bounded convergence driver.
- `hooks/excavator-review-gate.py` additionally invalidates GO after direct
  writes or marked Excavator shell calls. Do not assume equivalent delegated
  artifact invalidation already exists in the primary gate.
- `scripts/runner.mjs`, `invoke()`, shares a wall-clock timeout across bounded
  empty-response retries but deliberately never retries Bulldozer, because it
  may already have delegated edits. That retry is transport handling, not
  review/repair convergence.

### Proposed boundary ownership

1. **Launch (`ntg-run`)**: parse a proposed opt-in convergence configuration
   before `--`, remove wrapper-owned flags before invoking `agy`, establish
   task/run identity and caps, and arm the total deadline. Preserve existing
   argument passthrough, markers, signals, and one native session. Do not infer
   readiness from an exit code or automatically launch another primary.
2. **Dispatch (`PreToolUse` extension)**: check authorization, remaining budget,
   and cycle reservation before correction/child dispatch. Existing registrations
   match only `run_command`; dispatch coverage would need deliberate expansion.
   Charge actual usage through a validated trusted runtime completion/usage
   channel. No unobserved `PostToolUse` API or token field is assumed here.
3. **Completion (`Stop`)**: host the convergence decision and atomic state
   checkpoint immediately before returning `{"decision":"continue","reason":...}`
   or `{"decision":"stop"}`. Extend the primary gate for opt-in Bulldozer sessions
   rather than add another competing Stop decision maker. Retain current review
   provenance checks. Nonterminal stops continue with the smallest authorized
   next action; explicit terminal outcomes, cancellation, and abnormal runtime
   exits must be allowed to end without readiness.
4. **Close**: emit the terminal outcome/evidence packet, quiesce children, release
   locks, and retain the compact record for diagnosis. Do not automatically
   resume stale or corrupted state.

Keep one opt-in session/task record outside tracked project source, containing
contract digest/reference, session ID, candidate/evidence revision, charged
repair cycles, deadline, usage/reservations, active Zen child/request/verdict
references, blocker fingerprints, processed-event cursor, and terminal reason.
The Stop transition is the checkpoint boundary; launch and trusted dispatch
events supply facts through a serialized update path. Counters cannot be
self-reported solely by model prose. Duplicate delivery must not charge or
dispatch twice.

Prefer native session metadata if it supplies these guarantees. Otherwise a
minimal session-scoped atomic sidecar with an explicit writer lock is a proposed
design exception to the repository's preference against persistent coordination
machinery; justify it only for enforceable bounds, not to build another runtime.
`scripts/ledger-lock.mjs` locks a milestone ledger for the whole launch session;
that is not a mutex for hook read/modify/write or a token accountant. Do not
reuse it as one or silently merge convergence counters into the vNext ledger.
Unestablished state identity, usage, or provenance yields an incomplete runtime
error, never a successful empty-transcript stop.

### Headless limitation and acceptance gates for a future implementation

**OBSERVED source limitation:** the primary gate header and
`.omo/evidence/agy-1-3-1/side-probe.md` document that AGY 1.2/1.3 headless
`agy -p` does not fire Stop events. Marker injection restores role attribution,
not lifecycle events. Do not claim `ntg-run --agent bulldozer -p ...` gains an
enforced autonomous loop just by adding a counter to Stop.

Start only on a validated native lifecycle path that fires the necessary
events. Refuse headless opt-in until a separately validated same-session
continuation/completion adapter supplies equivalent guarantees; do not work
around it with blind repeated process launches.

A future implementation must demonstrate NO-GO -> repair -> verification ->
fresh GO in observable use, stale/post-review mutation rejection, pending and
wrong-sender review handling, all three cap exits including in-flight work,
repeated-event idempotency, stalls/conflicting contracts, missing telemetry,
non-READY premature stops, cancellation with active children, and unchanged
non-opt-in behavior. Include interactive/native lifecycle validation; synthetic
hook tests alone cannot prove a host actually invokes the boundary.

## 6. What the loop does not replace

Zen remains the independent, non-mutating final verifier. Local tests, Strix
Halo ACCEPT, child READY, and exhausted budgets never substitute for current
Zen GO. The active primary still owns its existing kind of completion:
Bulldozer execution, Piledriver plan readiness, Excavator bounded repair.

Human control remains authoritative: stop/cancel takes priority over autonomous
continuation; the user may explicitly reduce budgets, authorize another run, or
change acceptance. Record a changed contract as a new version requiring fresh
verification/review. Manual acceptance of incomplete work is a distinguishable
human override, not a fabricated Zen GO or autonomous CONVERGED outcome.

This exploration changes no role, hook, runner, model policy, or runtime. The
recommended pilot limits, state-storage exception, and unsupported-capability
behavior remain decisions for implementation approval, not facts established
by unrelated issue closure.
