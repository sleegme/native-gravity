# PR #53 independent gate review

recommendation: REJECT
verdict: FAIL
reviewed head: `88045b507100a35e015b15f6b353fa6698561769` (`git fetch origin docs/44d-cleanroom-astra`; `git diff origin/main...FETCH_HEAD`)
target main: `d22e6e47e3e3559b956fa2da12b2fa4e8c5ae3e1`

## originalIntent and desiredOutcome

originalIntent: Independently assess the Tiger C clean-room vNext drafting PR, including updated Piledriver and orchestration rules, without modifying production files.
desiredOutcome: A genuinely non-activated #44D/#44F draft, retaining the released v0.4 install/hooks/plan-readiness behavior, Jaguar-first discovery, and one consistent routing contract, with no unrelated changes.
userOutcomeReview: The PR changes the actual distributed role/rule files instead of introducing separately named draft role/rule files. The unchanged installer packages those changed paths and invokes `agy plugin install` on the packaged directory. A warning within active prompt files does not isolate them from the active runtime. Consequently the released v0.4 entry points and plan gate no longer match their documentation and hooks. This is not an approvable non-activated draft.

## blockers

1. violatedCriterion: `1 — non-activated drafts; live v0.4 install paths/hooks unaffected`
   evidencePointer: `FETCH_HEAD:agents/bulldozer.md:1-16`, `FETCH_HEAD:agents/piledriver.md:1-16`, `FETCH_HEAD:agents/steamroller.md:1-16`, `FETCH_HEAD:rules/harness.md:1-7`, `FETCH_HEAD:rules/orchestration.md:1-9`, `FETCH_HEAD:package.json` (`files: ["agents/", "hooks/", "rules/", ...]`), `FETCH_HEAD:scripts/npm-install.mjs` (`agy plugin install packageRoot`), `origin/main:hooks.json` (Stop hook registrations).
   observation: The actual installed role/rule paths are overwritten: Bulldozer and Piledriver change `mainAgent: true` to `false`, remove tools and native delegation, and Steamroller changes to `mainAgent: true` with no tools. The active v0.4 rules are replaced in place. After merging this PR onto main, the unchanged package/installer and registered hooks point at these changed files, so the migration is activated in the default install despite its NON-ACTIVATED prose. The head itself has older hooks.json, but the PR's triple-dot diff does not modify hooks.json on target main.

2. violatedCriterion: `3 — Piledriver preserves plan-readiness gate OR is a clearly marked draft that does not feed the active prompt`
   evidencePointer: `git diff origin/main...FETCH_HEAD -- agents/piledriver.md` (removes `PLAN_STATUS: READY | NEEDS_DISCOVERY | BLOCKED`, current Zen GO requirement and final `PLAN READY`); `FETCH_HEAD:agents/piledriver.md:1-16,36-63`; `origin/main:hooks/primary-review-gate.py:12-15,33-49` and `main()` at file end; `origin/main:hooks.json` Stop registration; `FETCH_HEAD:package.json`, `FETCH_HEAD:scripts/npm-install.mjs`.
   observation: The live Piledriver prompt is replaced by an advisory vNext prompt which prohibits completion claims and supplies neither the Zen plan-review route nor `PLAN READY`. The existing Stop hook only enforces a Zen GO if its exact `PLAN READY` line occurs. Piledriver is also no longer a selectable primary. The marked draft DOES feed the installed active prompt, so neither branch of the criterion holds.

3. violatedCriterion: `4 — no duplicated or contradictory routing contract across files`
   evidencePointer: `FETCH_HEAD:AGENTS.md` sections `v0.4 architecture`, `Routing principle`, `Evidence and completion`, and `vNext topology preparation`; `FETCH_HEAD:README.md` sections `v0.4 primary modes`, `Bulldozer internal team`; `FETCH_HEAD:docs/usage.md` section `Choose a primary mode`; `FETCH_HEAD:rules/orchestration.md:11-54`; `FETCH_HEAD:agents/steamroller.md:1-39`.
   observation: The installed/visible v0.4 contract routes difficult decisions from primary Bulldozer to specialist Steamroller, while the rewritten active rules and agent frontmatter make Steamroller the sole primary and Bulldozer non-primary. Scope labels in AGENTS.md acknowledge separate contexts but no path in package.json/installer actually selects the old v0.4 role/rule files for released users; thus these are contradictory operational routing instructions, not two isolated contracts.

## criterion-by-criterion checks

- `1`: FAIL as above. No `scripts/install.sh` exists in FETCH_HEAD or origin/main; the real installer is `scripts/npm-install.mjs`. The requested `hooks/primary-review-gate.py` exists on target main, not FETCH_HEAD (branch is behind target main). Target main `hooks.json` registers it. Neither hook nor hooks.json is changed by the triple-dot PR diff; that does not cure changed prompt inputs.
- `2`: PASS for draft text. `FETCH_HEAD:rules/orchestration.md:26-30` preserves Jaguar-first read-only discovery, with state-changing observation routed to a mutation-capable worker; this matches the v0.4 rule removed/re-authored in this PR. It is still not isolated from the live rules path.
- `3`: FAIL as above. The current Stop hook recognizes explicit agent identities even without its old signature, and checks `PLAN READY` before requiring current GO; the new prompt no longer requests that sentinel.
- `4`: FAIL as above. vNext draft files internally agree on Steamroller authority and Zen promotion; conflict is between those active files and still-live v0.4 docs and hooks.
- `5`: Scope of six changed paths (`AGENTS.md`, three agents, two rules) is generally drafting-related. However `rules/orchestration.md:5` says no AGENTS change is authorized by this slice while AGENTS.md is modified; this is an internal scope contradiction, secondary to the live-activation blocker. No unrelated production code or tests changed in the triple-dot diff.

## inspected artifacts and evidence gaps

Checked artifact paths: `git diff origin/main...FETCH_HEAD` for all six changed paths; `FETCH_HEAD:package.json`, `FETCH_HEAD:scripts/npm-install.mjs`, `FETCH_HEAD:hooks.json`, `origin/main:hooks.json`, `origin/main:hooks/primary-review-gate.py`, `FETCH_HEAD:README.md`, `FETCH_HEAD:docs/usage.md`, `FETCH_HEAD:docs/specs/vnext-architecture-contract.md`, `FETCH_HEAD:docs/specs/pre-vnext-v0.4-behavior-baseline.md`, `FETCH_HEAD:agents/jaguar.md`, `FETCH_HEAD:agents/bobcat.md`, `FETCH_HEAD:agents/zen.md`, `origin/main:scripts/spine.mjs`, `FETCH_HEAD:scripts/runner.mjs`, `origin/main:tests/test_primary_review_gate.py`, `origin/main:tests/test_spine.mjs`. Read `remove-ai-slops/SKILL.md` and `programming/SKILL.md` from installed plugin skills. `git diff --check origin/main...FETCH_HEAD` produced no whitespace errors.

Exact evidence gaps: No original executor evidence artifact, code-review report, manual-QA matrix, or notepad path was supplied, and none was found in the inspected workspace; therefore cannot confirm a code-review report performed the required skill-perspective/overfit pass. The claimed 37 Node + 83 Python tests on pushed head are not independently reproduced: worktree is at target main, not fetched head, and this read-only gate did not alter checkout or create a throwaway source tree. Those tests would not prove isolation of distributed prompt paths. No live AGY install attempted; the package manifest and installer already disprove the required non-activation property. `scripts/install.sh` and `hooks/primary-review-gate.py` are absent on fetched branch; the former is absent on target main too, whereas the latter is present and registered on target main. `git merge-base origin/main FETCH_HEAD` is `f00f8ba7e0bbe8a85bbb54f26e6ba4fd8b1ba92c`, not current main `d22e6e47e3e3559b956fa2da12b2fa4e8c5ae3e1`; the stated rebase onto current main is not demonstrated. The triple-dot diff remains the requested PR scope.

## direct remove-ai-slops / programming pass

Six changed files are prose plus machine-consumed YAML frontmatter; no production functions or test edits in the PR diff. No newly added excessive, deletion-only, tautological, implementation-mirroring, wording-pinning, or timing-sensitive tests; no needless extraction, parsing, normalization, wrappers, or code abstractions. The prose contains repeated non-activation disclaimers and repeats vNext topology in AGENTS.md and rules/orchestration.md; that repetition is a maintenance note, not independently a blocker. Programming skill's machine-consumed-value rule matters here: `mainAgent`, `subagent`, `tools`, and installed path names are behavioral config, not harmless prose. The branch has no test that demonstrates default v0.4 selection after installation; passing old test counts are false confidence on this criterion. No new tests should pin draft prose. Review-report confirmation: unavailable (missing code review artifact), explicitly not substituted by this direct check.

Recommendation: REJECT until drafts are isolated from all distributed/live v0.4 agent and rule paths, and the existing Piledriver Zen/PLAN READY gate and coherent active routing remain intact until 44G activation.
