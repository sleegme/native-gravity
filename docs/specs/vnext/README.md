# vNext drafts — NOT INSTALLED, NOT ACTIVATED

This tree holds the vNext (Tiger C clean-room / issue #44F/D drafting) agent and
ruleset material as **drafts only**. Nothing here is reachable from the live
install surface:

- `scripts/npm-install.mjs` installs only what `package.json`'s `files` list
  ships (`agents/`, `commands/`, `hooks.json`, `rules/`, `templates/` at the
  repo root) — this `docs/specs/vnext/` subtree is not in that list and is
  never shipped or loaded.
- `hooks.json` at the repo root wires only root-level hooks; the
  `docs/specs/vnext/hooks.json` copy inside is reference material and is not
  wired to anything.
- The live `agents/*.md` and `rules/*.md` at the repo root remain the active
  v0.4 prompts (including the Piledriver `PLAN READY` discipline the
  `hooks/primary-review-gate.py` Stop hook enforces).

When a vNext activation change is proposed it must come as a separate, clearly
marked change — copying this tree into the root paths is out of scope for any
draft-only PR.
