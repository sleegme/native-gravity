# Gemini 4 Argon — routing and cost (#74)

**Status:** draft routing; behavioral fit uncalibrated.
**Last evidence:** 2026-10-16, AGY 1.3.6 on the maintainer host.

`agy models` exposes `gemini-4-argon-low`, `gemini-4-argon-medium`,
and `gemini-4-argon-high`. The retired `gemini-3.1-pro-*` IDs are absent.
Availability does not prove that a native tier selects any of these models.

| Role | Selection | Effort rationale |
|---|---|---|
| Excavator | TEMPORARY headless path: `gemini-4-argon-high` via `scripts/excavator-agy.mjs` | High for difficult broken-behavior diagnosis/repair; native subagent stays disabled (`subagent: false`) |
| Piledriver | `gemini-4-argon-high` | High for bounded architecture and difficult decisions |
| Steamroller | `gemini-4-argon-medium` | Medium for constrained supervision and ledger decisions |
| Navi | `gemini-4-argon-medium` | Medium for bounded desktop tasks; agent-scoped MCP only |
| Strix Halo | native `model: flash` | Preserve the deliberate Flash assignment from #148 |
| Bulldozer | `gemini-3.8-flash-high` | Retain Flash for bounded milestone delegation |
| Jaguar / Puma / Bobcat | native `model: flash` | Retain Flash for discovery, mechanical work and ordinary implementation |
| Instinct | `claude-sonnet-5-5-high` | Preserve a different model family for alternate framing |
| Instinct, explicit escalation | `claude-opus-5-5-high` | Only when explicitly requested |

`ROLE_POLICY_TABLE` owns runner and Zen exact model selection, resolving
against the installed catalog and failing closed on missing or ambiguous
models. Piledriver, Steamroller and Zen keep `model: inherit` frontmatter
because their invocation supplies the policy-resolved slug.

## Native model limitation and temporary disablement

The original PR claim that native `pro` selects Argon was wrong. The stored
metadata of its child `19e9cab6-5c09-4228-ba03-ff70b1cb0cd9` contains
`gemini-3.8-flash-high` and generation metadata records
`gemini-3.8-flash-tiered`. A successful sentinel did not establish model identity.

A throwaway copy of Excavator with `model: gemini-4-argon-high` failed
registration and could not create a child. Changing only its model to `flash`
registered it and created a child whose generation and executor metadata both
record `gemini-3.8-flash-tiered`. Full probe and control evidence is in
[the correction receipt](../../.omo/evidence/74-argon-routing.md).

Excavator is therefore **TEMPORARILY headless-only**, not routed to native
Flash and not spawnable as a subagent. Native delegation does not consult
`ROLE_POLICY_TABLE`, so a policy entry alone could not fix the native path.
Instead `scripts/excavator-agy.mjs` consumes the same frozen policy table:
it resolves the exact `gemini-4-argon-high` slug at runtime (fail-closed),
runs the retained contract headlessly through the agy CLI in the milestone
workspace, and returns the worker result to Bulldozer. No test claims that
a native worker resolves to Argon.

The temporary fallback path is unchanged where it matters: ordinary repairs
stay with Bobcat; a hard repair whose headless call fails (missing agy,
exhausted Argon quota/429, timeout, unparseable output) or has no safe
in-scope route left returns evidenced BLOCKED to Steamroller, while
architectural questions use NEEDS_DEEP. Re-enable natively when native child
model metadata proves Argon selection, using the registration switch and
routing restoration documented in `agents/excavator.md`, and remove the
headless path in the same change.

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
