# Versioning Policy

## Concept Separation

Native Gravity strictly decouples three distinct concepts across all documentation, metadata, and communications:

1. **Product Version (`A.B.C`)**: The canonical release number identifying the codebase state (e.g., `0.4.0`).
2. **Release Maturity**: The operational stability tier of the release (`alpha`, `beta`, `stable`).
   - SemVer prerelease identifiers (such as `0.4.0-alpha.3` or `0.4.0-beta`) are explicitly forbidden.
3. **Runtime Compatibility**: The validated host versions of Google Antigravity (AGY) alongside their validation status (e.g., `AGY 1.1.21 — validated`, `AGY 1.1.24 — validated`).

These three dimensions must never be conflated into a single composite string (such as `"v0.4 alpha / runtime-validated on AGY 1.1.21"`). They are orthogonal attributes and must be tracked and presented independently.

## Canonical Version Source of Truth

- The canonical source of truth for the product version is the `VERSION` file at the repository root.
- The file contains a single line with the `A.B.C` version followed by a newline (e.g., `0.4.0`).
- The Antigravity plugin schema (`https://antigravity.google/schemas/v1/plugin.json`) does not officially define or enforce a `version` field in `plugin.json`. Consequently, `plugin.json` is not modified and does not store product version information. All automation, documentation, and release processes read `VERSION` as the sole authoritative reference.

## Version Format: `A.B.C` (Non-SemVer)

Native Gravity uses an `A.B.C` progression model tailored to native agent harness layers:

- **A — Release Version (Major generational architecture / paradigm shift)**:
  Signifies major architectural overhauls or fundamental paradigm shifts in agent orchestration (e.g., moving from early experimental single-host structures to multi-primary peer topologies, `0.x.x` -> `1.0.0`).
- **B — Feature Patch (Feature expansion & primary capability)**:
  Signifies new primary modes, new worker classes, task graph additions, or substantial orchestration capabilities (e.g., introducing Excavator autonomous repair, Piledriver planner, or Puma quick-worker path, `0.4.x` -> `0.5.0`).
- **C — Minor Patch (Harness refinement & maintenance)**:
  Signifies harness contract refinements, agent prompt corrections, runtime hook bugfixes, role gate adjustments, host runtime compatibility updates, or documentation updates (e.g., `0.4.0` -> `0.4.1`).

## Release Maturity Stages

Release maturity reflects stability and operational confidence independent of the version number:

- **alpha**: Architecture or harness contracts under active iteration; initial runtime validations underway; behavioral guards may be refined.
- **beta**: Feature set frozen for the cycle; primary modes, worker delegation, and role gates validated; regression suites stable.
- **stable**: Fully verified end-to-end against supported host runtimes; behavioral hooks and role boundaries hardened for general production use.

## Runtime Compatibility Matrix

Native Gravity is an Antigravity-native plugin. Because it relies directly on host runtime behaviors (custom agent selection, subagent invocation semantics, `PreToolUse` and `Stop` hook contracts), compatibility is tracked explicitly against specific Antigravity builds.

| Native Gravity Version | Release Maturity | Host Runtime | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `0.4.0` | alpha | AGY 1.1.21 | validated | Custom primary delegation and nested Bobcat -> Advisor gate validated |
| `0.4.0` | alpha | AGY 1.1.24 | validated | Clean install and primary/subagent execution validated |

When Google Antigravity updates, compatibility gates must be revalidated against the new runtime build and updated in `docs/status.md` and the compatibility matrix without altering the product version unless harness modifications are required.
