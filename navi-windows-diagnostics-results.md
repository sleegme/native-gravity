# Navi Windows diagnostic rerun

Date: 2026-10-24 (UTC). Branch: `feat/navi-cross-platform`.
Starting commit: `56d77a4510d5ed1190f1b601a92f73a612659e55`.
Verified source/test fix: `7727fbc071f635ae79bbd0625ca87d5505f0a1ef`.
Artifacts were generated from the starting checkout plus the exact source
changes committed above; their embedded baseline SHA identifies that starting
checkout, not a claim that the old code produced the passing results.

**Result: native validation kit checks and scratch input verified.
Production Windows support remains PENDING.**

## Captured originals, without invented causes

### Fixture replacement

The instrumented, otherwise unfixed command produced:

```text
System.ArgumentException
The path is not of a legal form.
HResult: -2147024809
```

The low HResult code was 87. This was an argument/path error before the
intended sharing check, not proof of a credential-protection failure.
`navi-windows-diagnostic-before.json` retains the exception fields.

Changing only the null backup argument to a valid fixture-local backup
path made the original replacement guard pass. The new native regression
test then exposed a second defect: replacing the alias returned normally
while only the original path was held open. There was no exception in that
case. The intermediate reports preserve the FAIL rather than invent an
exception message.

Holding read/share-read handles for both original and alias paths fixes that
observed hole. All ten negative checks, unchanged fixture contents, alias
identity, and post-release writability now pass.

### First Snapshot backend error

**Not reproduced. No original backend error was returned in this rerun.**
The original Snapshot arguments returned an image even before the cleanup
fix. Its report still ended FAIL because cleanup overwrote the outcome.
See `navi-windows-snapshot-before.json`: Snapshot is `RETURNED`, while
`job_cleanup` is `UNVERIFIED`. Local `first_backend_error` was null.

No Snapshot-specific backend repair was guessed. Unexpected JSON-RPC error
payloads and tool-error text are now retained in the separate local-only
`first_backend_error` field before cleanup. A regression fixture verifies
exact original error retention while proving that a private-path/credential
sentinel never enters the shareable report. That synthetic error is a test,
not the original real-backend error.

### Job Object completion

Actual diagnostic output before the fix included:

```text
NAVI_JOB_DIAGNOSTIC {"operation":"GetQueuedCompletionStatus","returned":true,"win32_error":0,"message":4}
```

Messages 6 and 7 were also returned successfully with error code 0.
Message 4 confirms `ACTIVE_PROCESS_ZERO`; the Job query did not fail.
Nevertheless the wrapper returned 1, conflating the inner bridge's
signal-terminated backend status with Job cleanup.

The bridge's existing exit-status contract is unchanged. The Job wrapper now
records its child exit separately and reports successful cleanup only after
observing `ACTIVE_PROCESS_ZERO`. Timeout and native API failures still fail.
Final actual output includes:

```text
NAVI_JOB_CHILD_EXIT_CODE 1
```

Final reports separately show `backend_exit_code: 1`, `job_exit_code: 0`,
and `job_cleanup: PASS`. They do not hide the bridge status.

## Native commands and evidence

Environment: Windows NT 10.0.26200.0, Windows PowerShell 5.1.26100.9711,
Node v20.19.0, CPython 3.14.9, Windows-MCP 0.8.8, FastMCP 4.1.3.
Same backend/runtime versions as the baseline run.

Commands ran from the checkout in native Windows PowerShell, not WSL/Git
Bash. `$RunRoot` represents the owned temporary environment; its personal
absolute path is excluded. Script execution policy was process-only Bypass,
inherited by child PowerShell; no persistent policy setting changed.

| Command/scenario | Exit | Evidence |
|---|---:|---|
| `node --test tests/test_navi_windows_kit.mjs`, before fixes | 1 | 2 pass, 3 fail, 1 existing platform skip |
| Same full test command, after fixes | 0 | `navi-windows-tests-after.json`: 7 pass, 0 fail, 1 existing platform skip |
| `powershell.exe -NoProfile -File ./scripts/navi-validation/windows-kit.ps1 -Output ./navi-windows-diagnostic-before.json` | 1 | Original exception fields |
| Same kit with `-Output ./navi-windows-diagnostic-after.json` | 2 | Ten guards plus release/identity PASS |
| Kit with `-Backend "$RunRoot/venv/Scripts/windows-mcp.exe" -Output ./navi-windows-backend-after.json` | 2 | Protocol/boundaries/cleanup PASS; production PENDING |
| `node scripts/navi-validation/probe.mjs --backend "$RunRoot/venv/Scripts/windows-mcp.exe" --output navi-windows-protocol-before.json --schemas "$RunRoot/schemas.local.json" --diagnostics "$RunRoot/protocol-before.diagnostics.local.json"` | 1 | Native completion events succeeded despite wrapper exit 1 |
| Same independent probe with `--output navi-windows-protocol-after.json --diagnostics "$RunRoot/protocol-final.diagnostics.local.json"` | 0 | Backend/cleanup PASS; separate child status retained |
| Probe with original Snapshot args and `--steps "$RunRoot/snapshot.json"` | 1 | `navi-windows-snapshot-before.json`: Snapshot RETURNED, cleanup classification failed |
| Full kit with `-Backend "$RunRoot/venv/Scripts/windows-mcp.exe" -Steps "$RunRoot/steps.json" -Output ./navi-windows-desktop-after.json` | 2 | Snapshot/Type/Snapshot RETURNED; cleanup PASS |
| `powershell.exe -NoProfile -File ./scripts/navi-validation/windows-job.ps1 -CompileOnly` | 0 | `NAVI_JOB_COMPILE_PASS` |
| `node --check scripts/navi-validation/probe.mjs` | 0 | Syntax valid |
| `npm pack --dry-run --json` | 0 | Packaging passed |

Raw diagnostic/schema paths were explicitly directed inside `$RunRoot`.
`navi-windows-diagnostic-intermediate.json` and
`navi-windows-backend-intermediate.json` retain the alias-replacement failure
that the native regression caught between fixes.

## Real scratch outcome

The supplied disposable `scratch.ps1` window was observed empty through native
accessibility and screenshot capture. The same schema-checked payload ran:

```json
[
  {"name":"Snapshot","arguments":{"use_vision":true,"use_ui_tree":true,"use_annotation":false}},
  {"name":"Type","arguments":{"text":"NTG NAVI WINDOWS QA","loc":[700,520],"clear":false,"press_enter":false}},
  {"name":"Snapshot","arguments":{"use_vision":true,"use_ui_tree":true,"use_annotation":false}}
]
```

The coordinate was inside the observed empty field. This was coordinate input,
not an element-targeted backend call. The public kit correctly leaves each
tool's `outcome_verified` false. Independent native accessibility read-back
returned exactly `NTG NAVI WINDOWS QA`, and the native screenshot showed the
same text. This separate observation establishes the actual input outcome.
No screen content from other windows is included in committed evidence.

The owned scratch window was closed, its PID was absent on read-back, native
window enumeration was empty, and process inspection found no surviving
Navi backend or fixture descendants. Foreground control was released.

## Sharing and remaining limits

Arbitrary backend errors, raw stderr, raw schemas and screenshots are not
committed. `*.diagnostics.local.json` is ignored; the guide documents its
local-only handling. Shareable diagnostics expose trusted internal error
identifiers, numeric RPC codes, native return/error values, and fixture error
messages with the generated fixture path removed.

No existing test was removed or weakened. Added coverage verifies native
original/alias guards and raw-error non-disclosure, and strengthens the
existing Windows cleanup assertions. The one remaining skip is the unchanged
non-Windows-host UNSUPPORTED test. Linux runtime tests were not represented
as native Windows proof. TypeScript LSP is not installed; no clean LSP result
is claimed.

No AGY call, credential access, production Windows runtime implementation,
global/workspace configuration change, paid model call or main merge was
performed. The production gates listed in the kit guide remain PENDING.
