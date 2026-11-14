# Pre-vNext Native Gravity v0.4 Behavior Baseline

Baseline commit: `427544cc39141df35918c0a6d79e6e1b4c208607`

This document preserves the final accepted behavioral baseline of the pre-vNext Native Gravity architecture.

It is a behavioral and provenance reference. It does **not** require vNext to preserve the current agent topology, delegation graph, implementation structure, or hook architecture.

For vNext design, each material behavior may be explicitly classified as `PRESERVE`, `MODIFY`, `REPLACE`, or `DROP`.

---

## Issue #32 Strengthened Specification & #33 Drafting Contract

This plan provides the implementation-neutral NTG-owned behavior specification to cleanly rebuild the current native-gravity baseline exactly as accepted in the current main branch, without relying on existing implementation as a drafting source.

## 1. Strengthened #32 Specification: Current Baseline Contracts

### Generic Invariants (`rules/harness.md`)

- **Contract Fields:** Implementations must enforce `GOAL`, `SCOPE`, `NON_GOALS`, `ACCEPTANCE`, `SOURCE_OF_TRUTH`, `DECISION_RULE`, `COVERAGE`, `COVERAGE_BASIS`, `EVIDENCE`, `EDIT_POLICY`, and `EXPECTED_OUTPUT`.
- **Source-of-truth / Decision-rule Discipline:** Decisions must remain traceable to permitted sources and derivation procedures. Substituting lower-authority sources, heuristics, or model judgment is strictly forbidden.
- **Evidence Boundaries:**
  - `OBSERVED`: Directly inspected in current artifact, tool output, or supplied authoritative context.
  - `INFERRED`: Conclusions requiring independent verification before taking consequential actions.
  - `UNKNOWN`: Material information not established.
- **Authority / Scope Boundaries:** Act only within role authority and exposed tools. Do not use unavailable authority indirectly. Treat explicit non-goals and read-only boundaries as hard constraints.
- **Mutation Effect Discipline:**
  - `READ_ONLY`: Inspection and evidence gathering.
  - `REVERSIBLE`: Mutation with clear practical undo path.
  - `PERSISTENT_OR_DESTRUCTIVE`: Requires exact identification, evidence-backed justification, and rollback path.
- **Anti-Bypass Safeguards:** When an effect is denied, it is forbidden to bypass the block through equivalent mechanisms (for example `tee`, temp patches, wrapper shells).
- **COVERAGE + COVERAGE_BASIS Closure:** Exhaustive contracts require establishing a complete set (`COVERAGE`) and providing independent evidence that the set is complete (`COVERAGE_BASIS`) before completion.
- **Actual-Result Verification:** Inspect the actual result before claiming pass. Static configuration checks do not prove runtime behavior.
- **BLOCKED / Failure Semantics:** Permitted only when all four conditions hold: verified blocker, prevents goal, no safe remediation remains, crosses hard capability/safety boundary.
- **Human Boundary:** Do not hand work back merely because a human step may occur later. Continue safe autonomous work.
- **Handoff Discipline:** Compact, decision-relevant packets only: result, evidence, unknowns, material risk, next action.
- **Completion Authority:** Local delegation readiness is not global completion. Only primary agents (Bulldozer, Piledriver, Excavator) may claim completion of owned work.

### Orchestration & Roles (`rules/orchestration.md`, `agents/*.md`)

- **Bulldozer:** Host/orchestrator. Spawns specialists but does not directly mutate project files.
- **Piledriver:** Plan-first strategist. Planning boundary is strict (no implementation).
- **Excavator:** Autonomous troubleshooter. Direct mutation/repair authority. Uses sudo (bounded). Commands prefix: `NTG_EXCAVATOR=1`.
- **Bobcat:** Ordinary worker. Subject to `ADVISOR_GATE: REQUIRED | NONE`. May only invoke `strix-halo`.
- **Puma:** Fast worker for mechanical/low-risk text edits. No subagents.
- **Jaguar:** Read-only factual discovery. No subagents.
- **Steamroller:** Read-only deep reasoning for architecture/trade-offs. No subagents.
- **Strix Halo:** Read-only advisor gate for Bobcat (`VERDICT: ACCEPT | REVISE | NEEDS_DEEP`). No subagents.
- **Zen:** Independent read-only verification. Must use `NTG_ZEN_VERIFY=1`. Yields `VERDICT: GO | NO-GO`.

### Effect-Level Contracts: Shell Guards (`hooks/*.py`)

**Excavator (`excavator-shell-guard.py`)**

- Privilege-Drift Prevention: blocks `sudo -S/--stdin`, direct `su`/`pkexec`, brute-force password loops, loopback root SSH, and reading shell history files.
- Unsafe Broad-Upgrade Prevention: blocks `pacman -Syu`, `apt full-upgrade`, `dnf system-upgrade`, `zypper dup`, etc.
- Bypass Handlers: explicit shlex pipeline parsing, env unwrapping, subshell recursion.

**Zen (`zen-shell-guard.py`)**

- Intentional Mutation Prevention: blocks shell redirection (`>`), file modifiers (`rm`, `mv`, `cp`, `sed -i`), git mutations (`commit`, `checkout`, `push`), package-manager mutations, in-place formatters (`prettier --write`), and programmatic inline-script writes.

## 2. Behavior-Home Map

| Behavior / Capability | Canonical Home |
|---|---|
| Core Contract Fields, State Bounds, Effect Bounds, Coverage Closure | `rules/harness.md` |
| Orchestration topologies, Correction routing, Gate discipline | `rules/orchestration.md` |
| Tools, Authority, Subagent mapping, mainAgent properties | `agents/*.md` (x9) |
| PreToolUse Interception mapping | `hooks.json` |
| Privilege/Upgrade drift enforcement | `hooks/excavator-shell-guard.py` |
| Read-only mutation block enforcement | `hooks/zen-shell-guard.py` |
| Basic plugin metadata and schema | `plugin.json` |

## 3. Current vs Pending Matrix

| Item / Behavior Element | Status |
|---|---|
| `harness.md` (Contract Fields, Effect Disciplines, Coverage Bounds) | `OBSERVED_CURRENT_MAIN` |
| `orchestration.md` (Topologies, Bobcat Gate, Zen rules) | `OBSERVED_CURRENT_MAIN` |
| `agents/*.md` (All 9 role definition boundaries) | `OBSERVED_CURRENT_MAIN` |
| `hooks/*` (Effect blocks via shlex/regex logic) | `OBSERVED_CURRENT_MAIN` |
| `hooks.json`, `plugin.json` (Runtime Metadata) | `OBSERVED_CURRENT_MAIN` |
| Issue #22 (Jaguar-first Principle) | `PENDING_ONLY (EXCLUDE)` |
| Issue #24 | `PENDING_ONLY (EXCLUDE)` |
| Issue #29 (Child Result Integration / One-Rule-One-Home) | `PENDING_ONLY (EXCLUDE)` |
| PR #15 (Zen gate optional) | `PENDING_ONLY (EXCLUDE)` |
| PR #26 | `PENDING_ONLY (EXCLUDE)` |
| Issue #37 | `PENDING_ONLY (EXCLUDE)` |
| Issue #38 | `PENDING_ONLY (EXCLUDE)` |
| Issue #39 | `PENDING_ONLY (EXCLUDE)` |
| Issue #40 | `PENDING_ONLY (EXCLUDE)` |
| PR #41 (`feat/clean-rewrite-issue-33` codebase changes) | `PENDING_ONLY (EXCLUDE)` |

## 4. Coverage + Provenance Map

### 13 Core Rewrite Targets

The core rewrite count is exactly **13**: 9 agent definitions, 2 rule files, and 2 hook implementations.

| Core Target | Behavior Obligations | Canonical Home | Status | Provenance Status | Validation Obligations |
|---|---|---|---|---|---|
| `rules/harness.md` | Generic invariants, contract fields, coverage closure | `rules/` | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | Static review |
| `rules/orchestration.md` | Primary/specialist boundaries, Bobcat gate | `rules/` | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | Static logic |
| `agents/bobcat.md` | Ordinary worker, advisor gate | `agents/` | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | Schema + Real AGY |
| `agents/bulldozer.md` | Primary orchestrator | `agents/` | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | Schema + Real AGY |
| `agents/excavator.md` | Primary repair, bounded sudo | `agents/` | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | Schema + Real AGY |
| `agents/jaguar.md` | Read-only discovery | `agents/` | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | Schema + Real AGY |
| `agents/piledriver.md` | Primary planning-only | `agents/` | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | Schema + Real AGY |
| `agents/puma.md` | Fast mechanical worker | `agents/` | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | Schema + Real AGY |
| `agents/steamroller.md` | Deep reasoning specialist | `agents/` | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | Schema + Real AGY |
| `agents/strix-halo.md` | Read-only advisor gate | `agents/` | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | Schema + Real AGY |
| `agents/zen.md` | Independent review, VERDICT | `agents/` | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | Schema + Real AGY |
| `hooks/excavator-shell-guard.py` | Privilege drift / broad upgrade block | `hooks/` | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | Unit tests |
| `hooks/zen-shell-guard.py` | Intentional project mutation block | `hooks/` | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | Unit tests |

### Runtime / Config Preservation Surfaces

These are preservation and validation surfaces, **not** part of the 13 core rewrite target count.

| Target | Purpose | Status | Provenance Status | Validation |
|---|---|---|---|---|
| `hooks.json` | PreToolUse registrations | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | `agy plugin validate` |
| `plugin.json` | Plugin metadata and schema | `OBSERVED_CURRENT_MAIN` | provenance-uncertain | `agy plugin validate` |

### Distribution Plumbing (Separate from Core Rewrite Surface)

| Distribution Target | Purpose | Canonical Home | Status | Surface Category |
|---|---|---|---|---|
| `package.json` | Distribution metadata / tooling | `/` | `OBSERVED_CURRENT_MAIN` | Distribution Plumbing |
| `scripts/npm-install.mjs` | Installation hook | `scripts/` | `OBSERVED_CURRENT_MAIN` | Distribution Plumbing |

## 5. #33 Clean Drafting Contract

- **Authoritative Source:** The implementer must build the core targets strictly from the constraints articulated in this specification to safely convert them from provenance-uncertain to NTG-owned.
- **Prohibited Sources:** The implementer must not read current implementations, branch history, or legacy specs (OMO/GJC/OMP Original Source Specs, PR #41) as a drafting source.
- **Contract Fulfillment:** Ensure all items in the matrix are covered without flattening role boundaries or skipping effect-level safeguards. Pending behavior explicitly excluded in the matrix must not be introduced.

## 6. Static + Real AGY Validation Contract

### STATIC Validation

- Validate `plugin.json` and `hooks.json` against Antigravity schema.
- Validate YAML frontmatter structural compliance for all 9 core agents individually.
- Validate `excavator-shell-guard.py` AST/shlex logic against known upgrade bypass arrays via unit tests.
- Validate `zen-shell-guard.py` regex/redirection interception logic via unit tests.
- Ensure `agy plugin validate .` passes deterministically.

### REAL AGY Validation

- Observe Bulldozer (Primary) is correctly invocable.
- Observe subagent enforcement bounds restrict cross-talk (for example, Bobcat cannot invoke Puma).
- Observe actual Excavator autonomous execution utilizing `NTG_EXCAVATOR=1`.
- Observe actual Zen independent read-only verification utilizing `NTG_ZEN_VERIFY=1`.
- Observe the full execution path `Bulldozer -> Bobcat -> Strix Halo` running dynamically without loops.

## 7. Remaining UNKNOWN

- Default behavior of `inheritCustomizations` when omitted in agent frontmatter `.md` files (runtime-engine specific).
- Dynamic enforcement mechanism for hook prefixes (`NTG_EXCAVATOR=1` / `NTG_ZEN_VERIFY=1`) if any external dependency exists beyond the instructed shell guards.
- Whether undocumented external CLI wrapper environments exist in user systems that might systematically bypass Python shlex lexing in the shell guards.

## 8. Zen Verdict

Zen independently reviewed the updated provenance specification against the requested criteria.

- **Zen Verification Result:** `VERDICT: GO`
- **Reasoning:** The provenance classification correctly avoids circularity, properly flags the current core artifacts as provenance-uncertain, clearly categorizes `package.json` and installation scripts as Distribution Plumbing, attributes `inheritCustomizations` semantics correctly to the agent frontmatter, and cleanly enforces the OMO/GJC/OMP documents as forbidden drafting sources rather than pending behavior.

`PLAN READY`
