# vNext drafts — NOT INSTALLED, NOT ACTIVATED

This tree holds the non-activated vNext agent/rule drafts and explanatory docs
for issue #44. Merged implementation slices do not make this draft tree an
installed runtime or establish that its activation boundary is satisfied.

## Current draft topology

```text
User
  Steamroller — supervisor / authoritative ledger owner
    Piledriver — bounded planning, architecture and difficult decisions
    Bulldozer — one bounded milestone
      Jaguar / Puma / Bobcat
                       Strix Halo — Bobcat-local advisor gate
    Zen — independent milestone verification
    Steamroller ledger transition
```

Steamroller alone adopts plans, writes authoritative ledger state, promotes
milestones and declares global completion. Bulldozer returns a pre-review
candidate; Steamroller must observe independent Zen GO matching the milestone,
current plan version and immutable result reference before promotion.
Excavator remains a separate troubleshooting primary outside the P0 spine;
its recovery reconnection is post-44G. Instinct is future work.

The narrow runner owns exact-model resolution, effort, bounded prompt/context,
timeouts, recursion protection, result capture and structured failures for
Steamroller/Piledriver/Bulldozer. Native specialist roles retain their local
authority; draft frontmatter is not proof of runtime isolation.

## Sources and implementation state

- [Architecture contract](../vnext-architecture-contract.md) — role authority,
  ledger, handoffs and migration boundary.
- [Current agents](./agents/) and [rules](./rules/) — isolated vNext contracts.
- [Architecture](./docs/architecture.md), [status](./docs/status.md) and
  [usage](./docs/usage.md) — overview of merged #44 work and validation limits.
- [한국어](./docs/ko/README.md) — matching Korean overview.

44B–44F runner, ledger, core-role, spine and specialist work is implemented.
44G integration evidence exists, but vNext remains **non-activated** until
activation/validation requirements, including authority/inheritance isolation,
are satisfied. These docs do not freeze unresolved decisions.

Issue #56 is still deciding whether strict orchestration is always-on or
explicitly activated via `$loop`. `$loop` is a **candidate pending #56 live
validation**, not an implemented or final activation contract.

## Installation boundary

Nothing in this tree is shipped or loaded by the normal install surface:

- `scripts/npm-install.mjs` installs only what `package.json`'s `files` list
  ships — this `docs/specs/vnext/` subtree is not in that list.
- `hooks.json` at the repo root wires only root-level hooks; the
  `docs/specs/vnext/hooks.json` copy inside is reference material and is not
  wired to anything.
- The live `agents/*.md` and `rules/*.md` at the repo root remain the active
  v0.4 prompts (including the Piledriver `PLAN READY` discipline the
  `hooks/primary-review-gate.py` Stop hook enforces).

When a vNext activation change is proposed it must come as a separate, clearly
marked change — copying this tree into the root paths is out of scope for any
draft-only PR.
