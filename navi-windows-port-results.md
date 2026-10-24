# Navi Windows execution port results

Date: 2026-10-24. Branch: `feat/navi-cross-platform`.
Starting commit: `946094c`.

## Implementation scope

The Windows execution path is implemented. Existing Linux test files and
the Linux `withNaviHome` body are unchanged. Default model policy remains
Gemini 4 Argon / Medium; Flash / low was used only for the requested probe.
This report does not declare full Windows desktop support or approve a
merge to main.

- `scripts/navi.mjs` resolves and pins the installed agy executable before
  creating a private profile. An explicit `agyPath` / `AGY_PATH` takes
  precedence; otherwise the original profile's `AppData\Local\agy\bin\agy.exe`
  and original process PATH are searched. Paths inside the original
  `.gemini` are excluded from executable lookup without filesystem access.
- Only child environments receive `USERPROFILE`, `HOME`, and
  `AGY_CLI_DISABLE_AUTO_UPDATE=1`. Parent, user, and system environments
  are not modified. No original credential file is copied, linked, or read.
- Only `<private-profile>\.gemini\config\mcp_config.json` is written.
  It contains only `cu`, using Node + `navi-bridge.mjs --windows` +
  Windows-MCP. Telemetry is disabled and Python stdio uses UTF-8.
- `windowsBackend` or process-local `NTG_NAVI_WINDOWS_BACKEND` selects
  the backend; otherwise `windows-mcp.exe` is resolved from the original
  PATH. Default arguments are `serve --transport stdio --tools
  Snapshot,Screenshot,Click,Type,Scroll,Move,Shortcut,WaitFor`.
- Windows Navi model discovery and prompt transport use the same private
  environment and Job boundary. Non-Navi execution and Linux transport
  keep their existing defaults.

`scripts/navi-validation/windows-job.ps1` preserves legacy kit requests
and adds an opt-in private request-file mode. Requests are not placed in
the command line. The workload is created suspended, assigned to the Job,
and only then resumed. Normal exit, timeout, root failure, owner death,
and relay failure terminate descendants and wait for `ACTIVE_PROCESS_ZERO`
before profile removal. Production returns the workload's status; legacy
kit status still certifies cleanup independently of backend status.

A detached Node relay keeps the supervisor alive after owner termination,
without directly detaching Windows PowerShell from its stdio handles.
The supervisor watches both owner and relay process handles without
polling. Output-buffer failure also waits for supervisor cleanup.
Cleanup is restricted to a validated `ntg-navi-*` directory immediately
under the inherited system temp directory, matching child HOME/USERPROFILE.
Junction and symbolic-link targets are not traversed during removal.

## Verification

| Check | Result |
| --- | --- |
| Native Windows execution, Job, and existing kit tests | 24 PASS, 0 FAIL, 1 existing platform SKIP; 25 tests |
| Additional original-path lookup guard / runner tests | 8 PASS, 0 FAIL |
| Linux regression | 160 PASS, 0 FAIL, 2 existing platform SKIP; 162 tests |
| Existing spike harness inside Linux run | 61 PASS, 0 FAIL; existing `SKIP_LIVE_TESTS=1` option |
| Node syntax checks | Exit 0 |
| `npm pack --dry-run --json` | Exit 0; Navi, runner, and Job wrapper included; no local diagnostics/request files included |
| LSP diagnostics | Unavailable: TypeScript and C# language servers are not installed |

Native command:

```text
node --test tests/test_navi_windows.mjs tests/test_navi_windows_job.mjs tests/test_navi_windows_kit.mjs
```

The validation PowerShell process supplied a process-only execution-policy
override for existing kit children; no machine/user policy was changed.
Tests use a fake managed agy executable, synthetic configuration, and
event-signalled descendant readiness. They verify:

- Child-only environment delivery; original-profile executable resolution,
  including spaces and non-ASCII paths.
- Exactly one private cu registration; no access to the fake owner's
  `.gemini`, including executable searches through an excluded PATH entry.
- Model discovery within the private Job path.
- Normal exit, nonzero exit, timeout, output overflow, callback failure,
  missing executable, malformed request, and parent termination.
- Descendant/grandchild exit and profile deletion; junction targets survive.
- Legacy kit compilation, cleanup status, diagnostics, bridge filtering,
  and direct-call restrictions.

The first Linux run used the Windows working tree and exposed two checkout
artifacts: CRLF-sensitive frontmatter and a CRLF/executable shebang case.
Its existing live spike section also encountered quota failures. Tests
were not edited or weakened. Final Linux verification used a temporary
Linux filesystem artifact from the Git archive, overlaid with the current
Navi/runner sources, preserving Git LF and executable modes. The existing
live-test opt-out was used to avoid further paid model invocations.
That artifact was removed after the run.

## Requested real Flash measurement

Exactly one Windows prompt invocation was performed through the new
private-home and Job execution path, with the real installed agy:

```text
agy -p "reply OK" --model gemini-3.8-flash --effort low
```

The private config pointed at temporary Windows-MCP 0.8.8 on CPython
3.14.9. Dependencies and the measurement helper lived outside the repository;
no permanent PATH or Python installation setting was changed.

| Observation | Result |
| --- | --- |
| Start, UTC | `2026-10-24T06:14:10.349Z` |
| End, UTC | `2026-10-24T06:14:29.716Z` |
| Windows prompt invocations | 1 |
| Returned runner error | `NAVI_JOB_FAILED` |
| Successful `OK` response retained | No |
| Job cleanup certificate accepted by that run | No |
| Private profile absent after return | Yes |
| Parent environment unchanged | Yes |
| Original agy-tree entries before / after | 116 / 116 |
| Original added / removed / metadata-changed entries | 0 / 0 / 0 |

The observed original root was
`%USERPROFILE%\.gemini\antigravity-cli`. Only filenames and metadata
(type/mode, size, timestamps, file identifier) were compared. No content
or credential value was read; links were not followed.

This measurement is **not a successful end-to-end Flash PASS**. Its raw
supervisor/model output was not retained, so the exact original failure
text is unavailable. The fixed error identifier and the comparison above
are the evidence; no underlying model or native error is inferred.

### Subsequent investigation without another model invocation

The real agy's read-only `mcp list`, in another private profile under the
same Job route, completed with supervisor exit 0 and an accepted cleanup
certificate. No additional prompt/model invocation was made for this check.

A controlled Node fixture then reproduced `NAVI_JOB_FAILED` despite
supervisor exit 0 and an emitted certificate: child stderr without a
trailing newline caused the certificate to join the previous text, while
the consumer required a complete line. The supervisor now writes a leading
newline before its certificate. The same fixture then returned status 0.
The fake-agy regression emits stderr without a trailing newline, and the
complete native suite passed after the fix.

This proves the certificate-framing defect and its correction. It does
not recover the discarded real-run output or prove that defect caused the
original Flash result. No post-fix Flash retry has been performed within
the original one-invocation budget; successful real-model completion on the
final revision remains unverified.

## Scope and privacy

Only implementation sources, synthetic tests, this report, and the guide's
status pointer are intended for the commit. Credentials, private MCP
configuration, request files, raw logs, conversation stores, dependency
environments, and personal paths are excluded. Original state is not a
cleanup target. Full desktop input/observation through the model is outside
this prompt-only measurement and remains a separate validation task.
