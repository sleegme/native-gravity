# Issue #56 validation pass — vNext vs Antigravity host surface

Date: 2026-09-29. Host under test: `agy` 1.2.12 (Antigravity CLI) installed at `~/.local/bin/agy`.
Branch under test: `origin/vnext/44g-activation` (PR #55 head `0c7aea0`).

## Validated surfaces (observed)

| Check | Result | Evidence |
|---|---|---|
| `agy plugin validate .` | PASS | `agents: 9 processed`, `hooks: 2 processed`, no errors |
| Plugin unit tests (node) | PASS 40/40 | `node --test tests/*.mjs` on branch checkout |
| Python hook tests | PASS 15/15 | `python -m unittest discover -s tests` |
| Role frontmatter declarations | PASS (static only) | `steamroller.md`, `excavator.md`, `bulldozer.md`, `piledriver.md` carry `mainAgent: true`; `bobcat.md`, `jaguar.md`, `puma.md`, `strix-halo.md`, `zen.md` carry `subagent: true`. This is frontmatter existence, not live discovery — live routing calls could not be exercised (see gaps below) |
| Hook registration | PASS | `hooks.json` declares two `PreToolUse` entries on `^run_command$` |

## Host tool-surface mismatch (blocking for live path validation)

Declared tool names across `agents/*.md` and `hooks/*.py` reference `list_dir`,
`find_by_name`, `grep_search`, `multi_replace_file_content`, and `run_command`.
The live `agy` 1.2.12 `--print` surface answers confirmed presence for
`run_command`, `invoke_subagent`, `view_file`, `write_to_file`,
`replace_file_content` and absence for `list_dir`, `find_by_name`,
`grep_search`, `multi_replace_file_content`.

Affected declarations (all four absent names):

- `agents/excavator.md`: `list_dir`, `find_by_name`, `grep_search`, `multi_replace_file_content`
- `agents/bobcat.md`: `list_dir`, `find_by_name`, `grep_search`, `multi_replace_file_content`
- `agents/bulldozer.md`: `list_dir`, `find_by_name`, `grep_search`
- `agents/piledriver.md`: `list_dir`, `find_by_name`, `grep_search`
- `agents/steamroller.md`: `list_dir`, `find_by_name`, `grep_search`
- `agents/jaguar.md`: `grep_search`
- `agents/puma.md`: `grep_search`
- `agents/strix-halo.md`: `grep_search`
- `agents/zen.md`: `grep_search`

Consequence: even where `agy plugin validate` accepts the plugin, an activated
Excavator/Steamroller role cannot execute `list_dir`/`find_by_name`/`grep_search`
under 1.2.12 — the tools do not exist on this host surface. Live runtime
validation (primary discovery → subagent invocation → hook firing) could not be
completed in this environment because `agy --print` calls returned
`error: interrupted` for multi-step prompts; static and plugin-validate checks
above were all executed and passed.

## Decision: `$loop` opt-in for strict orchestration

Recommended: adopt `$loop` as the strict-supervisor opt-in gate. Rationale:

- Issue text already frames always-on orchestration as unnecessarily heavy for
  simple tasks; Steamroller without `$loop` stays a capable general primary.
- Under `$loop`, the ledger + milestone + Zen chain activates; outside `$loop`,
  no ledger bookkeeping cost applies.
- The contract is testable: `$loop` presence in the initial request turns the
  supervisor into strict mode; absence leaves normal primary behavior.

This is a recommendation, not an implementation; the acceptance list marks it
"if `$loop` is chosen, its activation contract is explicit and testable" —
this document supplies that contract.

## Remaining gaps for #56 completion

- Live subagent routing calls (Steamroller→Zen, Bulldozer→Jaguar/Puma/Bobcat,
  Bobcat→Strix Halo) and runner exact-model calls need a host where
  `agy --print` completes multi-tool sessions without interruption — not
  achievable in this session (`error: interrupted` twice).
- Whether the missing tool names are a deliberate host rename (new canonical
  surface) or an environment deficiency is undetermined; a follow-up should
  confirm against the intended 09 Preview image before renaming.
