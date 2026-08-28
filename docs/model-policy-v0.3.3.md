# v0.3.3 model policy

> **HISTORICAL — SUPERSEDED BY v0.4.** This document describes v0.3.3 policy and is kept for reference only.
> The Gemini 3.1 Pro mutation guard described here was removed in v0.4 (see `AGENTS.md`), the hooks no longer exist,
> and the role names below (`gravity-worker`, `gravity-deep`, `gravity-explorer`, `gravity-reviewer`) were replaced by
> the v0.4 roles (Bobcat, Steamroller, Jaguar, Zen). Do not treat this file as active policy.

## Host decision

Gemini 3.7 Flash High is no longer a recommended or supported Native Gravity Host/Main configuration for v0.3.3.

The Antigravity Default agent remains the Host. The recommended primary Host remains Claude Sonnet 4.6. If a Gemini-only Host fallback is required, Gemini 3.1 Pro is the experimental candidate pending direct A/B validation under the same harness tasks.

Gemini 3.7 Flash remains recommended for execution-oriented roles where its speed is an advantage:

- `gravity-worker`
- `gravity-explorer`

Gemini 3.1 Pro remains the current `pro`-tier mapping for:

- `gravity-advisor`
- `gravity-deep`
- `gravity-reviewer`

## Why 3.7 Flash High leaves the Host role

Two real maintainer exercises showed that Gemini 3.7 Flash High can converge on difficult implementation work quickly, but does not reliably preserve Host orchestration boundaries under prompt-only correction.

Observed Host failures included:

- skipping explicit prerequisite reads/checks before acting;
- performing project-source mutation directly instead of routing ordinary implementation to `gravity-worker`;
- completing implementation/test/commit work without invoking Worker at all;
- launching independent review without reliably observing the resulting verdict before later claiming review success;
- allowing execution speed and local confidence to outrun the Host's evidence and transition duties.

The v0.3.2 Host correction improved some procedural behavior, especially bounded follow-up of long-running validation and less aggressive polling/interruption. It did not make implementation ownership/delegation reliable enough for Host use.

The resulting policy is:

> Use 3.7 Flash for fast bounded execution and discovery, not global orchestration.

## 3.1 Pro Host validation

This change does not declare Gemini 3.1 Pro a proven Host replacement yet. Before promoting it beyond experimental fallback, run the same class of maintainer task and explicitly compare:

- prerequisite adherence;
- Host -> Worker delegation rate;
- direct Host mutation attempts;
- Worker -> Advisor gate behavior;
- independent Reviewer verdict observation;
- evidence-grounded completion claims;
- convergence and long-running task supervision.

## Gemini 3.1 Pro mutation guard

v0.3.3 adds a narrow Antigravity `PreToolUse` hard guard for project-file mutation tools.

The current v0.3.3 model map gives Gemini 3.1 Pro only coordination or read-only duties:

- experimental Gemini Host fallback;
- `gravity-advisor`;
- `gravity-deep`;
- `gravity-reviewer`.

None of those roles owns implementation edits. Therefore, when the hook payload reports a Gemini 3.1 Pro model and the model attempts a matched project-file mutation tool, Native Gravity denies the tool call and instructs the Host to route ordinary implementation to `gravity-worker`.

The guard deliberately does **not** block Gemini 3.7 Flash mutation because `gravity-worker` is the implementation owner. Non-Gemini models are unaffected.

This is a model-map-specific v0.3.3 enforcement slice, not a universal statement that Gemini 3.1 Pro can never implement. If the model map changes in a later version, this guard must be reevaluated with it.

The first guard only covers Antigravity file-mutation tools matched in `hooks.json`. Shell-mediated mutation is not yet a hard capability boundary and remains outside this slice. Do not describe this hook as a complete sandbox.

## Enforcement direction

Host implementation ownership is an orchestration invariant, not merely a model preference. Prompt correction remains useful for judgment, evidence discipline, intent classification, and normal routing, but a known model-specific ownership failure should not depend on prose alone when Antigravity exposes a native transition guard.

For v0.3.3 the enforcement split is:

- prompt/rules: tell the model how to coordinate, delegate, verify, and complete;
- Gemini 3.1 Pro `PreToolUse` guard: deny matched direct mutation attempts;
- Worker role: retain implementation ownership and mutation authority.

The separate role-identification probe remains useful for a future model-agnostic Host guard, but v0.3.3 does not require that experiment to protect the current Gemini 3.1 Pro model map.
