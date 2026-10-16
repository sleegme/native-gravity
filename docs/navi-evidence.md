# Navi live validation: blocked on MCP tool exposure

2026-10-16, AGY 1.3.6, computer-use-linux 0.7.17, Sway.
Branch rebased onto main `47d6678` (merged #155).

## Result

**Not release-ready.** Exact Argon dispatch works and the agent's MCP
configuration is stored, but AGY does not expose the server's tools in the
tested invocations. No working role-isolated alternative was demonstrated.
The draft PR must not be treated as successful desktop-control delivery.
No global, workspace or plugin-level MCP configuration was added.

## Real runner path

Installed the branch plugin and invoked:

```bash
node scripts/ntg-vnext.mjs init --ledger /tmp/ntg-navi-live-ledger.json \
  --plan /tmp/ntg-navi-live-plan.json
node scripts/ntg-vnext.mjs navi --ledger /tmp/ntg-navi-live-ledger.json \
  --timeout 180 --task "Take a full-screen screenshot and inspect the accessibility tree"
```

The actual observation task also prohibited clicks/typing into existing
windows, shell execution, settings changes and window-targeting dependencies.
Conversation `077956ca-0cd7-4900-8589-522ef7c0869b` returned `BLOCKED`;
the CLI exited 2. No screenshot or accessibility MCP call occurred.

Decoded the SQLite conversation's protobuf blobs (row `idx=0`):

| Table | Field-number path | Observed value |
|---|---|---|
| `executor_metadata` | `10.1.28` | `gemini-4-argon-medium` |
| `gen_metadata` | `3.28` | `gemini-4-argon-medium` |
| `gen_metadata` | `1.19` | `gemini-4-argon-trial` |
| `executor_metadata` | `10.1.57.3.2.1` / `10.1.57.3.2.2` | server name / command both `computer-use-linux` |
| `gen_metadata` | `1.8.1` | `manage_task` (the only tool declaration) |

These are decoded metadata/request fields, not the model's self-report.
The requested Medium model and actual Argon backend are established; tool
availability is not. The transcript contains only user/model steps and zero
MCP calls. The raw SQLite files remain in AGY's local conversation store and
are not committed because they contain unrelated host/session context.

## Confirmation behavior

Conversation `085bcca6-11e8-4979-909f-dd6af3b60d08` used the same real runner
path with a request to log in, explicitly stopping before any action.
It returned `NEEDS_CONFIRMATION`, exited 2, and supplied:

> Log in to the displayed website by entering credentials and submitting the login form.

`actions` was empty. Its model and tool metadata fields match the observation
conversation above. This proves the response contract, not enforcement against
an available mutating desktop tool: that stronger proof remains blocked.

## Alternative-path investigation

| Probe | Conversation | Result |
|---|---|---|
| `--agent navi --model gemini-4-argon-medium`, empty native tool list | `3182f030-c846-47c2-88b8-49db029241ce` | Argon Medium / Argon trial in metadata, server config stored, only `manage_task` declared |
| Same selection, omit native `tools` | `24f1eb79-37f8-4baf-950f-0829ccf1d6a5` | Default native tools appeared; no desktop MCP tools |
| Exact-model parent invoking native Navi child | parent `6e7e016a-a450-4cbe-bd61-2744df9dfc7d`, child `cd81fba3-8582-4ff5-8248-715c90038848` | Child inherited Argon Medium / trial, but no desktop MCP tools |
| Agent-local eager server tool setting | `262e7dcf-9bc2-45d2-948b-f8b693c51ef2` | Still only `manage_task` |
| Customization inheritance enabled | `6518553e-2b31-4c49-836b-2ca1ece31aba` | Still only `manage_task` |

Explicit native tool entries `mcp`, `mcp_tool`, `mcp_tools` and
`call_mcp_tool` were rejected by AGY as unknown registry components (not
retained). The respective conversation IDs are
`0780f307-e322-4cba-899d-cd18ea6f4926`,
`6da02d8d-0be0-4ccd-b1c4-eab4675549a3`,
`aaf4dac1-a091-4ee1-a2cf-d95803d3e947`, and
`1c48392f-df55-4739-a5ae-891dab7070b8`.
Speculative inheritance and eager settings were removed from the final agent.
The exact internal cause of missing tool exposure is not established.

## Host control, separate from Navi

A direct MCP stdio client successfully initialized computer-use-linux 0.7.17,
listed its 18 tools and called `get_app_state` with `include_screenshot=true`,
`max_nodes=80`, `max_depth=5`. This is a host control, **not** Navi live proof.

- PNG: 1920 x 1080, 1,255,100 bytes.
- PNG SHA-256: `f97ebc3860d2913ab55805454ec9175ced9f2b5a50e55468462e21be2e912330`.
- Accessibility: 8 nodes, `accessibility_error=null`.
- Readiness: screenshot verified, accessibility and development input available.
- Window listing/focus/targeting unavailable, as expected on this Sway host.

No screenshot pixels or application contents are committed. No click, typing
or input action was attempted: Navi lacks desktop tools, and host-only input
would not prove Navi control. Harmless input through Navi remains blocked.
No system packages, sudo, credentials or desktop setting changes were used.

## Installation restoration and overlap

After the initial pre-coordination probe, every install/probe/restore/compare
sequence held `flock /tmp/ntg-plugin.lock` exclusively. Each restored main.
The final real-runner sequence reinstalled clean main `47d6678`, then
`diff -qr --exclude=.git <main-checkout> <installed-plugin>` exited 0 and
printed `MAIN_47d6678_BYTE_COMPARE_PASS` before releasing the lock.

The rebase preserved #155's DONE alias normalization, artifact binding and
bounded correction loop. Navi adds one isolated `requestDesktop` method near
the planning entrypoint and one transport-provenance line in `spine.mjs`;
it does not edit the milestone correction loop. Shared documentation paths
are `rules/orchestration.md` and the vNext spec; additions are separate.

## Repository checks after rebase

| Command | Result |
|---|---|
| `node --test tests/*.mjs` | Exit 0; 189 tests, 188 passed, 0 failed, 1 existing watch-mode skip |
| `python -m unittest discover -s tests -v` | Exit 0; 17 passed |
| `npm pack --dry-run` | Exit 0; 35 files, including Navi agent and both Navi documents |
| `agy plugin validate .` | Exit 0; 11 agents and 2 hooks processed |
| `git diff --check` | Exit 0 |
| Personal absolute-path scan of tracked diff and untracked additions | No matches |

The first Node run caught two local issues: the edited CLI lost its executable
bit, and the new frontmatter test expected a newline beyond the captured
block. Both were fixed; the full command above then passed in one run.
Language-server diagnostics were unavailable because the configured TypeScript
and Biome executables are not installed; Node syntax checks passed.
Manual desktop QA failed at tool exposure, so no gate-review approval is
claimed and the PR remains draft.

## Follow-up A: per-process isolated config root

The owner authorized this alternative after the initial investigation. It
does not change the owner's real global MCP file.

### Config discovery and auth control

`agy --help` exposes no config-root flag. The builtin
`agy-customizations/docs/mcp_servers.md` identifies
`~/.gemini/config/mcp_config.json`. A nonsecret fixture and `agy mcp list`
established that overriding `HOME` redirects that file:

```bash
HOME=<private-root> agy mcp list
```

The list showed only computer-use-linux, stdio, enabled. The tested
`XDG_CONFIG_HOME`, `ANTIGRAVITY_GEMINI_DIR` and
`ANTIGRAVITY_CONFIG_REL_DIR` values did not redirect that command's discovery.
This does not establish whether those variables have other internal uses.
The installed binary contains the Antigravity variable names, but string
presence alone is not evidence of a supported config override.

The private root contained its own `.gemini/config/mcp_config.json` and plugin
installation. Its auth file was a runtime symlink to the existing owner's
`antigravity-oauth-token`, not copied credential contents. Bubblewrap mounted
the source credential file read-only for the model process. No credential
value was read by the probe, printed, or added to source or receipts.
Model generation completed, so auth did not block these controls.
Corrected controls used `--dev-bind /dev /dev`: an earlier mount lacked usable
device nodes and produced a log redirection warning.

Running the canonical `agy mcp add --type stdio` and `agy mcp enable` inside
the private root produced the same command/args config, ruling out a
handwritten-schema difference.

### Stored metadata and transcript results

| Control | Conversation | Declared tools / actual calls |
|---|---|---|
| Isolated HOME, selected Navi, shipped empty native tool list | `cc229320-c768-47f0-bfcc-8dd9d7a4f77d` | Only `manage_task`; zero MCP calls |
| Same private root, omit Navi's native tool list | `9565c264-4b8d-4087-892d-ed173dc65b9e` | Seven default native tools; zero MCP calls |
| Corrected device mount, default CLI agent with bounded Navi task and exact model | `00840c79-2b79-4ac4-8351-cef55ed80e5e` | Thirteen native tools; zero MCP calls |

All three stored `executor_metadata` fields `10.1.28` and `gen_metadata`
fields `3.28` contain `gemini-4-argon-medium`; generation field `1.19`
contains `gemini-4-argon-trial`. All transcript step tables contain only one
type-14 user step and one type-15 model step, with no tool-call steps.
The native tool names were decoded from generation field `1.8.1`, not
inferred solely from the responses.

The seven-tool control declared `send_message`, `view_file`,
`read_url_content`, `search_web`, `schedule`, `generate_image`, and
`manage_task`. The thirteen-tool default control declared `view_file`,
`run_command`, `manage_task`, `send_message`, `schedule`, `invoke_subagent`,
`define_subagent`, `manage_subagents`, `write_to_file`,
`replace_file_content`, `read_url_content`, `search_web`, and `ask_question`.
Neither contained a desktop MCP function or MCP dispatcher/discovery tool.

**A is a documented dead end on the tested AGY 1.3.6 surface:** config-root
redirection and model generation work, but desktop tool injection does not.
These controls do not prove the design impossible in another AGY version.
No unproven isolated-HOME dispatch code is being added to the runner.

## Follow-up B: plugin-level MCP with a role hook

Tested only after A's three controls failed. This fallback is **weaker
isolation**: server discovery would be conversation-wide and a hook would gate
calls afterward, rather than keeping the server out of other role processes.
The owner authorized this temporary experiment; it is not a shipped exception
to the role-isolation policy.

A separate worktree added plugin-level `mcp_config.json` and a PreToolUse
prototype with matcher `*`. The prototype read the current conversation's
stored agent name from `trajectory_metadata_blob` field `4.1`, rather than
trusting task text or a caller-supplied role marker. Its intended MCP decision
was allow for exact `navi`, deny otherwise. Native non-MCP tools were allowed.
The sanitized audit recorded only conversation ID, role, tool name and
decision, never tool arguments or credential values.

Plugin validation and installation both reported **one MCP server and three
hooks**. The experimental Navi definition omitted its empty native tool list
to avoid repeating that filtering confound. All other agent files were
unchanged.

| Control | Conversation | Stored evidence |
|---|---|---|
| Selected Navi | `eda84947-f305-488c-927a-010fe37885b3` | Argon Medium / trial; same seven native tools as A's inherited-tool control; no desktop MCP declaration, no tool-call steps |
| Exact-model parent delegating the control | `f2f65565-819d-4049-baf9-727487745c7b` | Argon Medium / trial; native delegation, no MCP call |
| Unmodified native Jaguar child | `b0e9e73c-80d0-4eaa-be83-cb751a26f6f9` | `gemini-3.8-flash-tiered`; native file read and parent message only; no desktop MCP declaration or call |

Jaguar's generation field `1.8.1` declared only `find_by_name`, `grep_search`,
`list_dir`, `manage_task`, `send_message`, and `view_file`.
Its transcript's actual generic tool-call steps were `view_file` and
`send_message`. The hook audit independently recorded:

```json
{"conversationId":"f2f65565-819d-4049-baf9-727487745c7b","role":"UNKNOWN","tool":"invoke_subagent","decision":"allow"}
{"conversationId":"b0e9e73c-80d0-4eaa-be83-cb751a26f6f9","role":"jaguar","tool":"view_file","decision":"allow"}
{"conversationId":"b0e9e73c-80d0-4eaa-be83-cb751a26f6f9","role":"jaguar","tool":"send_message","decision":"allow"}
```

This establishes that the hook was installed, ran on actual calls and read
Jaguar's stored identity. It **does not** establish MCP denial or Navi
permission: neither actor received a desktop MCP tool, so no actual gated MCP
attempt could occur. A synthetic hook input would not substitute for that
missing proof.

**B is also a documented runtime dead end in the mixed-version run below.** It failed before
the desired allow/deny comparison could be exercised. No plugin-level server,
prototype hook, changed agent tool list or Bun runtime dependency from this
experiment is being added to the PR.

Runtime-version audit found that the installed binary changed during this
sequence. The selected-Navi startup log identifies **1.3.6**; the subsequent
parent/Jaguar startup log identifies **1.4.0**. The reason for the binary
replacement is unknown. These version assignments come from the language
server startup lines paired with the conversation IDs, not from the binary's
version at reporting time.

## Follow-up restoration and scope

Every follow-up install/probe/main-restore/byte-compare sequence held the
exclusive `/tmp/ntg-plugin.lock`. The final B sequence restored main
`47d6678`; recursive comparison exited 0 and printed
`MAIN_RESTORE_BYTE_COMPARE_PASS`. Main again has ten agents and two hooks,
without the experimental MCP registration.

The owner's real global MCP file remained 23 bytes with the same modification
time and SHA-256 before and after:
`d8e397af03b5b032f21d0aa967086f0c78b33c87b76f2e9898ae0a144df7de02`.
Only private generated config files and the separate experimental plugin were
changed. The temporary auth symlink was removed after the controls.
No credential values, raw auth files, screenshot pixels, full model logs or
SQLite stores are added to this PR.

The production follow-up diff is documentation only. Existing regression
coverage is unchanged; adding a test that pins these prose findings would not
prove runtime MCP access. The PR remains draft because both alternatives
lacked desktop tools, not because of an unverified claim that the hook
successfully blocked a non-Navi actor.

Follow-up checks: `node --test tests/test_navi.mjs` passed all five tests;
`npm pack --dry-run`, `agy plugin validate .` and `git diff --check` exited 0.
The executable changed during this otherwise prose-only follow-up, prompting
the additional versioned controls below and a fresh full-suite run.

## Current-runtime recheck: AGY 1.4.0

`agy --version` reported 1.4.0 after validation output changed. Startup logs
paired with the IDs below confirm that version served the rechecks.
`AGY_CLI_DISABLE_AUTO_UPDATE=1` was set for these child runs. The private-HOME controls
retained read-only credential mounts and usable device mounts.

| Path | Conversation | Decoded declared tools / calls |
|---|---|---|
| A: selected Navi, explicit empty native list | `daea5743-e011-4101-86c6-abd07c4b9878` | Only `manage_task`; no MCP call |
| A: selected Navi, omit native tool list | `1e5a348e-66d6-450a-9c08-0ef161212765` | Same seven default native tools as earlier; no MCP call |
| A: default-agent, exact-model bounded Navi task | `424cc821-f495-480c-96ee-23b8c81a336e` | Same thirteen default native tools as earlier; no MCP call; envelope ERROR with stream interruption |
| B: freshly installed plugin-level server plus role hook, selected Navi without empty tool filter | `a9a853ef-a7f2-4231-932e-185df24f0b24` | Same seven native tools; no MCP call |

The B recheck used an empty private global MCP config, so its only server
registration came from the experimental plugin. Validation reported one
server and three hooks before installation. The non-Navi Jaguar result
`b0e9e73c-80d0-4eaa-be83-cb751a26f6f9` above was already served by 1.4.0.

Every recheck's stored executor/request model remains
`gemini-4-argon-medium` and its generation backend `gemini-4-argon-trial`.
Navi's three completed controls contain only type-14 and type-15 transcript
steps. The interrupted default-agent control additionally contains a type-17
error step; it is not claimed as a successful invocation. None contains a
desktop MCP declaration or actual MCP call.

**Neither A nor B is proven end to end on the current 1.4.0 runtime.**
In particular, B still cannot demonstrate actual MCP denial for Jaguar and
permission for Navi because the desktop tools never become callable.
The read-only credential references were removed after the rechecks.
The final locked restore again byte-matched main `47d6678`, and the owner's
global MCP file retained the same hash, size and modification time.
Only these documentation receipts change in the PR; it stays draft.

The fresh 1.4.0 full-suite run passed: `node --test tests/*.mjs` exited 0
with 189 tests, 188 passed, 0 failed and the same one existing watch-mode
skip; `python -m unittest discover -s tests -v` exited 0 with 17 passed.
