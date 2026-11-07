# Versioning Policy

## Concept Separation

Native Gravity strictly decouples three distinct concepts across all documentation, metadata, and communications:

1. **Product Version (`MAJOR.MINOR.PATCH`)**: The canonical release number identifying the codebase state (e.g., `1.1.2`).
2. **Release Maturity**: The operational stability tier of the release (`alpha`, `beta`, `stable`).
   - SemVer prerelease identifiers (such as `1.0.0-alpha.3` or `1.0.0-beta`) are explicitly forbidden.
3. **Runtime Compatibility**: The validated host versions of Google Antigravity (AGY) alongside their validation status (e.g., `AGY 1.3.3 — validated`).

These three dimensions must never be conflated into a single composite string (such as `"v1.0 alpha / runtime-validated on AGY 1.3.3"`). They are orthogonal attributes and must be tracked and presented independently.

## Canonical Version Source of Truth

- The canonical source of truth for the product version is `package.json` at the repository root (`"version"` field).
- Every other copy is generated or checked against it via `scripts/sync-version.mjs`.
- The Antigravity plugin schema (`https://antigravity.google/schemas/v1/plugin.json`) does not officially define or enforce a `version` field in `plugin.json`. Consequently, `plugin.json` is not modified and does not store product version information.

## Version Format: Semantic Versioning (MAJOR.MINOR.PATCH)

Native Gravity follows Semantic Versioning (`MAJOR.MINOR.PATCH`):

- **MAJOR**: user must change something (existing ledger/plan cannot resume, command renamed/removed, install method or minimum AGY/Node changes; migration notes required).
- **MINOR**: new capability (new command/option, new role, model placement change, workflow improvement).
- **PATCH**: works as intended (bug fixes, verification tightening noted in changelog, wording, internal cleanup).

## Release Maturity Stages

Release maturity reflects stability and operational confidence independent of the version number:

- **alpha**: Architecture or harness contracts under active iteration; initial runtime validations underway; behavioral guards may be refined.
- **beta**: Feature set frozen for the cycle; primary modes, worker delegation, and role gates validated; regression suites stable.
- **stable**: Fully verified end-to-end against supported host runtimes; behavioral hooks and role boundaries hardened for general production use.

## Release Steps

When changes merge to `main`, release-please maintains a Release PR with updated SemVer version in `package.json`, `.release-please-manifest.json`, `CHANGELOG.md`, and runs the post-bump version sync (`scripts/sync-version.mjs`) to keep pinned copies in sync.

- **Step 1: Review and merge the release PR on GitHub.** Release-please tags the commit and creates the GitHub Release.
- **Step 2: npm publish runs automatically.** Merging the release PR triggers the `publish` job in `.github/workflows/release-please.yml`, which publishes `native-gravity` and then `@sleeg/ntg` through npm Trusted Publishing (GitHub OIDC). No npm tokens are stored in the repository or in CI secrets.

## One-Time npm Setup (Trusted Publisher)

Trusted Publishing must be configured once per package on npmjs.com before the automatic publish succeeds. For **both** `native-gravity` and `@sleeg/ntg`:

| Field | Value |
| :--- | :--- |
| Publisher | GitHub Actions |
| Organization or user | `sleegme` |
| Repository | `native-gravity` |
| Workflow filename | `release-please.yml` |
| Environment | *(leave empty)* |
| Allowed action | `npm publish` |

The workflow filename must stay `release-please.yml`: npm validates the calling workflow's filename, so publishing from a separate workflow file is rejected.

The alias package is published from `packages/ntg-alias`, whose `version` and `native-gravity` dependency range are pinned to the root version by `scripts/sync-version.mjs`. It is deliberately **not** a release-please `extra-files` entry — jsonpath cannot express the `$X.Y.Z` dependency range, so the post-bump `sync-version.mjs` step on the release PR is what keeps it aligned.


## Runtime Compatibility Matrix

Native Gravity is an Antigravity-native plugin. Because it relies directly on host runtime behaviors (custom agent selection, subagent invocation semantics, `PreToolUse` and `Stop` hook contracts), compatibility is tracked explicitly against specific Antigravity builds.

| Native Gravity Version | Release Maturity | Host Runtime | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `0.4.0` | alpha | AGY 1.1.21 | validated | Custom primary delegation and nested Bobcat -> Advisor gate validated |
| `0.4.0` | alpha | AGY 1.1.24 | validated | Clean install and primary/subagent execution validated |
| `0.4.0` | alpha | AGY 1.2.12 | validated w/ regression | All named delegation/review paths pass; Stop hooks inert in headless print mode and `--agent` role body absent from transcripts — tracked as issue #64 |
| `1.0.0` | alpha | AGY 1.3.3 | validated | vNext-only runtime: runner end-to-end (multi-milestone GO, fresh-context resume, material replan, Zen NO-GO -> GO), specialist delegation probes and exact-model resolution; see `.omo/evidence/138-vnext-only-results.md` |
| `1.1.0` | alpha | AGY 1.3.3 | validated | Instinct (#20) runner role: NEEDS_ALT alternate-framing advisory on Claude Sonnet 5.5 High (Claude Opus 5.5 High only on explicit escalation); Bulldozer specialist-report relay rule (#136); Excavator demoted to a Bulldozer worker with the native-primary Zen completion gate removed (see `.omo/evidence/20-instinct-results.md`) |

When Google Antigravity updates, compatibility gates must be revalidated against the new runtime build and updated in `docs/status.md` and the compatibility matrix without altering the product version unless harness modifications are required.
