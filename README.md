# oh-my-agy

A small Antigravity-native multi-agent harness inspired by the useful parts of OMO, without porting OMO's full runtime or persona zoo.

## v0.1 hypothesis

Start with a fixed routing table, use it for real work, then rebalance after observing which Antigravity quota pool burns faster.

| Role / category | Primary | Fallback / escalation |
| --- | --- | --- |
| Main / orchestration | Claude Sonnet 4.6 | Gemini 3.1 Pro |
| quick, unspecified-low, ordinary implementation | Gemini Flash | Gemini Pro |
| Explore, Librarian | Gemini Flash | Gemini Pro when the parent decides it is worth the cost |
| deep, ultrabrain, visual-engineering, artistry, unspecified-high, architect | Gemini Pro | Claude Opus 4.6 |
| Final review | Claude Opus 4.6 | Gemini Pro |

Antigravity custom-agent frontmatter currently exposes `inherit`, `flash`, and `pro` model tiers rather than exact model slugs. oh-my-agy therefore keeps cheap/heavy Gemini workers native, runs the main agent with Sonnet pinned at the CLI boundary, and pins Opus for the expensive review pass with a small headless wrapper.

## Install for local development

```bash
git clone https://github.com/sleegme/oh-my-agy.git
cd oh-my-agy
./scripts/install-dev.sh
oma smoke
```

The installer symlinks this checkout to `~/.gemini/antigravity-cli/plugins/oh-my-agy` and installs an `oma` convenience symlink under `~/.local/bin`.

Start the harness with:

```bash
oma main
```

`oma main` resolves the currently installed Sonnet 4.6 slug from `agy models` and launches `oma-main`. The main agent delegates implementation to Flash/Pro subagents according to category.

For a final review from any project workspace:

```bash
oma review
```

That command builds `.oma/review-packet.md`, resolves the current Opus 4.6 slug from `agy models`, and runs the read-only `oma-review` agent with Opus. If Opus is unavailable or quota-exhausted, `oma-main` is instructed to fall back to the native Pro review agent.

## Safety / scope

- `oma-main` is a coordinator. It may write coordination state under `.oma/`, but substantive source edits belong to implementation workers.
- `oma-review` has only read/search tools. It cannot edit files or run shell commands.
- Implementation workers must inspect existing patterns before edits and provide concrete verification evidence before claiming completion.
- Review is blocker-focused: `VERDICT: GO` or `VERDICT: NO-GO` with concrete blockers.
- Fan-out is optional, not a default. Spawn parallel workers only for genuinely independent work where the saved time beats coordination overhead.

## What to tune after real use

Do not guess an optimal routing table up front. Record which pool reaches its weekly/5-hour limit first, then shift borderline categories across the Gemini/Claude boundary. v0.1 deliberately keeps quota-aware automatic routing out of the core until there is real burn-rate data.
