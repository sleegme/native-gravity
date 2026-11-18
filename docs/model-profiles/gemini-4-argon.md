# Gemini 4 Argon — routing and cost (#74)

**Status:** draft routing; behavioral fit uncalibrated.
**Last evidence:** 2026-10-16, AGY 1.3.6 on the maintainer host.

`agy models` exposes `gemini-4-argon-low`, `gemini-4-argon-medium`,
and `gemini-4-argon-high`. The retired `gemini-3.1-pro-*` IDs are absent.
Availability does not prove that a native tier selects any of these models.

| Role | Selection (NTG 2.0) | Effort rationale |
|---|---|---|
| Steamroller | `Carbon (Medium)` -> `gemini-4-argon-medium` (excludes `gemini-pro-orchestrator-g1-pro`) | Medium for interactive supervision and kernel orchestration |
| Piledriver | `gemini-4-argon-high` | High for bounded architecture, milestone graphs, and difficult decisions |
| Bulldozer | `gemini-4-hydrogen-xhigh` | XHigh for selective milestone coordination and primary failure recovery |
| Strix Halo | `gemini-4-hydrogen-high` | High for cross-caller quality/acceptance review (`steamroller`, `bulldozer`, `bobcat`) |
| Bobcat | `gemini-4-hydrogen-medium` | Medium for substantive implementation and local verification |
| Jaguar / Puma | `gemini-3.8-flash-low` | Low under Lightweight Worker Harness (kept separate) |
| Zen | `claude-opus-5-5-high` (quota fallback: `gemini-4-argon-high`) | High for independent summative verification |
| Instinct | `claude-sonnet-5-5-high` (escalated: `claude-opus-5-5-high`) | High for heterogeneous alternate framing |
| Navi | `gemini-4-argon-medium` | Medium for bounded desktop tasks; private HOME `cu` MCP leaf |
| Excavator | **RETIRED** | Replaced by Bulldozer (`gemini-4-hydrogen-xhigh`) + Instinct |

`ROLE_POLICY_TABLE` owns runner and Zen exact model selection, resolving
against the installed catalog and failing closed on missing or ambiguous
models. Piledriver, Steamroller and Zen keep `model: inherit` frontmatter
because their invocation supplies the policy-resolved slug.

## Native model limitation and NTG 2.0 Excavator retirement

The original PR claim that native `pro` selects Argon was wrong. The stored
metadata of its child `19e9cab6-5c09-4228-ba03-ff70b1cb0cd9` contains
`gemini-3.8-flash-high` and generation metadata records
`gemini-3.8-flash-tiered`. A successful sentinel did not establish model identity.

In 1.x, a throwaway copy of Excavator with `model: gemini-4-argon-high` failed
registration and `scripts/excavator-agy.mjs` was temporarily used as a headless
Argon High bridge. In **NTG 2.0**, Excavator (`agents/excavator.md`,
`scripts/excavator-agy.mjs`, and `hooks/excavator-shell-guard.py`) has been
**completely retired** and replaced by **Bulldozer** (`gemini-4-hydrogen-xhigh`,
with guarded general `run_command` access) alongside **Instinct**
(`claude-sonnet-5-5-high` / escalated `claude-opus-5-5-high`). Ordinary
implementation stays with Bobcat (`gemini-4-hydrogen-medium`), and architectural
questions continue to escalate as `NEEDS_DEEP` through Steamroller.

## Cost guidance

Argon costs **$2/M input tokens and $10/M output tokens** through 2026-11-30.
From **2026-12-01**, the scheduled prices are **$4/M input and $20/M output**.
**Cached input is 95% cheaper** ($0.10/M currently, $0.20/M from 2026-12-01).
Current rates come from [#74](https://github.com/sleegme/native-gravity/issues/74);
the scheduled change was supplied by the owner on 2026-10-16. These are not
measured AGY subscription charges.

Keep simple and frequent tasks on Flash. Use Medium for constrained
supervision, and High for difficult planning or independent verification.
Keep prompts bounded and reuse stable cached context where supported.
The **1M-output headroom is only for long-horizon tasks** that actually need
it, not a default output budget or permission to expand a bounded assignment.

## Behavioral evidence

Argon-specific strengths and failure modes are not yet calibrated. Keep the
existing role authority, non-mutating review boundaries, and independent
verification requirements; model availability alone does not justify changing
them. Historical model profiles and live receipts remain historical evidence.
