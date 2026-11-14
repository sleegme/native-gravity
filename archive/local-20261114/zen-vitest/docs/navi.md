# Navi: bounded Linux desktop access

Navi is named for AMD's Navi GPU architecture and "navigate". Steamroller
requests this desktop leaf through the exact-model runner on Gemini 4 Argon /
Medium. The runner invocation builds a private per-process config root that
registers only the desktop server `cu`; the model reaches its tools through
AGY's generic `call_mcp_tool` dispatcher, because AGY does not list MCP tools
by name. No agent frontmatter, plugin, global or workspace MCP configuration
contains that server. Live evidence through the real runner is recorded in
[live evidence](navi-evidence.md).

Bulldozer and its workers return desktop needs upstream instead of invoking
Navi. This preserves AGENTS.md's shallow graph: one bounded leaf, no new
coordinator, no child delegation, and no desktop tools on other roles.

## Setup

Install `computer-use-linux` v0.7.17 at `~/.local/bin/computer-use-linux` and
keep the owner's AGY OAuth token at
`~/.gemini/antigravity-cli/antigravity-oauth-token`. The invocation requires
`WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS`; it fails
closed with a typed error when any is missing, when the credential or binary is
unavailable, or when the private server registration fails.

The private root carries only the `cu` server registration. The registration
points at a small stdio bridge (`scripts/navi-bridge.mjs`) that answers AGY's
pre-handshake `server/discover` probe — the desktop server itself exits on
that probe — and otherwise proxies the protocol verbatim to the desktop
binary. The OAuth token is exposed through a symlink plus a bubblewrap
read-only bind, and the root's `conversations` and `brain` directories link
back to AGY's store so each invocation stays inspectable after the temp root
is removed. Bubblewrap makes only the credential read-only (it binds `/` and
`/dev` writable) and is not a full sandbox. Errors never carry configuration
output, credential values or owner paths.

The frontmatter model is `inherit`, not an exact slug or `pro`; native agent
frontmatter cannot pin models. Runner policy resolves `gemini-4-argon-medium`
against `agy models` with no fallback, and no native agent selection is used:
the runner composes the Navi body into a bounded prompt for the default CLI
agent inside the sandbox.

## Invocation

With an initialized ledger and no active milestone or review:

```bash
node "$NTG/scripts/ntg-vnext.mjs" navi --ledger .ntg/ledger.json \
  --task "Take a full-screen screenshot and inspect the accessibility tree"
```

This is Steamroller's bounded desktop request, not a new project entrypoint.
The command holds the existing ledger lock and returns `desktop` plus unchanged
ledger state. It does not promote a milestone. `BLOCKED` and
`NEEDS_CONFIRMATION` exit with code 2; confirmation includes the exact
`intended_action` for the owner. The runner never retries an empty Navi result,
because an earlier invocation may already have changed desktop state.

Viewing screenshots, accessibility trees and available window lists is free
of confirmation, not free of token cost: Navi prefers accessibility-tree
queries and at most one size-bounded screenshot per step. Clicks and typing are
allowed within scope. Navi observes before acting, prefers accessibility
elements over coordinates, never guesses a target, and re-observes after each
action. Payments, purchases, deletion, messages or email, form submissions,
login or credentials, and system settings must stop with
`NEEDS_CONFIRMATION` before any action. This is a role instruction, not a
general desktop sandbox.

## Host capabilities

On Sway, computer-use-linux does not provide window introspection or targeting.
Use full-screen screenshots and accessibility-tree element actions; do not
depend on focus, window activation or targeted keyboard helpers. Missing
capabilities are reported, never repaired by Navi through package installation
or desktop settings changes.

Input requires a working backend such as ydotool/wtype configured by the owner.
AT-SPI must already be enabled, and portal screenshot consent must be available.
NTG does not install system packages or use sudo to prepare these facilities.
Live validation must avoid clicking or typing into the owner's existing windows.
Use a harmless pointer action, or a scratch field created specifically for QA.

## Reproducing live validation

Run the invocation above from a checkout of this repository: the runner
composes `agents/navi.md` from the working copy, so the desktop-registration
path needs no plugin installation. The conversation is stored under
`~/.gemini/antigravity-cli/brain/<conversation-id>/` with its metadata in the
local store; inspect both for the resolved model and the actual
`call_mcp_tool` calls. A successful reply alone is not model proof.

For the non-Navi control, invoke another runner role with the same request:
its environment keeps the owner's global MCP configuration, which has no `cu`
server, so the dispatcher call must fail or report the server absent.

If a plugin installation is ever involved, coordinate with other workers by
holding `flock /tmp/ntg-plugin.lock` across the entire install, live
invocation, main reinstall and byte comparison. Restore from a clean main
checkout with uninstall/install, then compare all installed bytes with
`diff -qr --exclude=.git <main-checkout> <installed-plugin>`. Do not release
the shared lock before the comparison succeeds.

AGY references:
[agent frontmatter](https://antigravity.google/docs/subagents?tab=cli),
[headless flags](https://antigravity.google/docs/cli/headless),
[plugin installation and MCP scope](https://antigravity.google/docs/cli/plugins).
