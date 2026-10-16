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
