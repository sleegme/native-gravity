# #141 README rewrite + #34/#30 MIT licensing — results

- Date: 2026-10-12
- Worktree: `<HOME>/work/native-gravity-141`, branch `docs/141-readme-license`, base `main` @ `0936cb2` (1.1.0)
- Executor: Dori brief `readme-license.md` (no nested coding agents, no paid `run`/`plan`/`alt` calls)

## Part A — #141 README rewrite (docs only) — DONE

### Files changed

- `README.md` — rewritten as an onboarding page (what it is → why over plain AGY →
  what works today → install → quick start → example → how it works →
  requirements/limitations → further reading).
- `docs/ko/README.md` — rewritten in natural Korean with the same structure and
  facts as the English page.
- `docs/internals.md` — NEW: dense material moved out of the README without loss
  (native-first boundary, ledger lock/recovery, role ownership & routing detail,
  Google AI Studio lane, alpha compatibility gate).
- `docs/usage.md` — minimal touch: links to the README quick-start plan example
  and to `docs/internals.md`.

### Fact verification (current main = 1.1.0)

| Fact | Verification | Result |
|---|---|---|
| Entry is `ntg-vnext`; no natively selectable primary; Excavator is a Bulldozer worker | `docs/status.md`, `AGENTS.md`, `scripts/spine.mjs` (Excavator delegated as worker) | README never presents Excavator as selectable; internal roles are not taught as an entry path |
| User must write a plan JSON; no one-sentence-goal UX | `scripts/ledger.mjs` `validatePlan` (requires `goal` + non-empty `milestones`) | README quick start leads with "you write a small plan file"; `ntg-vnext plan` described as advisory only (`adopted: false`, `scripts/ntg-vnext.mjs`) |
| Minimal plan is VALID | `node scripts/ntg-vnext.mjs init --ledger <HOME>/.cache/ntg141-tmp/l.json --plan <HOME>/.cache/ntg141-plan.json` then `status` | both exit 0; `next_action: "Ready to delegate initial milestone: m1"`, `next_milestone: "m1"` (plan copied to `<HOME>/.cache/ntg141-plan.json` first, per brief) |
| Instinct: `ntg-vnext alt`, Sonnet default, `--escalate` → Opus, advisory only | `scripts/runner.mjs` `ROLE_POLICY_TABLE.instinct` (Claude Sonnet 5.5 / High; escalated Claude Opus 5.5 / High only on explicit request); `scripts/ntg-vnext.mjs` `alt` returns `adopted: false` | documented accordingly (usage + architecture; README states advice is never auto-adopted) |
| npm availability | `npm view native-gravity version` → **404 Not Found** (registry has no `native-gravity`) | README says 1.1.0 is not on npm and installs from the repository (`git clone` + `agy plugin install .`); no npm availability claimed |
| Validated runtime AGY 1.3.3, maturity alpha | `docs/status.md`, header blocks | stated in both README headers and limitations |

The README example output is the real captured output of the verified
`init`/`status` run (trimmed to the fields shown). Paid `run`/`plan`/`alt`
calls were NOT executed, per the brief; the run flow is described from
`scripts/ntg-vnext.mjs` behavior and existing live evidence
(`.omo/evidence/134-vnext-activation.md`), not invented.

### Before/after readability review (first-time AGY reader)

- Before: after one intro sentence the reader was dropped into the
  Steamroller/Piledriver/Bulldozer topology; install appeared after ledger-lock
  PID/SIGKILL internals, the Studio A/B lane and compatibility history; no plan
  example; npm claimed without a publication check; Korean page was a literal
  translation with dense English technical phrasing.
- After: the reader gets what NTG is and why it beats plain AGY (verified
  behaviors with evidence links), then install and a runnable quick start with
  a verified minimal plan before any agent names appear; internal topology is
  one short flow plus links to architecture/internals; limitations are explicit
  (alpha, manual plan authoring, model costs, #136 fail-closed retry, Linux
  recovery, one session per ledger). The Korean page mirrors the structure in
  natural Korean. Moved detail is preserved verbatim-ish in `docs/internals.md`
  and linked from both READMEs and `docs/usage.md`.

## Part B — #34/#30 MIT licensing — STOPPED (closure evidence missing/contradictory)

Per the brief ("If closure evidence is missing or contradictory, STOP part B
and report exactly what is missing"), no LICENSE, no `package.json` license
field, and no THIRD_PARTY_NOTICES were added.

### What is missing (exactly)

1. **No statement of provenance closure in the #32/#33 closing comments or
   their PRs.** #32's closing comment freezes the extraction baseline and
   explicitly says "No clean rewrite or license change is performed by #32".
   #33's closing comment closes it "as superseded, not completed", states "The
   provenance requirement is NOT waived", and states "License transition
   remains blocked until the vNext clean implementation and provenance review
   are complete". No later comment or PR states that this provenance review was
   ever completed.
2. **No per-surface closure evidence inventory exists anywhere** (repo,
   `.omo/evidence/`, issue/PR history). The vNext contract §8.3
   (`docs/specs/vnext-architecture-contract.md`) requires that "for every row,
   closure evidence must identify the delivered artifact, permitted drafting
   sources and validation result" for 15 rows (13 core rewrite targets +
   `hooks.json` + `plugin.json`), and that "any unresolved provenance-uncertain
   distributed surface blocks #34/MIT". No such inventory was ever produced.
3. **The recorded provenance-closure run failed.** `.omo/evidence/2026-10-02-44g-findings.md`
   records the Provenance closure scenario as "Weak evidence only;
   EMPTY_RESPONSE, no per-surface authorship/validation inventory, closure NOT
   established" and states the evidence "does not authorize ... provenance
   closure".
4. **Later issue-#44 comments repeatedly keep it open**, e.g. (2026-10-03)
   "The §8.3 provenance closure audit remains incomplete. Source-reference
   scans found citations in 6/9 vNext draft role files and 3/9 top-level
   roles; mapped root rules, hooks, and plugin.json contain no permitted-source
   citation text. This is an evidence gap, not proof of improper derivation.
   The bounded AGY provenance audit timed out at 45 s without a result" and
   (2026-10-04) "provenance closure is still unproven". The final #44 comment
   (activation) declares completion of the runtime migration but makes no
   provenance-closure claim.
5. **Contradiction:** the contract's §8.3 sentence "Slice 44G confirmed that
   all vNext implementation surfaces are independently authored" (changed from
   "must confirm" to "confirmed" in `bd1c6c8`) is not supported by any recorded
   audit and is directly contradicted by items 3–4. The #134 activation run
   (`.omo/evidence/134-vnext-activation.md`) re-ran only the runner scenarios
   (P1–P3: multi-milestone, replan, Zen NO-GO, fresh-context resume, recover) —
   provenance closure was not among them.
6. **Coverage gap:** `agents/instinct.md` and the 1.1.0 surfaces (#20/#142)
   postdate the §8.3 mapping table entirely and have no provenance
   classification record from the #32 map process.

### What would unblock part B

- A per-surface closure inventory for every §8.3 row (delivered artifact,
  permitted drafting sources, validation result) plus classification of the
  post-44G surfaces (`agents/instinct.md` and any other 1.1.0 additions),
  recorded as the "final provenance summary from #33" that issue #34 requires;
  and
- a reconciled statement resolving the contract-vs-evidence contradiction
  (either re-run the provenance closure audit to success or correct the §8.3
  "confirmed" sentence).

If that review concludes no third-party-derived material remains in the
distributed files, part B becomes mechanical: root MIT `LICENSE` (holder from
`gh api users/sleegme -q .name`, 2026), `"license": "MIT"` in `package.json`,
LICENSE in package files, `npm pack --dry-run` re-check.

## Verification log (sequential)

`grep MemAvailable /proc/meminfo` → `MemAvailable: 9441152 kB` (run first, per brief).
`TMPDIR=$HOME/.cache/ntg141-tmp`; `set -o pipefail`.

| Command | Result |
|---|---|
| `node scripts/ntg-vnext.mjs init --ledger <HOME>/.cache/ntg141-tmp/l.json --plan <HOME>/.cache/ntg141-plan.json` | exit 0 (plan copied to `<HOME>/.cache/` first) |
| `node scripts/ntg-vnext.mjs status --ledger <HOME>/.cache/ntg141-tmp/l.json` | exit 0 |
| `python3 -m unittest discover -s tests` | exit 0 — `Ran 11 tests ... OK` (current tree: test_excavator_shell_guard 4 + test_zen_shell_guard 7) |
| `SKIP_LIVE_TESTS=1 node tests/test_agent_frontmatter.mjs` | exit 0 |
| `SKIP_LIVE_TESTS=1 node tests/test_dag_view.mjs` | exit 0 (1 skipped) |
| `SKIP_LIVE_TESTS=1 node tests/test_ledger.mjs` | exit 0 — 39 passed, 0 failed |
| `SKIP_LIVE_TESTS=1 node tests/test_ntg_vnext.mjs` | exit 0 |
| `SKIP_LIVE_TESTS=1 node tests/test_runner_spike.mjs` | exit 0 — 49 passed, 0 failed |
| `SKIP_LIVE_TESTS=1 node tests/test_spine.mjs` | exit 0 |
| `SKIP_LIVE_TESTS=1 node tests/test_studio_runner.mjs` | exit 0 |
| `SKIP_LIVE_TESTS=1 node tests/test_telemetry.mjs` | exit 0 |
| `agy plugin validate .` | exit 0 — 10 agents, 2 hooks processed |
| `npm pack --dry-run` | exit 0 — 28 files, 76.5 kB tarball. **LICENSE absent — expected**: part B stopped above |
| `git diff --check` | exit 0 |
| link check over `README.md`, `docs/ko/README.md`, `docs/usage.md`, `docs/internals.md` (all relative targets + anchors) | PASS — all resolve (two broken `docs/ko/` relative paths found and fixed during the run) |

## Provenance basis

This change set is documentation and evidence only (README pages, one new
`docs/internals.md`, two-line `docs/usage.md` addition). Content moved from the
old README is preserved text; new prose was authored for this task from the
observed facts listed above (CLI behavior read from `scripts/`, live claims
only from `.omo/evidence/`). No third-party material was introduced.
