---
slug: agy-1-3-1-patch
status: draft
intent: unclear
review_required: true
plan_path: .omo/plans/agy-1-3-1-patch.md
review_round_limit: 5
---

# Plan: Patch NTG for AGY 1.3.x compatibility

## TL;DR for humans

AGY CLI jumped from 1.2.12 (installed) to 1.3.1 (upstream changelog). Several upstream changes touch surface NTG depends on. Patch = bump the pinned AGY, re-verify NTG's contract surface, update code that assumed 1.2.x, and document the change. This is **verification + version-bump work**, not new features.

**Owner-decision baked in**: after the patch, NTG still targets AGY ≥1.3.0. If a rollback pin is needed, the workspace config can keep 1.2.12 with a note, but the default goes to 1.3.1.

## Affected user / ideal state / gap

| Row | Who | Uses today | After |
|-----|-----|-----------|-------|
| IS-1 | NTG operator | `ntg-run --agent bulldozer -p "…"` runs against 1.2.12; contract assumptions written for that line | Same command works on 1.3.1, evidence-backed |
| IS-2 | Plugin agent `.md` reader | `tools:`, `commandExecutionPolicy:`, `subagent:` keys drive role boundaries | Upstream "custom agent controls" does not strip these keys on primary runs; if it does, NTG documents a workaround |
| IS-3 | Zen/Excavator gates | `NTG_ZEN_VERIFY=1` / `NTG_EXCAVATOR=1` markers reach run_command via hooks | Hook guard unchanged; markers still deliver under 1.3.1 `--dangerously-skip-permissions` + `run_command` shape |
| IS-4 | Puma/Jaguar/Steamroller | `model: flash` / `pro` aliases resolve | Aliases still resolve on 1.3.1's `models` table; ROLE_POLICY_TABLE unchanged |
| IS-5 | Docs | ntg-run comment says "AGY 1.2.x" | Comments track the pinned major.minor |

GAP-1 | ntg-run.mjs comments name "AGY 1.2.x"; runner.mjs ROLE_POLICY_TABLE references current Gemini 3.1 Pro / 3.8 Flash families that may have moved in 1.3.1 | closed by todo 1-3
GAP-2 | Upstream fixed "headless -p runs sometimes exiting before the agent could respond" (1.2.15). NTG relies on prompt completing before return; if behavior changed, queueing semantics shift | closed by todo 4
GAP-3 | Upstream fixed "markdown custom agents ignoring skills:/plugins:/rules:/agents:/hooks: paths relative to the agent's own file" (1.3.1). NTG agents currently only use inline `tools:` etc — no relative-path usage found; re-verify | closed by todo 5
GAP-4 | Upstream fixed "permission request not approved … respects the denial" (1.2.15). NTG's bulldozer uses `--dangerously-skip-permissions` — verify this still bypasses the dialog | closed by todo 4
GAP-5 | Upstream added plugins marketplace (2.18.1 desktop). NTG plugin.json schema is unchanged (`v1/plugin.json`); upstream CLI subcommands `plugin install/enable` are new — no action needed beyond smoke | closed by todo 6
GAP-6 | NTG lacks a documented AGY minimum-version check | closed by todo 7

## Scope IN

- Bump `AGY_PATH`-resolved `agy` reference docs/comments to reflect 1.3.1.
- Verify every invocation flag NTG uses still exists and behaves (`--model`, `--output-format`, `--print`, `--dangerously-skip-permissions`, `--agent`, `models` subcommand output shape).
- Verify the four role markdowns parse on 1.3.1 (`agy agents` listing).
- Regression-run the 11-item Compatibility Validation checklist from AGENTS.md under 1.3.1.
- Update ntg-run / runner / plugin docs that mention "1.2.x".
- Record a one-line compatibility note in VERSION history if there is one.

## Scope OUT (Must NOT have)

- No new roles, tools, or model tiers.
- No change to hook logic itself (guards stay as-is).
- No Desktop-app pinning — desktop 2.19.x is a separate surface.
- No marketplace/plugin-economy integration work.
- No rewrite of ROLE_POLICY_TABLE.

## Planning-time verification (2026-10-07)

Standalone 1.3.1 tarball side-installed (no system package change). Full probe diff + headless smokes: `.omo/evidence/agy-1-3-1/side-probe.md`. Bottom line: NTG's entire contract surface is IDENTICAL on 1.3.1 for the probed paths; remaining risk concentrates in interactive/hook paths (todo 4) which need a real workspace run.

## Findings (cited - path:lines)

- `scripts/ntg-run.mjs:3-10` — comment reads "AGY 1.2.x" and injects `NTG_ROLE` marker for gated roles (bulldozer, piledriver).
- `scripts/runner.mjs:14` — `ROLE_POLICY_TABLE` expects `Gemini 3.1 Pro` and `Gemini 3.8 Flash` families; slugs resolved via `agy models` at runtime (line 157).
- `scripts/runner.mjs:545` — comment "The composed role body is the machine contract. Do not add --agent" — NTG intentionally avoids `--agent` because installed primary agents inject released contracts.
- `scripts/runner.mjs:560` — `--dangerously-skip-permissions` added only for bulldozer role.
- `hooks.json` — Zen/Excavator `PreToolUse` guards on `run_command`; `Stop` gates on `excavator-review-gate.py` and `primary-review-gate.py`.
- `plugin.json` — schema `https://antigravity.google/schemas/v1/plugin.json` (v1).
- `agents/*.md` — 9 role files, all use frontmatter `tools:`, `subagent:`, `mainAgent:`, `commandExecutionPolicy:` and inline `model:` (`inherit` / `flash` / `pro`).
- `docs/specs/vnext/agents/` — same shape.
- `VERSION` = `0.4.0`.

## Open assumptions (announced defaults)

| Assumption | Adopted default | Reversible? |
|---|---|---|
| Bump target is CLI 1.3.1 (latest in `agy changelog`), not a later release | Yes — update to 1.3.1 and treat newer CLI drops as new upstream releases | Yes — pin back via AGY_PATH or env |
| NTG still composes role body itself; upstream agent frontmatter keys are unchanged | Validate on the real binary, not assumed | Yes |
| Compatibility checklist in AGENTS.md remains the regression surface | Yes — run all 11 items after upgrade | n/a |
| The Desktop 2.19.x changelog is NOT the NTG target | Confirm in plan handoff | n/a |

## Decisions

1. Work on a feature branch `feat/agy-1-3-1-compat`, not main.
2. Validate against the real `agy` binary in this shell before any code edit.
3. If a contract changes (e.g. `tools:` frontmatter is ignored for custom agents on 1.3.1), mark the role file + bump logic, do NOT silently restructure.
4. Compatibility validation must use a real workspace, not a fixture, for the permission-denial path.

## Todos

- [x] 1. ~~Upgrade `agy`~~ Superseded at planning time: standalone 1.3.1 binary side-installed to `/tmp/agy-1-3-1/antigravity` (system pacman package `antigravity-cli 1.2.12` untouched — upgrade is a PO/pacman decision, not part of this patch). `agy --version` → `1.3.1`, `agy models` head identical to 1.2.12. Evidence: `.omo/evidence/agy-1-3-1/side-probe.md`.
  Recommended task executor category: unspecified-low

- [x] 2. ~~Smoke every flag~~ Done at planning time via `scripts/agy-compat-check.mjs` + headless smokes on 1.3.1: `--print`+`--model`+`--output-format json` → SUCCESS/exit 0; `--dangerously-skip-permissions` → SUCCESS; `--agent bulldozer` → SUCCESS (installed plugin primary loads). Evidence: `.omo/evidence/agy-1-3-1/side-probe.md`.
  Recommended task executor category: unspecified-low

- [ ] 3. Update every code/doc comment that says `1.2.x`: `scripts/ntg-run.mjs` header, any runner comment that names the pinned line, README quickstart if it pins a version.
  Recommended task executor category: quick
  QA: `grep -nE '1\\.2\\.'` returns zero hits under `scripts/`, `docs/`, `README.md`, `AGENTS.md`.

- [ ] 4. Regression-run the Compatibility Validation checklist (AGENTS.md items 1-11) under 1.3.1 in a real workspace. Especially: item 4 (Piledriver → Jaguar + Zen), item 5-7 (Excavator + Zen gate), and the permission-denial-respected upstream fix — verify bulldozer `--dangerously-skip-permissions` still bypasses the dialog and that non-bulldozer agents still see permission prompts.
  Recommended task executor category: deep-low
  QA: checklist results written to `.omo/evidence/agy-1-3-1/compat-checklist.md`, each item marked PASS/FAIL with the command used.

- [ ] 5. Verify custom-agent frontmatter keys (`tools:`, `commandExecutionPolicy:`, `subagent:`, `mainAgent:`) still apply to a fresh `agy` session in 1.3.1. If upstream's "custom agent controls" change lets users disable default prompts/tools on a per-agent basis, document whether NTG agents rely on defaults being enabled.
  Recommended task executor category: deep-low
  QA: `.omo/evidence/agy-1-3-1/frontmatter.md` records observed behavior for each key on each of the 9 agents.
  Verified during planning (2026-10-07): `model:` frontmatter accepts ONLY `inherit | flash | pro` — explicit model slugs on subagents are NOT supported on any released CLI line (changelog + https://antigravity.google/docs/subagents/). NTG's ROLE_POLICY_TABLE therefore stays the only path for exact-slug pinning (headless runner). No code change needed; record this as confirmed in frontmatter.md.

- [ ] 6. Verify the new upstream `plugin` subcommand does not conflict with NTG's `plugin.json` install path. Run `agy plugins list` and `agy plugin list` — confirm NTG registers or fails with a clear message either way.
  Recommended task executor category: unspecified-low
  QA: `.omo/evidence/agy-1-3-1/plugin-list.txt`.

- [ ] 7. Add a minimum-AGY-version check to `scripts/npm-install.mjs`: fail fast with `AGY_VERSION_TOO_OLD` if `agy --version` reports < 1.3.0. Keep `AGY_PATH` override working.
  Recommended task executor category: unspecified-low
  QA: a synthetic `agy` shim that echoes `1.2.0` produces the typed failure; a shim echoing `1.3.1` passes.

- [ ] 8. Update `AGENTS.md` and `README.md` where they describe the supported AGY line; bump `VERSION` to `0.4.1` if that is the release convention, else note the compat bump in a changelog section.
  Recommended task executor category: quick
  QA: `grep -nE 'AGY.*1\\.3|antigravity.*1\\.3' AGENTS.md README.md` shows updated text.

- [ ] F1. Full project test suite (`npm test` or equivalent) on the bumped AGY. Zero failures.
  Recommended task executor category: deep-low

- [ ] F2. Fresh reviewer pass on the diff before merge.
  Recommended task executor category: deep-high

## Dependency

1 → 2, 3, 5, 6, 7 (any order after 1)
4 can run in parallel with 2 once 1 is done.
8 last, after evidence is in.
F1 and F2 run after 1-8.

## Handoff

Plan is decision-complete for execution. The implementer reads this file and runs each todo against the real `agy` binary, recording evidence under `.omo/evidence/agy-1-3-1/`. If any upstream change breaks a NTG contract, that todo is amended in place with the observed break before proceeding.
