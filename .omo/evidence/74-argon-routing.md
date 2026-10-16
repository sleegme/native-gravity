# Issue #74: Argon routing verification

Observed 2026-10-16 in a fresh clone, AGY 1.3.6.

## Installed catalog

`agy models` exited 0:

```text
gemini-4-argon-medium     Gemini 4 Argon (Medium)
gemini-4-argon-high       Gemini 4 Argon (High)
gemini-4-argon-low        Gemini 4 Argon (Low)
gemini-3.8-flash-high     Gemini 3.8 Flash (High)
gemini-3.8-flash-medium   Gemini 3.8 Flash (Medium)
gemini-3.8-flash-low      Gemini 3.8 Flash (Low)
claude-opus-5-5-low       Claude Opus 5.5 (Low)
claude-opus-5-5-medium    Claude Opus 5.5 (Medium)
claude-opus-5-5-high      Claude Opus 5.5 (High)
claude-sonnet-5-5-low     Claude Sonnet 5.5 (Low)
claude-sonnet-5-5-medium  Claude Sonnet 5.5 (Medium)
claude-sonnet-5-5-high    Claude Sonnet 5.5 (High)
gpt-oss-120b-medium       GPT-OSS 120B (Medium)
```

## Verification commands and results

| Command | Observed result |
|---|---|
| `node --test tests/*.mjs` | Exit 0; 166 tests, 165 passed, 0 failed, 1 existing persistent-watch skip. Includes ledger's 39 and runner's 52 internal assertions. |
| `python -m compileall -q hooks tests` | Exit 0 |
| `python -m unittest discover -s tests -v` | Exit 0; 15 tests, OK |
| `node --check scripts/npm-install.mjs` | Exit 0 |
| `node --check scripts/runner.mjs` | Exit 0 |
| `node --check scripts/ntg-vnext.mjs` | Exit 0 |
| `npm pack --dry-run` | Exit 0 |
| `git diff --check` | Exit 0 |

The runner test queried real `agy models` and resolved:

```text
piledriver -> gemini-4-argon-high
zen -> gemini-4-argon-high
bulldozer -> gemini-3.8-flash-high
steamroller -> gemini-4-argon-medium
instinct -> claude-sonnet-5-5-high
instinct (explicit escalation) -> claude-opus-5-5-high
```

Excavator and Strix Halo frontmatter select native `pro`. The same test
checks both selectors and availability of all three Argon effort candidates.
Native effort remains AGY-owned; no exact child slug is asserted.
Retired Pro and wrong-effort-only surfaces fail closed for Argon runner roles.
Native specialists remain excluded from runner invocation.

Live runner generation tests passed for Piledriver on Argon High and
Bulldozer on Flash High, returning their expected sentinel responses.
An additional native tier probe exited 0:

```sh
agy --model gemini-3.8-flash-high --output-format json --print-timeout 120s \
  -p 'Use the workflow tool exactly once to run one temporary agent with model="pro" and prompt="Reply with PRO_TIER_OK only. Do not use tools." Return its answer. Do not read or change files or use shell.'
```

The probe returned a SUCCESS envelope containing `PRO_TIER_OK`
(conversation `af4cb3b0-c7d1-4f57-a75d-7052b88b7917`).
The actual invocation also used a scratch `--log-file`; that CLI log identified
the parent model but did not expose the child's exact model or effort.
This is native tier availability evidence, not a full Excavator/Strix
delegation or end-to-end Argon milestone validation.

An initial deterministic Node run found that the patch tool had dropped the
tracked executable bit on `scripts/ntg-vnext.mjs`. Restoring its tracked
100755 mode fixed the installed-bin test; the full unskipped run above passed.
No test was weakened. LSP diagnostics were unavailable because the TypeScript
language server is not installed; Node syntax and runtime checks passed.
