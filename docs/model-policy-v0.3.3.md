# v0.3.3 model policy

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

If 3.1 Pro also attempts to absorb implementation, prefer structural enforcement over additional personality prose.

## Enforcement direction

Host implementation ownership is an orchestration invariant, not a model preference. Native Gravity should continue investigating Antigravity-native enforcement such as `PreToolUse` hooks or capability boundaries so a Host cannot silently replace Worker execution.

The role-identification hook probe remains experimental and separate from this model-policy change.
