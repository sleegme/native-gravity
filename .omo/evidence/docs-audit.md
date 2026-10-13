# User-first documentation audit

Base: `origin/main` at `f63478e` (PR #143), Native Gravity 1.1.0.
Audit date: 2026-10-13. Scope: README and all 15 Markdown files under `docs/`.
This audit was written before restructuring the documentation.

## Findings and scope

The entry point already explains independent verification and durable progress,
but then teaches packet parsing, internal roles and recovery machinery before a
user has completed a task. Usage is mostly a role reference and release checklist,
not a usable workflow. Architecture repeats the contract and release history.
Several pages repeat the same internal boundaries. The Korean status page even
contains unfinished paragraphs ending in an ellipsis.

The existing layout is sufficient. Keep README as the product entry; move the
complete worked example into Usage; explain design choices in Architecture;
collect mechanism and role details in Internals; keep normative contracts in
Specs. Status remains the evidence/current-capability reference, Versioning the
release policy, and model profiles explicitly provisional implementation research.
English and Korean entry/usage/design pages retain their existing languages.

Owner addendum: README EN/KO carry no vNext naming, history or transition
talk; the only `vnext` strings are literal `scripts/ntg-vnext.mjs` command paths.

No runtime, model policy, architecture, release number or plugin installation is
changed. The two PR #145 worktrees are untouched. LICENSE, package.json, agents/,
rules/, hooks/ and contract section 8.3 are excluded from edits.

## Per-document decisions

| Document | Problem | Target role | Action |
|---|---|---|---|
| `README.md` | Long example and parser mechanics obscure the front door; undefined checkout variable; plain-AGY comparison overstates limitations | Product intro/entry | Rewrite; move workflow to Usage and parser detail to Internals |
| `docs/ko/README.md` | Same hierarchy and undefined variable as English | Product intro/entry | Rewrite in Korean with equivalent entry links |
| `docs/usage.md` | Internal worker selection and release gates replace real examples; unavailable global commands; shell brackets are not executable syntax | Usage | Rewrite around setup, plan, run, inspect, retry, replan, advice and recovery |
| `docs/ko/usage.md` | Same problems; assumes installation creates global bins | Usage | Rewrite in Korean with explicit checkout script paths |
| `docs/architecture.md` | Role permissions, model slugs and migration issues dominate design intent | Architecture | Rewrite design overview; move mechanics into Internals |
| `docs/ko/architecture.md` | Same implementation-heavy structure | Architecture | Rewrite design overview in Korean; reference shared technical source |
| `docs/internals.md` | Incomplete technical home; links release checklist back to Usage | Internals | Merge relocated role/packet/checklist material here; keep locks and Studio lane |
| `docs/status.md` | Starts with internal role changes rather than capabilities; repeats role contracts and guard implementation | Evidence/status reference | Rewrite capability-first; keep live observations and historical qualification; move mechanics to Internals |
| `docs/ko/status.md` | Repeated technical prose, same internal-first order | Korean status | Restructured to mirror English (capabilities, limits, live validation, not established, history); content kept in Korean |
| `docs/versioning.md` | No information-structure defect in its release-policy role; matrix clearly dates historical releases | Specs/supporting policy | Keep unchanged |
| `docs/specs/vnext-architecture-contract.md` | Completed implementation sequence reads like future work; open-question introduction contradicts resolved rows; model table omits Excavator | Specs | **Not edited**: file is in PR #145 scope. Fixes listed in the PR body; README now links `docs/specs/` instead of the file path |
| `docs/specs/44b-runner-spike.md` | Historical spike and deferred Instinct can be mistaken for current specification | Specs/historical evidence | Keep all receipts and details; add historical orientation |
| `docs/model-profiles/README.md` | Schema statuses omit the existing draft status; private local pipeline reads like shipped product capability | Internals/research reference | Clarify provisional research and external collection dependency |
| `docs/model-profiles/gemini-3.1-flash.md` | No evidence, but strengths and fit read as measured facts | Internals/research reference | Keep hypotheses; label unvalidated legacy recommendations |
| `docs/model-profiles/gemini-3.1-pro.md` | Stub presents unmeasured recommendations as facts; Steamroller recommendation conflicts with current deployed model | Internals/research reference | Mark hypotheses and non-deployed alternative; retain historical drift observation |
| `docs/model-profiles/gemini-3.8-flash.md` | Resolution counts imply quality; historical native Excavator gate reads as current worker behavior | Internals/research reference | Qualify counts and historical probe; preserve numbers and evidence |

## Relocation ledger

| Original material | Destination / retained authority |
|---|---|
| README EN/KO two-milestone health-check plan, required fields, initial output and completion/rejection walkthrough | `docs/usage.md` / `docs/ko/usage.md`, “First task” sections; output explicitly an excerpt, service paths explicitly illustrative |
| README EN/KO installation and clean reinstall | Short front-door install remains in README EN/KO; Usage links that single installation procedure instead of duplicating it |
| README EN/KO detailed fail-closed parser token rules and #136 response-report failure | `docs/internals.md`, “Result packets”; user action remains in Usage troubleshooting |
| README EN/KO Linux `/proc`/`pidfd` recovery mechanics and exclusive lock | Existing `docs/internals.md`, “Ledger ownership”; Linux availability and one-owner user actions in Usage |
| README EN/KO live tampering/rejection, fresh-process resume and replan observations | `docs/status.md`, “Live validation”; original `.omo/evidence/134-vnext-activation.md` retained and linked |
| Usage EN/KO Excavator result fields, worker permissions, Bobcat/Puma distinction and advisor policy | `docs/internals.md`, “Role ownership and routing”; normative source stays contract §§2/4 |
| Usage EN/KO eight-item alpha release checklist and AGY runtime revalidation instruction | `docs/internals.md`, “Alpha compatibility gate”; `AGENTS.md` unchanged |
| Usage exact Zen model override | `docs/internals.md`, “Invocation policy”; not a requirement for normal use |
| Architecture EN/KO named graph, full role boundaries, escalation chain and native model tiers | `docs/internals.md`, “Role ownership and routing” / “Invocation policy”; normative source stays contract |
| Architecture EN/KO candidate `result_ref`, current-version matching, STALE history and completion preconditions | `docs/internals.md`, “Candidate verification”; high-level rationale stays Architecture |
| Architecture EN/KO bounded tier-B planning context and exclusions (#114) | `docs/internals.md`, “Planning visibility”; full redaction contract remains §4.3 unchanged |
| Architecture/status EN/KO OQ-3/OQ-4/OQ-6 resolutions, true/omission/false probe and inheritance-not-authority | `docs/status.md`, “Release and migration history”; shared English history is mirrored in `docs/ko/status.md` |
| Status EN/KO Instinct advisory contents, packet fields, threshold and explicit escalation | `docs/internals.md`, “Invocation policy”; actionable advisory commands and threshold in Usage |
| Status EN/KO shell markers, sudo allowance, denied privilege/history/upgrade paths, not-a-sandbox qualification and deterministic test paths | `docs/internals.md`, “Behavioral guards” |
| Status EN/KO removed native hooks, gate panel, ntg-run, pre-activation mirror, plan-review contract and #112 history | `docs/status.md`, “Release and migration history”; deleted paths marked historical, not linked as existing files |
| Status EN/KO live runner/delegation/worker/Instinct/native-primary observations, exact slugs and pending tool observations | `docs/status.md`, “Live validation” / “Not established”; original evidence stays in place |
| README EN/KO vNext framing ("vNext is the runtime", activation #134, vNext-only #138, `ntg-vnext` alias explanation, specs link titled "vNext architecture contract") | `docs/architecture.md` / `docs/ko/architecture.md` "Design intent" (vNext = shipped runtime, not a mode); `docs/internals.md` "Activation and transition record"; `docs/status.md` "Release and migration history"; npm bin explanation in Internals "Native-first boundary" |
| Usage `--watch` side-pane hint, `ntg-dag` bin note | Usage `--watch` bullet; Internals "Native-first boundary" (bins exist only via npm package) |
| Architecture Instinct trigger ("same-family paths over-converge") | `docs/internals.md`, "Invocation policy" |
| Strix Halo final codename | Internals graph/routing table (`strix-halo`), no separate repeated naming section |
| Internals Studio example, provider/settings attribution, no tools/subagents/ledger authority, key handling | Kept in `docs/internals.md`, “Google AI Studio lane” |
| 44B 24-pass receipt, Piledriver/Bulldozer tokens/durations/prompts, deferred-at-the-time OQs | Kept verbatim in `docs/specs/44b-runner-spike.md`; historical banner distinguishes them from current implementation |
| Model profile hypotheses, approximate 760/35 counts and AGY 1.3.1 native gate observation | Kept in respective model profiles with evidence/age/measurement qualifications |
| Product version, maturity and compatibility matrix | `VERSION` remains canonical version; `docs/versioning.md` unchanged; Status owns current observed capabilities/evidence |

## Protected follow-up for PR #145

Contract §8.3 still describes the 44G separate-primary Excavator provenance
closure and a future #34/MIT boundary. Keep that historical closure evidence,
but PR #145 should distinguish the later worker successor and current license
closure. This restructure does not change §8.3 or any protected file.

## Verification

Run on the final working tree (scratch project under `/tmp`, removed afterwards):

| Check | Result |
|---|---|
| Relative links + heading anchors (README + all `docs/**/*.md`) | `checked 101 relative links in 16 files, 0 broken` |
| `init` with Usage's exact `plan.json` | exit 0; output matches the documented excerpt |
| `status` | exit 0; `next_action` "Ready to delegate initial milestone: m1", `next_milestone` m1, `needs_alt` [] |
| `replan` with v2 copy | exit 0; `plan_version` v2 |
| `recover` with no interrupted milestone | exit 1, "No interrupted invocation" (matches Usage) |
| Killed-owner `recover` path | `node --test tests/test_ntg_vnext.mjs`: 12 pass, 0 fail |
| `dag-view.mjs` on example ledger and NTG fixture | exit 0 both |
| `agy plugin validate .` (AGY 1.3.3) | passes; shared install not uninstalled/reinstalled |
| `run`, `run --milestone`, `plan`, `alt`, `--escalate`, `--timeout`, `--watch` | **Marked, not run** (model usage / interactive); flags confirmed present in `scripts/ntg-vnext.mjs`, `scripts/runner.mjs`, `scripts/dag-view.mjs` |
| `git clone` / `agy plugin uninstall`+`install` | **Marked, not run** against the shared installation; `agy plugin --help` lists both subcommands |
| `git diff --check` | clean |
| `/home/` in diff | 0 |
| Files touched | `README.md`, `docs/**`, `.omo/evidence/docs-audit.md` only |
| `grep -i vnext README.md docs/ko/README.md` | 6 hits, all `scripts/ntg-vnext.mjs` command lines |

Historical live evidence is retained and linked, not presented as a new live run.
