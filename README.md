# oh-my-agy

[한국어 문서](docs/ko/README.md)

A small Antigravity-native multi-agent coding harness inspired by useful ideas from [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) / OMO, without porting OMO's full runtime or persona set.

> Status: **v0.1 / experimental**  
> The basic harness and routing are implemented, but the full end-to-end flow has not yet been repeatedly validated on a real Antigravity installation. Run `oma smoke` first.

## Goal

OMA separates coordination, implementation, research, and final review instead of asking one model to do everything.

```text
User
  │
  ▼
Claude Sonnet 4.6
Main / Orchestrator
  │
  ├─ Gemini Flash     → fast, inexpensive general work
  ├─ Gemini 3.1 Pro   → deep / ultrabrain / complex implementation
  ├─ Explore          → local codebase discovery
  └─ Librarian        → external docs / OSS research
  │
  ▼
Implementation evidence
  │
  ▼
Claude Opus 4.6
Final review
  └─ fallback: Gemini Pro
```

The core rule is simple: **Main coordinates, workers implement, reviewers judge.**

## v0.1 routing hypothesis

Start with a fixed routing table, use it for real work, then rebalance after observing which Antigravity quota pool burns faster.

| Role / category | Primary | Fallback / escalation |
| --- | --- | --- |
| Main / orchestration | Claude Sonnet 4.6 | Gemini 3.1 Pro |
| `quick`, `unspecified-low`, ordinary implementation | Gemini Flash | Gemini Pro |
| Explore, Librarian | Gemini Flash | Gemini Pro when justified |
| `deep`, `ultrabrain`, `visual-engineering`, `artistry`, `unspecified-high`, `architect` | Gemini Pro | Claude Opus 4.6 |
| Final review | Claude Opus 4.6 | Gemini Pro |

See [docs/categories.md](docs/categories.md) for category semantics.

## Install

```bash
git clone https://github.com/sleegme/oh-my-agy.git
cd oh-my-agy
./scripts/install-dev.sh
oma smoke
```

The development installer symlinks this checkout into the Antigravity plugin path and installs an `oma` convenience command under `~/.local/bin`.

## Basic usage

```bash
oma main
oma packet
oma review
oma smoke
```

`oma smoke --live` adds a tiny real model probe and therefore consumes quota.

See [docs/usage.md](docs/usage.md) for the full workflow.

## Workflow

```text
1. User request
2. Main writes a task contract
3. Main selects a category
4. Flash or Pro worker implements
5. Worker returns diff + test/build/run evidence
6. OMA builds a review packet
7. Opus or Pro reviewer returns GO / NO-GO
8. On NO-GO, only concrete blockers return to the existing worker session
9. Fix and re-review
```

A worker saying "done" is not sufficient evidence. When applicable, completion should be backed by the actual diff and relevant tests/build/run results.

## Documentation

- [Architecture](docs/architecture.md)
- [Categories and routing](docs/categories.md)
- [Usage](docs/usage.md)
- [Status](docs/status.md)
- [Korean documentation](docs/ko/README.md)

## Design principles

- Keep the agent set small.
- Treat Role / Category / Model / Reasoning as separate concepts.
- Keep Main thin.
- Implementation workers inspect real files and existing patterns before editing.
- Review stays read-only and blocker-focused.
- Require concrete verification evidence where possible.
- Use fan-out only for genuinely independent work.
- Do not add automatic quota-aware routing before real burn-rate data exists.

## Quota tuning

v0.1 intentionally uses fixed routing. If Claude quota burns first, move borderline work toward Gemini Pro; if Gemini quota burns first, consider moving selected heavy work in the other direction. The target is not minimum usage of any one model, but a practical balance between success rate and both quota pools.

## Current limitations

- Antigravity custom-agent frontmatter, tool names, and model-tier behavior may drift between versions.
- Exact Claude model pinning is handled at the headless CLI boundary rather than through the native Gemini `flash` / `pro` tiers.
- The full E2E path, including Opus review, still needs validation on a real AGY installation.
- Automatic quota telemetry and dynamic routing are not implemented yet.

See [docs/status.md](docs/status.md) for the latest validation checklist.

## Credits

OMA is heavily inspired by design ideas from OMO / oh-my-openagent, including category routing, focused delegation, evidence-based completion, and explicit review gates.

The project is intended to remain Antigravity-native. The default policy is to re-express useful behavioral ideas for AGY rather than copy upstream code or prompts verbatim.
