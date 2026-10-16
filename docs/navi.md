# Navi: bounded Linux desktop access

**Draft / blocked on AGY 1.3.6:** exact Argon model selection works, but the
agent-local MCP tools were not exposed in live invocations. The dispatch and
configuration below are implemented, not a claim that desktop control works.
See [live evidence](navi-evidence.md). Do not release this role until its
screenshot, accessibility and harmless input calls are observed through the
real runner.

Navi is named for AMD's Navi GPU architecture and "navigate". Steamroller
requests this desktop leaf through the exact-model runner on Gemini 4 Argon /
Medium. Bulldozer and its workers return desktop needs upstream instead of
invoking Navi. This preserves AGENTS.md's shallow graph: one bounded leaf,
no new coordinator, no child delegation, and no desktop tools on other roles.

Install `computer-use-linux` v0.7.17 on `PATH` outside NTG. Navi's agent
frontmatter alone attaches the stdio server with `computer-use-linux mcp`.
Never put this server in plugin-level, workspace or global MCP configuration:
those scopes would expose desktop tools beyond Navi. Existing native workers,
including Strix Halo and Excavator, retain their Flash contracts.

The frontmatter model is `inherit`, not an exact slug or `pro`. AGY accepts only
native model tiers there, and `pro` does not establish Argon selection. Runner
policy resolves `gemini-4-argon-medium` against `agy models` with no fallback.
The runner selects the installed Navi agent to load its MCP configuration;
inlining the Markdown body alone cannot attach a server.

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

Viewing screenshots, accessibility trees and available window lists is free.
Clicks and typing are allowed within scope. Navi observes before acting,
prefers accessibility elements over coordinates, never guesses a target, and
re-observes after each action. Payments, purchases, deletion, messages or email,
form submissions, login or credentials, and system settings must stop with
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

Coordinate plugin installation with other workers by holding
`flock /tmp/ntg-plugin.lock` across the entire branch install, live invocation,
main reinstall and byte comparison. Install the branch with `agy plugin
uninstall native-gravity` followed by `agy plugin install .`. Inspect the
stored conversation's executor and generation metadata for the model identity;
a successful reply alone is not model proof. Inspect transcript tool
declarations and actual MCP calls separately.

Restore from a clean main checkout with uninstall/install, then use
`diff -qr --exclude=.git <main-checkout> <installed-plugin>` to compare all
installed bytes and detect stale files. Do not release the shared lock before
the comparison succeeds.

AGY references:
[agent frontmatter](https://antigravity.google/docs/subagents?tab=cli),
[headless flags](https://antigravity.google/docs/cli/headless),
[plugin installation and MCP scope](https://antigravity.google/docs/cli/plugins).
