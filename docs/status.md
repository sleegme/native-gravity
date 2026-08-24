# Status

oh-my-agy is currently **v0.1 / experimental**.

The architecture and core agent/routing files exist, but the full Antigravity flow has not yet been repeatedly validated as a stable release.

## Implemented

- Antigravity plugin scaffold
- `oma-main`
- Flash implementation worker
- Pro implementation worker
- read-only Explore
- read-only Librarian
- read-only Review
- task contract / evidence / review packet flow
- `oma` convenience CLI
- development symlink installer
- smoke test
- Gemini 3.1 Pro review wrapper
- fixed v0.1 category routing

## Still needs validation

### Full E2E

The following path needs to be exercised repeatedly on a real AGY installation:

```text
oma main
  ↓
Main discovery / startup
  ↓
subagent delegation
  ↓
Flash or Pro implementation
  ↓
evidence
  ↓
oma packet
  ↓
oma review
  ↓
GO / NO-GO
```

### Review direct launch

The current design uses the same read-only review harness both as a native `pro`-tier subagent and as an exact Gemini 3.1 Pro High review launched through the CLI boundary.

The interaction between `mainAgent`, `subagent`, and direct `--agent` launch must be validated against the installed Antigravity version. This is one of the first things to test.

### Tool schema drift

Antigravity custom-agent tool names and frontmatter schema may change. Unknown or unmapped tools can cause agent startup failure or hangs, so run `oma smoke` and a small real delegation after AGY updates.

### Model slug drift

`oma main` and `oma review` resolve Sonnet 4.6 / Gemini 3.1 Pro High from `agy models`. If preview naming changes, use:

```bash
OMA_MAIN_MODEL=<slug> oma main
OMA_REVIEW_MODEL=<slug> oma review
```

## Quota

Automatic quota-aware routing is intentionally not implemented yet.

First use the fixed routing table and observe:

- Gemini pool burn rate
- Claude/non-Gemini pool burn rate
- approximate category cost
- review frequency versus cost

Then rebalance routing based on real usage.

## v0.1 validation criteria

Treat v0.1 as a working initial release after the following are confirmed on real AGY:

- `oma smoke` passes
- `oma main` starts correctly
- Main → Flash delegation succeeds
- Main → Pro delegation succeeds
- a worker performs a real source edit and verification
- `oma packet` builds correctly
- Gemini 3.1 Pro review succeeds
- NO-GO → same-worker correction → re-review succeeds

## Later candidates

Only after real usage data exists, consider:

- quota telemetry
- dynamic routing
- category-specific reasoning tuning
- a smarter review invocation gate
- automatic session reuse
- fan-out for independent work

For now, validating the small existing design is more important than adding features.
