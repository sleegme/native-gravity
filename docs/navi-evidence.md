# Navi live validation: desktop calls through the real runner

2026-10-16, AGY 1.4.0, computer-use-linux 0.7.17, Sway, branch `feat/navi-desktop`
(main `47d6678`).

## Result

**Working.** Through the real `ntg-vnext navi` runner path, Navi on
`gemini-4-argon-medium` observed the desktop with actual `call_mcp_tool` calls
to server `cu`: `doctor`, `get_app_state` with `include_screenshot=false`, and
one size-bounded screenshot. No click or typing occurred. The private
per-process HOME registers only that server, and no agent frontmatter, plugin,
workspace or global MCP configuration contains it.

## Real runner path

```bash
node scripts/ntg-vnext.mjs init --ledger <scratch>/live-ledger.json \
  --plan <scratch>/live-plan.json
node scripts/ntg-vnext.mjs navi --ledger <scratch>/live-ledger.json \
  --timeout 600 --task "Using call_mcp_tool on server cu: run doctor, query the
  accessibility tree with include_screenshot=false and small max_nodes, then
  take ONE screenshot at max_width 960. Click and type nothing. Report results."
```

Conversation `eee32b48-7f70-4060-ae4d-3f93a4c0f36e` returned `OBSERVED`,
exit 0. The ledger stayed unchanged: `requestDesktop` is a bounded leaf call
that promotes nothing.

| Evidence | Value |
|---|---|
| `executor_metadata` 10.1.28 / `gen_metadata` 3.28 | `gemini-4-argon-medium` |
| `gen_metadata` 1.19 | `gemini-4-argon-trial` |
| `gen_metadata` `mcp_servers` prompt section | server `cu`, 18 lazy tools |
| `gen_metadata` declared tools (1.8.1) | includes `call_mcp_tool` |
| Transcript calls | `cu/doctor {}`; `cu/get_app_state {include_screenshot:false, max_nodes:50, max_depth:4}`; `cu/screenshot {format:jpeg, max_width:960, max_height:540, quality:60}` |
| Doctor | sway/wayland seat; AT-SPI ok; input abs_pointer/wtype/ydotool; screenshot portal; window control unavailable |
| Accessibility tree | raw count 14, truncated at the requested bound |
| Screenshot | jpeg 960x540 via xdg-desktop-portal; 1,241,334 bytes original, 71,459 bytes returned |
| Actions | the three calls above; no click, typing, focus or shell |

The run used 4 planner turns: 24,662 input + 52,012 cache-read + 1,506 output
tokens. The accessibility-first instruction keeps a bounded observation far
below the earlier screenshot-loop cost (~272k input tokens).

The committed Navi body sharpened its schema-discovery sentence after this
run (read AGY's materialized schema files); the contract and tool path are
unchanged.

## Why a discovery bridge is required

AGY 1.4.0 probes every stdio MCP server with a custom `server/discover`
request before the standard `initialize` handshake. computer-use-linux 0.7.17
treats any non-`initialize` first request as fatal ("expect initialized
request, but received ... server/discover") and exits, so AGY retries once and
drops the server: the `mcp_servers` prompt section resolves empty and the
model sees no `call_mcp_tool`. Control conversation
`f51df454-d67b-4b91-bf48-f5ccf22306d4` (same runner path, raw binary
registered) returned `BLOCKED` with the dispatcher absent.

`scripts/navi-bridge.mjs` answers the probe exactly as standard servers do
(JSON-RPC `-32601 method not found`, matching the local calc test server) and
forwards every other message verbatim in both directions. With the bridge
registered as `cu`, the same runner path exposes the dispatcher and the calls
above succeed. The bridge is protocol plumbing only: it never inspects
arguments, results or credentials.

## Isolation controls

Each invocation gets a private temp HOME. It contains only the `cu`
registration; the OAuth token is exposed through a symlink plus a bubblewrap
read-only bind; `conversations` and `brain` link back to AGY's store so the
conversation above stays inspectable after the temp root is removed (removal
observed). Errors carry no configuration output, credential values or owner
paths, and missing desktop variables, credential or binary fail closed with
typed errors before any process starts. Regression coverage:
`tests/test_navi.mjs`.

## Non-Navi denial

A runner role without the private HOME cannot reach the server. Piledriver was
invoked with the same request through `node scripts/runner.mjs piledriver ...`
(real HOME; the global MCP configuration has no servers):

- Conversation `afaaba80-d048-4f04-b5fe-095185ddd779`; model
  `gemini-4-argon-high` (both metadata fields).
- Response `BLOCKED`: `call_mcp_tool` and server `cu` are "not declared or
  exposed" in its tool surface; the transcript has zero tool-call steps, so
  the attempted call did not execute.

## Approach B (rejected)

Plugin-level MCP plus a role hook was exercised only as a temporary
experiment and is not shipped: server discovery would be conversation-wide
with a hook gating calls afterward, which is weaker isolation than keeping the
server out of other roles' processes.

## Earlier controls (superseded)

The earlier conclusion that the private-HOME design dead-ended came from
reading the absence of named `mcp_<server>_<tool>` tools as absence of access.
AGY never lists MCP tools by name; the interface is the generic
`call_mcp_tool` dispatcher, and the missing piece was the `server/discover`
handshake above. Failing controls kept for provenance:
`3f3c42e6-6e6f-4486-ade5-72f51d223222`,
`8784d02e-a373-4f3d-bd28-fce9a541d4d0`,
`f51df454-d67b-4b91-bf48-f5ccf22306d4`.

## Repository checks

| Command | Result |
|---|---|
| `node --test tests/*.mjs` | Exit 0; 196 tests, 195 passed, 0 failed, 1 existing watch-mode skip |
| `python -m unittest discover -s tests -v` | Exit 0; 17 passed |
| `npm pack --dry-run` | Exit 0; 37 files, including both Navi runner sources and both Navi documents |
| `agy plugin validate .` | Exit 0; 11 agents, 2 rules, 2 hooks, 0 MCP servers |
| Home-path scan of the full staged diff | 0 matches |

The live run needed no plugin installation (no native `--agent` selection).
The installed plugin was reinstalled from main under
`flock /tmp/ntg-plugin.lock` after the run and byte-compared clean
(`MAIN_BYTE_COMPARE_PASS`).
