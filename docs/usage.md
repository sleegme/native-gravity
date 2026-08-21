# Usage

This document covers the basic local development and execution flow for oh-my-agy on Antigravity.

## 1. Install

```bash
git clone https://github.com/sleegme/oh-my-agy.git
cd oh-my-agy
./scripts/install-dev.sh
```

The development installer symlinks the repository into:

```text
~/.gemini/antigravity-cli/plugins/oh-my-agy
```

and creates the convenience command:

```text
~/.local/bin/oma
```

If `oma` is not available, check:

```bash
command -v oma
command -v agy
```

## 2. Smoke test

Run the quota-free structural check first:

```bash
oma smoke
```

It checks whether `agy` is on PATH, required models are visible through `agy models`, and OMA custom agents are discovered.

A tiny live probe is available with:

```bash
oma smoke --live
```

`--live` consumes real quota.

## 3. Start Main

From the repository you want OMA to work on:

```bash
oma main
```

`oma main` resolves the current Sonnet 4.6 model slug and starts the `oma-main` agent. Main analyzes the request, writes `.oma/task-contract.md`, selects a category, and delegates implementation.

## 4. Worker routing

The rough split is:

```text
small, clear work
    ↓
Flash

complex implementation / deep / ultrabrain / UI / architecture
    ↓
Pro
```

Main passes `CATEGORY: <name>` to the worker. See [categories.md](categories.md) for category semantics.

## 5. Evidence

Implementation workers should return concrete evidence such as:

```text
Summary of changes
Files changed
Verification commands and outcomes
Remaining risks / blockers
```

Main can persist this into `.oma/implementation-evidence.md`.

## 6. Build a review packet

```bash
oma packet
```

This snapshots the task contract, implementation evidence, git status, and diff into:

```text
.oma/review-packet.md
```

## 7. Final review

```bash
oma review
```

The target design is to run the same read-only `oma-review` harness with Claude Opus 4.6. The reviewer checks acceptance criteria, correctness, regressions, scope expansion, risky deletion, public/API behavior, and verification adequacy.

The final verdict is exactly one of:

```text
VERDICT: GO
VERDICT: NO-GO
```

On NO-GO, send only concrete blockers back to the existing implementation worker session when practical.

## 8. Correction loop

```text
worker implementation
    ↓
evidence
    ↓
review
    ↓
NO-GO
    ↓
blockers only
    ↓
same worker session
    ↓
fix
    ↓
review again
```

v0.1 treats roughly two materially different correction attempts as the normal cap before Main re-diagnoses the problem.

## 9. Model overrides

If automatic slug detection fails:

```bash
OMA_MAIN_MODEL=<model-slug> oma main
OMA_REVIEW_MODEL=<model-slug> oma review
```

These are escape hatches for preview naming or model-slug drift.

## 10. Observe quota burn

v0.1 does not implement automatic quota-aware routing. For early testing, recording just the following is enough:

```text
Gemini remaining % before
Claude/non-Gemini remaining % before
category
model used
Gemini remaining % after
Claude/non-Gemini remaining % after
```

Use that data to decide whether Gemini or Claude work needs to be rebalanced.

## 11. Troubleshooting

Start with:

```bash
agy --version
agy models
agy agents
oma smoke
```

Then verify the plugin and command symlinks:

```bash
ls -l ~/.gemini/antigravity-cli/plugins/oh-my-agy
ls -l ~/.local/bin/oma
```

Antigravity updates may require OMA changes if custom-agent tool names, frontmatter schema, or model behavior drifts.
