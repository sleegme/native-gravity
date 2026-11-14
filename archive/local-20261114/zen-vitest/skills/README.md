# QA Skills

Reusable verification disciplines for specific artifact families in Native Gravity.

## Skill contract

A QA skill defines the concrete verification discipline for an artifact family or verification domain when acceptance requires deeper checks than the generic invariants in `rules/harness.md`.

Skills govern verification only. A QA skill never grants tools, shell capabilities, mutation permissions, or delegation authority. All checks must execute strictly within the active role's existing authority and exposed tools.

## Applicability

A skill applies when a task produces, modifies, or verifies an artifact matching the skill's domain. Skills are opt-in per artifact family; there is no single mandatory QA skill for every task.

## Required sections

Every skill in `skills/` must define:

1. **Applicability** — explicit criteria for when the skill governs verification.
2. **Evidence surfaces** — exact files, diffs, command outputs, registries, or environments that must be inspected.
3. **Observable vs. inferable** — what must be directly observed rather than inferred from passing tests, static declarations, or absence of errors.
4. **Failure modes** — concrete defect patterns that constitute failure in this domain.
5. **Minimum verification procedure** — step-by-step required check protocol.
6. **PASS / FAIL / UNKNOWN reporting** — how outcomes are reported without hiding evidence gaps or converting uncertainty into success.
7. **Independent vs. self-check distinction** — self-authored tests or checks are evidence but not independent verification; what constitutes independent or external validation.

## One rule, one home

Artifact-specific verification procedures live in `skills/`, not in agent definitions, handoff templates, or `rules/harness.md`. Agent prompts and task packets reference the relevant skill rather than copying its verification rules into prompt text. Duplicating discipline into prompts creates synchronization drift and dilutes context. The skill is the single source of truth for its artifact family; consumers cite it by path.
