# Gemini 4 Argon — routing and cost (#74)

**Status:** draft routing; behavioral fit uncalibrated.
**Last evidence:** 2026-10-16, AGY 1.3.6 on the maintainer host.

`agy models` exposes `gemini-4-argon-low`, `gemini-4-argon-medium`,
and `gemini-4-argon-high`. The retired `gemini-3.1-pro-*` IDs are absent.
This supersedes the temporary Claude/Flash remap from 2026-10-15.

| Role | Selection | Effort rationale |
|---|---|---|
| Excavator | native `model: pro` (Argon) | AGY owns native tier effort; difficult bounded diagnosis and repair |
| Piledriver | `gemini-4-argon-high` | High for bounded architecture and difficult decisions |
| Steamroller | `gemini-4-argon-medium` | Medium for constrained supervision and ledger decisions |
| Strix Halo | native `model: pro` (Argon) | AGY owns native tier effort; bounded implementation review |
| Zen | `gemini-4-argon-high` | High for independent contract verification |
| Bulldozer | `gemini-3.8-flash-high` | Retain Flash for bounded milestone delegation |
| Jaguar / Puma / Bobcat | native `model: flash` | Retain Flash for discovery, mechanical work and ordinary implementation |
| Instinct | `claude-sonnet-5-5-high` | Preserve a different model family for alternate framing |
| Instinct, explicit escalation | `claude-opus-5-5-high` | Only when explicitly requested |

`ROLE_POLICY_TABLE` owns runner and Zen exact model selection, resolving
against the installed catalog and failing closed on missing or ambiguous
models. Piledriver, Steamroller and Zen keep `model: inherit` frontmatter
because their invocation supplies the policy-resolved slug.

Excavator and Strix Halo remain native subagents, not new runner roles.
Their `pro` selector is a native tier, not an exact slug or an effort pin.
The available Argon effort candidates are the three IDs above; this change
does not claim which effort AGY chooses for a native child. A live temporary
`model="pro"` child returned `PRO_TIER_OK`; its CLI log did not expose the
child's exact slug. Catalog checks and runner resolution are availability
evidence, not comparative quality or full milestone validation.

## Cost guidance

Argon costs **$2/M input tokens and $10/M output tokens**, with **cached input
95% cheaper** ($0.10/M cached input tokens). These are the rates recorded in
[#74](https://github.com/sleegme/native-gravity/issues/74), not measured AGY
subscription charges.

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
