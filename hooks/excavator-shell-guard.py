#!/usr/bin/env python3
"""Narrow behavioral backstop for Excavator shell calls.

Excavator is intentionally allowed to mutate and to use sudo when that is part of
its bounded troubleshooting task. This guard does not sandbox privileged work.
It only blocks high-confidence role drift observed in runtime testing: trying to
acquire credentials or alternate privilege paths after authorization is
unavailable, and using a full-system upgrade as an exploratory troubleshooting
step.
"""

import json
import re
import sys

MARKER = "NTG_EXCAVATOR=1 "

PRIVILEGE_DRIFT_REASON = (
    "Excavator may use sudo for task-relevant work, but it must not turn missing "
    "authorization into a credential-discovery or privilege-acquisition task. "
    "Continue with available diagnostics, ask the user to provide authorization, "
    "or report the privileged step as BLOCKED."
)

FULL_UPGRADE_REASON = (
    "Excavator must not use a full-system upgrade as an exploratory troubleshooting "
    "step. Preserve the user's constraints and make the smallest evidence-backed "
    "change needed for the bounded problem."
)

PRIVILEGE_DRIFT_PATTERNS = [
    # High-confidence non-interactive password injection into sudo. Ordinary sudo,
    # including commands whose own arguments contain '-S', must remain available.
    r"(?i)(?:echo|printf)\b[^;&|]*\|\s*sudo\b[^;&|]*\s-S(?:\s|$)",
    # Alternate privilege-acquisition paths. Normal sudo remains allowed.
    r"(?i)(?:^|[;&|]\s*)pkexec\b",
    r"(?i)(?:^|[;&|]\s*)su(?:\s|$)",
    r"(?i)(?:^|[;&|]\s*)ssh\b[^;&|]*\broot@(?:localhost|127\.0\.0\.1|\[?::1\]?)\b",
    # Mining interactive shell history is not an acceptable way to obtain auth.
    r"(?i)(?:^|[;&|]\s*)(?:cat|tail|head|grep|rg|sed|awk)\b[^;&|]*(?:\.bash_history|\.zsh_history)\b",
    # High-confidence password-guess loops aimed at sudo/su.
    r"(?is)\bfor\b[^;]*\bin\b[^;]*;\s*do\b[^;]*(?:sudo\b[^;]*-S|\bsu\b)",
]

FULL_UPGRADE_PATTERNS = [
    r"(?i)(?:^|[;&|]\s*)(?:sudo\s+)?pacman\s+-S(?:y|yy)u\b",
    r"(?i)(?:^|[;&|]\s*)(?:sudo\s+)?apt(?:-get)?\s+(?:full-upgrade|dist-upgrade)\b",
    r"(?i)(?:^|[;&|]\s*)(?:sudo\s+)?dnf\s+(?:upgrade|system-upgrade)\b",
    r"(?i)(?:^|[;&|]\s*)(?:sudo\s+)?yum\s+update\b",
    r"(?i)(?:^|[;&|]\s*)(?:sudo\s+)?zypper\s+(?:dup|dist-upgrade)\b",
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

    # AGY PreToolUse payloads do not currently expose a reliable custom-agent
    # name, so Excavator explicitly marks its own shell calls.
    if not command.startswith(MARKER):
        respond("allow")
        return

    body = command[len(MARKER):].strip()
    if not body:
        respond("deny", "Excavator shell command was empty.")
        return

    if any(re.search(pattern, body) for pattern in PRIVILEGE_DRIFT_PATTERNS):
        respond("deny", PRIVILEGE_DRIFT_REASON)
        return

    if any(re.search(pattern, body) for pattern in FULL_UPGRADE_PATTERNS):
        respond("deny", FULL_UPGRADE_REASON)
        return

    respond("allow")


if __name__ == "__main__":
    main()
