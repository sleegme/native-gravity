# Internals

This is the implementation reference for maintainers. It covers roles,
invocation, packet validation, ledger locking, recovery and release checks. For
everyday use, read [Usage](usage.md); for the reasoning behind the design, read
[Architecture](architecture.md). The
[vNext architecture contract](specs/vnext-architecture-contract.md) is
normative, and this page maps that contract onto the code.

## Native-first boundary

Native Gravity does not ship a replacement runtime. The npm entrypoint is
installation-only: it locates the packaged plugin directory and delegates
installation back to `agy plugin install`. It does not intercept or wrap
Antigravity runtime execution. Antigravity owns primary/subagent execution,
lifecycle, sessions, workspaces, model resolution, and tool permissions.
Native Gravity supplies role contracts, routing policy, and model-adaptive
behavioral guidance. The
vNext runner (`ntg-vnext`) is a narrow exact-model coordinator over `agy` that
owns only the authoritative ledger, milestone sequencing and the independent
Zen gate; it is not a general workflow platform.

`package.json` declares `ntg-vnext`, `ntg-dag` and `native-gravity` bins. They
become commands only through an npm-installed package, which 1.1.0 is not;
plugin installation does not create them, so user docs run
`node <checkout>/scripts/<name>.mjs` instead.

## Ledger ownership

For multi-milestone work, `ntg-vnext` holds an exclusive `ledger.json.lock` for
the lifetime of the session through `MinimalSpine`. The spine acquires the lock
before creating or loading the ledger, and holds it until `close()` or process
exit. Close the previous spine before resuming in another instance; a closed
spine cannot mutate state, and a busy spine cannot be closed.

The lock is created with `openSync(..., 'wx')` (exclusive creation) and contains
the owner's decimal PID followed by a newline. An existing lock always refuses
startup with `LEDGER_LOCKED`, even if its PID appears dead or its contents are
empty. Normal exit, SIGINT, and SIGTERM release ownership. SIGKILL, a crash, or
a machine shutdown may leave a stale lock: `ntg-vnext recover` removes it only
after verifying the recorded owner PID is no longer alive and terminating that
owner's orphaned executors. Never remove a live owner's lock. Lock recovery
does not resolve an interrupted ledger milestone: resume still requires
observed interruption evidence. All writers must use the same ledger path and
ownership protocol; low-level `AuthoritativeLedger.load()` / `save()` remain
persistence primitives, not independent session owners.

## Role ownership and routing

The named topology is internal, not a user configuration interface:

```text
User
  Steamroller — supervisor / authoritative ledger owner
    Piledriver — bounded planning, architecture and difficult decisions
    Bulldozer — one bounded milestone
      Jaguar / Puma / Bobcat / Excavator
                       Strix Halo — Bobcat-local advisor gate
    Instinct — alternate-framing advisory on NEEDS_ALT
    Zen — independent milestone verification
    Navi — bounded Linux desktop leaf through the exact-model runner
    Steamroller ledger transition
```

No natively selectable project primary remains; `ntg-vnext` is the entry for
project work. Navi is selectable only for the runner's agent-scoped MCP load,
not as a project primary. Bulldozer, Piledriver and Instinct are runner-only roles: Bulldozer
executes exactly one bounded milestone per invocation, Piledriver returns
advisory plans to Steamroller, and Instinct returns alternate-framing advice on
NEEDS_ALT. Excavator is a Bulldozer worker for difficult broken-behavior work
(diagnose -> reproduce -> root-cause -> repair -> verify), with no nested
delegation and no Zen invocation.

Routing is based on the kind of work:

- find/inspect -> Jaguar
- small + clear + low-risk / writing -> Puma
- ordinary implementation -> Bobcat (-> Strix Halo)
- hard broken-behavior diagnosis/repair -> Excavator (Bulldozer worker)
- planning / architecture / trade-off -> Piledriver (via Steamroller under the runner)
- stalled same-class failures / a different framing -> Instinct (NEEDS_ALT, via Steamroller under the runner)
- independent verification -> Zen

Roles fit the behavior each model is naturally good at; correction is added
only where a specific role/model pairing actually fails. Excavator is
intentionally an editing role, so there is no model-wide mutation deny. The
Zen and Excavator shell guards are behavioral backstops scoped from the
explicit `NTG_ZEN_VERIFY=1` / `NTG_EXCAVATOR=1` shell markers, not complete
shell or privilege sandboxes.

| Role | Implementation boundary |
|---|---|
| Steamroller | Sole authoritative ledger writer and global completion authority; owns goal, constraints, decision invariants, plan version, graph, evidence, blockers and next action; neither implements source nor directly orchestrates workers |
| Piledriver | Advisory planning, architecture/API decisions, verification strategy and material replans; no implementation, delegation, ledger or completion authority; Steamroller decides adoption; execution/review requests remain planning requests |
| Bulldozer | One current-version milestone; delegates rather than editing source or running shell; directly inspects known context and packet-named files, delegates discovery to Jaguar; returns `DONE \| BLOCKED \| NEEDS_DEEP`; never invokes Piledriver/Zen or writes the ledger |
| Jaguar | Read-only factual discovery; no delegation |
| Puma | Small, explicit, low-risk writing/formatting/presentation/mechanical text or config; no delegation or advisor ceremony |
| Bobcat | Ordinary bounded implementation; may invoke only Strix Halo; parent chooses `ADVISOR_GATE: REQUIRED \| NONE`, REQUIRED for substantive code/behavior/API/state/lifecycle/test work or uncertainty, NONE only for clearly low-risk mechanical work |
| Excavator | Native Flash difficult diagnose/reproduce/root-cause/repair/verify worker under Bulldozer; edits inside its scope, no nested delegation, never invokes Zen |
| Strix Halo (`strix-halo`) | Bobcat-only read-only advice/CHECK gate; `ACCEPT \| REVISE \| NEEDS_DEEP`; corrections go through Bobcat |
| Zen | Independent non-mutating milestone review for Steamroller, not Bulldozer's child; `GO \| NO-GO`; may run verification commands |
| Instinct | Runner-only heterogeneous alternate-framing advice, not a ritual reviewer; no implementation, orchestration, ledger, adoption or verdict/completion authority |
| Navi | Steamroller-only desktop leaf on Gemini 4 Argon / Medium; agent-scoped MCP, no children, shell, source editing, ledger or completion authority; external/irreversible effects return `NEEDS_CONFIRMATION` |

Difficult decisions propagate through
`Strix Halo -> Bobcat -> Bulldozer -> Steamroller -> optional Piledriver`.
Workers and Bulldozer never invoke Piledriver directly. Excavator returns
ROOT_CAUSE (`CONFIRMED | LIKELY | SPECULATIVE`), CHANGES,
VERIFICATION_EVIDENCE, ROLLBACK, RESIDUAL_RISK and STATUS (`READY | BLOCKED`).
That STATUS, worker READY and Strix ACCEPT are local signals, not completion.

## Candidate verification

Bulldozer DONE is a pre-review candidate. `scripts/spine.mjs` implements the
supervisor's sequencing over `scripts/ledger.mjs`; one milestone executes or
undergoes review at a time. Before Zen review, the ledger persists an immutable
candidate and a unique `result_ref`. Promotion requires an observed GO matching
the milestone, current `plan_version` and candidate reference, plus actual
verification evidence. Changed candidates need new references and reviews.

Material replanning ends active execution/review before adoption, increments
`plan_version`, marks old verdicts STALE and clears active/completed state.
Retained milestones need fresh current-version review in dependency order.
Historical evidence remains, but cannot authorize completion. Global completion
requires all current milestones verified, no blockers, no active invocation or
review, and direct observation of evidence by the supervisor.

## Invocation policy

`scripts/runner.mjs` resolves installed model slugs without silent fallback and
owns effort, cwd/context, bounded prompt construction, timeouts, recursion
protection, structured result capture and failure reporting. Role bodies load
from `agents/`; critical roles are runner-invoked, not natively selectable.

- Steamroller targets Gemini 4 Argon / Medium; Bulldozer stays on Gemini 3.8 Flash / High.
- Piledriver targets Gemini 4 Argon / High.
- Navi targets Gemini 4 Argon / Medium; see [desktop dispatch](navi.md).
- Instinct targets Claude Sonnet 5.5 / High; Claude Opus 5.5 / High is selected
  only on explicit `--escalate`.
- Jaguar/Puma/Bobcat/Excavator/Strix Halo use native Flash. Exact Argon
  frontmatter is rejected by AGY 1.3.6, and native `pro` did not select Argon
  in stored child metadata. See the [Argon profile](model-profiles/gemini-4-argon.md)
  for the failed probes and proposed exact-invocation alternative. Zen is invoked
  natively by `ntg-vnext`, which resolves Gemini 4 Argon / High from the
  same policy table and prepends the `agents/zen.md` body (frontmatter
  stripped) instead of selecting `--agent zen`.
- The 2026-10-16 Argon mapping (#74) changes the policy-resolved roles only;
  native workers retain Flash. The original claim that native Pro selected
  Argon was disproved by child metadata. Excavator escalation uses the existing NEEDS_ALT ->
  Instinct path; there is no model escalation for Excavator.
- `NTG_ZEN_MODEL` optionally pins the independently invoked Zen model.
  Comparative behavioral evidence remains open; model discovery proves
  availability, not quality.

NEEDS_ALT is for materially similar failures repeating without new evidence,
or same-family paths over-converging. The advice packet carries failure class/signature, current hypothesis, attempt
count, evidence and tier-B replan context. Instinct returns current framing,
why it may be wrong, materially different hypotheses/approaches (each with an
OBSERVED/INFERRED/UNKNOWN basis and discriminating test), recommendation and
unknowns. The result is advisory evidence (`adopted: false`), never automatic
plan adoption or promotion. Same-class failure recommendations require at
least three attempts without meaningful new evidence or causal-model progress;
they are not raw retry counts and never automatically run paid calls.

## Planning visibility

Planning receives a bounded tier-B `replan_context`, not the raw ledger
(owner decision #114). It identifies the failed artifact/lane and failed step's
redacted tool arguments or command line. Prompt text, role bodies and contract
fragments stay hidden; inherited context is not an authority grant. Exact fields,
excluded candidate/verdict blobs and redaction rules have one normative home in
[contract §4.3](specs/vnext-architecture-contract.md#43-steamroller--piledriver-planning-packet).
`scripts/telemetry.mjs` applies redaction both when recording and projecting.

## Result packets

Machine invocations request a bare JSON object; Bulldozer is instructed to start
its response with `{` and relay worker reports only inside packet fields
(`verification_evidence`, `delegations` findings), never before or after it
(#136, shipped in 1.1.0). Parsing does not replace ledger validation or review.

`parseResponsePacket` in `scripts/runner.mjs` accepts a single unambiguous
packet, including a JSON code fence or plain surrounding narration. Other
packet-external text containing JSON-like tokens (double quotes, backticks,
braces, square brackets, or a standalone number, `true`, `false` or `null`)
is ambiguous and rejected. Empty, malformed or multiple packets fail closed:
the invocation failure is recorded and nothing promoted. A model occasionally
echoes worker reports outside its packet; source instructions reduce this
failure mode but are not a guarantee. The observed failure and retry remain
in [activation evidence](../.omo/evidence/134-vnext-activation.md).

## Behavioral guards

Zen's verification-only `run_command` uses the `NTG_ZEN_VERIFY=1` marker and
`PreToolUse` guard against common intentional shell mutation paths. Its grammar
admits read-only inspection plus `node --test` over named `tests/` files, and
no other executable path. Excavator's
`NTG_EXCAVATOR=1` marker scopes its guard: ordinary task-relevant sudo diagnostics
and repair remain allowed, while stdin-password injection/guessing, alternate
privilege acquisition (`su`, `pkexec`, root SSH to localhost), shell-history
credential mining and broad system upgrades are rejected.

These are role-specific behavioral backstops, not complete shell or privilege
sandboxes. AGY `PreToolUse` payloads lack reliable custom-agent identity; the
guards use explicit markers rather than a model-wide deny.
Deterministic coverage lives in
[`tests/test_zen_shell_guard.py`](../tests/test_zen_shell_guard.py) and
[`tests/test_excavator_shell_guard.py`](../tests/test_excavator_shell_guard.py).

## Google AI Studio lane

`scripts/studio-runner.mjs` provides a second execution profile for A/B
comparison: the same role + packet goes through the bounded prompt contract,
then a direct `generateContent` REST call instead of `agy`.

```js
import { invokeStudio } from './scripts/studio-runner.mjs';
const result = await invokeStudio('steamroller', packet, {
  model: process.env.GOOGLE_AI_STUDIO_MODEL,
  generationConfig: { temperature: 0.2 },
});
```

Set `GOOGLE_AI_STUDIO_MODEL` to a model ID exposed by that provider, not an
assumed AGY slug. Set `GOOGLE_AI_STUDIO_API_KEY` (or `GOOGLE_API_KEY`) in the environment. The
key goes only to Google in the request URL and is never written to results,
errors, or ledger state. Results carry `provider: 'google-ai-studio'`, the
model id, and token `usage` so comparisons stay attributable by
model + provider + settings. This lane has no tools, subagents, or ledger
authority; it answers "is this the model or the harness?", not "run the
orchestration".

## Alpha compatibility gate

An older Native Gravity test found that a custom primary could fail to invoke
subagents while the Antigravity Default agent succeeded. On AGY 1.3.3, a clean
install validates the runner's end-to-end milestone flow (Steamroller ->
Piledriver -> Bulldozer -> Zen) and specialist delegation (Bulldozer ->
Jaguar / Puma / Bobcat, including the nested Bobcat -> Strix Halo gate) in live
probe sessions. Revalidate this compatibility gate when the AGY runtime
changes. See [Versioning Policy](versioning.md) for versioning details and the
compatibility matrix. This is a maintainer release gate, not a normal user
workflow. The canonical obligations remain in [AGENTS.md](../AGENTS.md#validation-required):

1. Runner execution/planning/review reaches a matching independent Zen GO
   before promotion.
2. Multi-milestone work follows dependencies; material replans increment the
   version and revalidate retained milestones.
3. A NO-GO leaves work incomplete; a repaired candidate needs a fresh GO.
4. Fresh-context resume uses the ledger, not conversation.
5. Bobcat invokes only Strix Halo (include negative delegation coverage).
6. Bulldozer may delegate bounded diagnosis/repair to Excavator; the worker
   edits, invokes no child (including Zen), and returns its worker result;
   delegation validation accepts it and rejects non-worker roles.
7. Zen verification uses its marker and rejects common intentional mutations.
8. Excavator-marked calls preserve ordinary sudo diagnostics while rejecting
   privilege drift and full upgrades.

Items 1–4 passed in prior AGY 1.3.3 live runner probes. Items 5–8 have deterministic
coverage and prior live observations; the later Excavator worker probe is linked
in [Status](status.md#live-validation). Revalidate the full gate after an AGY
runtime change.

## Activation and transition record

vNext activation (44G, #134) connected the runner and distributed role/rule
bodies. Version 1.0.0 removed the pre-vNext topology and compatibility paths
(#138); version 1.1.0 removed the last native primary, demoted Excavator to a
worker and implemented Instinct (#20). This is completed migration history,
not a user-facing mode selection.

The [Status history](status.md#release-and-migration-history) retains removed
paths, the superseded #137 customization decision and original live receipts.
The [44B spike](specs/44b-runner-spike.md) preserves its earlier implementation
contract and empirical receipts; it is historical, not the current whole-system
specification.
