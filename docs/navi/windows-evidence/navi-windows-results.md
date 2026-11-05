# Navi native Windows validation results

Historical baseline report. The diagnostic rerun and fixes are recorded in
[`navi-windows-diagnostics-results.md`](navi-windows-diagnostics-results.md).

Date: 2026-10-24 (UTC).
Branch: `feat/navi-cross-platform`.
Baseline: `37b685a6c11a5ab3f256ff2496128b8c45730563`.

**Overall: FAIL. Production Windows support remains PENDING.**
The documented commands were executed to their exit, but the end-to-end
desktop validation did not succeed. No production or test sources were
modified, no test was weakened, and no merge was performed.

## Environment and package identity

- Native Windows NT 10.0.26200.0, normal user / medium integrity.
- Windows PowerShell 5.1.26100.9711; additional native PowerShell 7.6.8 check.
- Node.js v20.19.0.
- Task-local CPython 3.14.9 and `windows-mcp==0.8.8`, installed with portable
  uv 0.13.5. Resolved FastMCP version: 4.1.3.
- Installed package METADATA reports Windows-MCP 0.8.8 / Python >=3.14.
  Upstream `CursorTouch/Windows-MCP` tag `v0.8.8` resolves to commit
  `b74c507d9e709223a0904cf08019edf55f2a75bb`; its `pyproject.toml` declares the
  same package version and Python requirement. This is a version declaration
  comparison, not a byte-for-byte source attestation.
- MCP `serverInfo.version` was 4.1.3, not the installed Windows-MCP package
  version; it was not used to identify the package.
- AGY and Windows-MCP were not initially on PATH. AGY was not installed or
  invoked. No OAuth file, owner authentication store or AGY configuration
  was accessed.

## Commands and results

All commands below ran from the checked-out repository using native Windows
PowerShell, not WSL or Git Bash. `$RunRoot` denotes the owned temporary
environment; its user-specific absolute path is deliberately omitted.

The first documented invocation could not load scripts under the initial
execution policy. Subsequent invocations used parent
`powershell.exe -NoProfile -ExecutionPolicy Bypass` with inherited
`$env:PSExecutionPolicyPreference = 'Bypass'`. This was process-only; no
CurrentUser, LocalMachine or Group Policy setting was changed.

| Invocation | Exit | Artifact / result |
|---|---:|---|
| `node --test tests/test_navi_windows_kit.mjs` | 1 | `navi-windows-tests.json`: 2 passed, 3 failed, 1 existing platform skip |
| `powershell.exe -NoProfile -File ./scripts/navi-validation/windows-kit.ps1 -Output ./navi-windows-basic.json` | 1 | `navi-windows-basic.json` |
| `powershell.exe -NoProfile -File ./scripts/navi-validation/windows-kit.ps1 -Backend "$RunRoot/venv/Scripts/windows-mcp.exe" -Output ./navi-windows-backend.json` | 1 | `navi-windows-backend.json` |
| `pwsh.exe -NoProfile -File ./scripts/navi-validation/windows-kit.ps1 -Backend "$RunRoot/venv/Scripts/windows-mcp.exe" -Output ./navi-windows-pwsh7.json` | 1 | `navi-windows-pwsh7.json` |
| `node scripts/navi-validation/probe.mjs --backend "$RunRoot/venv/Scripts/windows-mcp.exe" --output navi-windows-probe.json --schemas "$RunRoot/schemas.local.json"` | 1 | `navi-windows-probe.json` |
| `powershell.exe -NoProfile -File ./scripts/navi-validation/windows-kit.ps1 -Backend "$RunRoot/venv/Scripts/windows-mcp.exe" -Steps "$RunRoot/steps.json" -Output ./navi-windows-desktop-kit.json` | 1 | `navi-windows-desktop-kit.json` |
| `node scripts/navi-validation/probe.mjs --backend "$RunRoot/venv/Scripts/windows-mcp.exe" --steps "$RunRoot/steps.json" --output navi-windows-desktop-probe.json` | 1 | `navi-windows-desktop-probe.json` |

The initial test run before process-only policy configuration also reported
2 passed / 3 failed / 1 skipped. The failures persisted after that environment
correction. The existing skip applies only to the non-Windows PowerShell
UNSUPPORTED-host test. No Linux-only `test_navi.mjs` pass is claimed.

## Observed checks and blockers

| Check | Outcome | Evidence |
|---|---|---|
| Native Windows, Node and baseline identification | PASS | All four kit reports |
| Original fixture write and truncate blocked | PASS | All four kit reports |
| Original fixture replace guard | FAIL | `fixture_guard_original_replace` in all four kit reports |
| Remaining fixture operations / alias identity and release | NOT REACHED | Kit stops at replace failure |
| Real backend discovery and initialize | PASS | Both independent probe reports |
| Filtered eight-tool desktop surface | PASS | Both independent probe reports |
| Direct PowerShell call rejected | PASS | Both independent probe reports |
| Bridge exit | PASS | Both independent probe reports |
| Job Object cleanup verification | UNVERIFIED / FAIL | Both probes end with `CLEANUP_UNVERIFIED` |
| Scratch observation, input and re-observation | FAIL / NOT COMPLETED | Desktop probe has `steps: []`; independent native observation found the field still empty |

The toolkit's tests fail on the two expected-PASS report assertions and on
the rejected-initialize assertion (`CLEANUP_UNVERIFIED` instead of
`MCP_REQUEST_REJECTED`). These failures reproduce on the unchanged baseline.

The fixture guard failure is an observed failed assertion, not proof that
replacement actually succeeded: the report does not retain its underlying
exception. Likewise, cleanup overwrites the initial desktop-call error in
the probe; the exact first Snapshot error is unknown. No inferred root
cause is presented as established.

## Scratch scenario

The supplied `scratch.ps1` was launched through native PowerShell with
`-NoProfile -STA -File`. Its first disposable window acquired input during
observation, so that input was preserved and a second empty disposable
window was used. Native accessibility and screenshot observation established
the second field was empty before execution.

Actual installed schemas were read before creating these steps:

```json
[
  {"name":"Snapshot","arguments":{"use_vision":true,"use_ui_tree":true,"use_annotation":false}},
  {"name":"Type","arguments":{"text":"NTG NAVI WINDOWS QA","loc":[700,520],"clear":false,"press_enter":false}},
  {"name":"Snapshot","arguments":{"use_vision":true,"use_ui_tree":true,"use_annotation":false}}
]
```

The coordinate was inside the independently observed empty scratch field.
This was a coordinate-targeted scenario, not an element-targeted backend
call. The first Snapshot did not return successfully; no Type step completed.
Independent native accessibility and screenshot re-observation found the
field still empty. No successful input outcome is claimed.

## Boundaries, cleanup and remaining work

Both disposable scratch windows were closed, their process IDs were absent
on read-back, and native window enumeration returned no matching window.
Post-run process inspection found no surviving kit backend or fixture
descendants. This separate host inspection does **not** upgrade the probe's
`job_cleanup: UNVERIFIED` to PASS.

The task-owned runtime directory, portable uv, Python installation, backend
environment, package caches, local schemas and temporary step file were
removed after validation; directory existence read-back returned false.
All seven result JSON files parsed successfully. Biome LSP was unavailable;
no unrelated LSP package was installed for this artifact-only change.

No owner application input, login, messages, settings changes or paid model
calls were performed. Raw local schemas, screenshots, raw logs, credentials
and user-specific paths are excluded from this commit. Native screenshot
evidence remains local to the execution session.

The production implementation and AGY validation listed in guide section 4
remain PENDING: private authentication/keyring behavior, original credential
protection during AGY calls, production Navi invocation and confirmation,
ledger invariants, cancellation cleanup, packaged installation, and physical
GPU/multi-monitor validation. The existing kit must be repaired and rerun
before claiming successful end-to-end Windows validation.
