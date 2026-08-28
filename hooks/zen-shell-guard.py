#!/usr/bin/env python3
"""Behavioral backstop for Zen verification-shell calls.

Only commands explicitly marked by Zen are inspected. Other agents are unaffected.
This is intentionally a narrow role-behavior guard, not a general shell sandbox.
"""

import json
import re
import shlex
import sys

MARKER = "NTG_ZEN_VERIFY=1 "
DENY_REASON = (
    "Zen is verification-only. This shell command looks like an intentional "
    "project mutation. Re-run a non-mutating verification command or report "
    "the evidence gap; route any repair back through Bulldozer."
)

MUTATING_PATTERNS = [
    r"(?i)(?:^|[;&|]\s*)(?:sudo\s+)?(?:rm|mv|cp|install|touch|truncate|dd)\b",
    r"(?i)(?:^|[;&|]\s*)(?:sudo\s+)?sed\b[^;&|]*\s-i(?:\s|$)",
    r"(?i)(?:^|[;&|]\s*)(?:sudo\s+)?perl\b[^;&|]*\s-(?:p?i|i\w*)\b",
    r"(?i)(?:^|[;&|]\s*)git\s+(?:add|commit|checkout|switch|restore|reset|clean|merge|rebase|cherry-pick|am|apply)\b",
    r"(?i)(?:^|[;&|]\s*)(?:npm|pnpm|yarn|pip3?|uv|cargo|apt(?:-get)?|dnf|yum|pacman)\s+(?:install|add|remove|uninstall|update|upgrade|fmt)\b",
    r"(?i)(?:^|[;&|]\s*)prettier\b[^;&|]*--write\b",
    r"(?i)(?:^|[;&|]\s*)gofmt\b[^;&|]*\s-w(?:\s|$)",
    r"(?i)\b(?:writeFile|writeFileSync|appendFile|appendFileSync|renameSync|rmSync|unlinkSync|copyFileSync)\b",
    r"(?i)\b(?:write_text|write_bytes)\s*\(",
    r"(?i)\bopen\s*\([^)]*,\s*['\"][wax+]",
]


def respond(decision: str, reason: str | None = None) -> None:
    payload = {"decision": decision}
    if reason:
        payload["reason"] = reason
    print(json.dumps(payload))


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except Exception:
        respond("allow")
        return

    tool_call = event.get("toolCall") or {}
    if tool_call.get("name") != "run_command":
        respond("allow")
        return

    args = tool_call.get("args") or {}
    command = str(args.get("CommandLine") or "")

    # Role scoping is explicit because AGY PreToolUse payloads currently expose
    # modelName/conversationId but no reliable custom-agent name.
    if not command.startswith(MARKER):
        respond("allow")
        return

    body = command[len(MARKER):].strip()
    if not body:
        respond("deny", "Zen verification command was empty.")
        return

    try:
        tokens = shlex.split(body, posix=True)
    except ValueError:
        respond("deny", "Zen verification command could not be parsed safely.")
        return

    # Unquoted output redirection is a common direct-write path.
    if any(re.match(r"^(?:\d*>>?|\d*&>|&>>?|>\|)", token) for token in tokens):
        respond("deny", DENY_REASON)
        return

    if any(re.search(pattern, body) for pattern in MUTATING_PATTERNS):
        respond("deny", DENY_REASON)
        return

    respond("allow")


if __name__ == "__main__":
    main()
