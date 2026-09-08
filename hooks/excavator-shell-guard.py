#!/usr/bin/env python3
"""Native Gravity - Excavator Shell Guard Hook.

Backstop guard for Excavator-marked run_command executions (NTG_EXCAVATOR=1 ).
Permits task-relevant sudo commands while preventing privilege-acquisition drift
and broad full-system upgrades.
"""

import json
import re
import shlex
import sys

MARKER = "NTG_EXCAVATOR=1 "
SHELL_WRAPPERS = {"sudo", "env", "command", "exec", "nohup", "xargs"}
SHELL_INTERPRETERS = {"bash", "sh", "zsh"}


def is_full_upgrade(tokens: list[str]) -> bool:
    if not tokens:
        return False
    cmd = tokens[0]
    args = tokens[1:]

    while cmd in SHELL_WRAPPERS and args:
        if cmd == "sudo":
            idx = 0
            while idx < len(args) and args[idx].startswith("-"):
                idx += 1
            if idx < len(args):
                cmd = args[idx]
                args = args[idx + 1:]
            else:
                break
        elif cmd in {"env", "command", "exec", "nohup"}:
            cmd = args[0]
            args = args[1:]
        else:
            break

    if cmd in {"pacman", "yay", "paru"}:
        for a in args:
            if a.startswith("-") and "S" in a and "y" in a and "u" in a:
                return True

    if cmd in {"apt", "apt-get"}:
        for a in args:
            if a in {"upgrade", "full-upgrade", "dist-upgrade"}:
                return True

    if cmd == "dnf":
        for a in args:
            if a in {"upgrade", "system-upgrade"}:
                return True

    if cmd == "yum" and "update" in args:
        return True

    if cmd == "zypper" and "dup" in args:
        return True

    return False


def is_privilege_drift(tokens: list[str]) -> bool:
    if not tokens:
        return False

    for t in tokens:
        if ".bash_history" in t or ".zsh_history" in t:
            return True

    cmd = tokens[0]
    args = tokens[1:]

    while cmd in {"env", "command", "exec", "nohup"} and args:
        cmd = args[0]
        args = args[1:]

    if cmd in {"su", "pkexec"}:
        return True

    if cmd == "ssh":
        for a in args:
            if a in {"root@localhost", "root@127.0.0.1"}:
                return True

    if cmd == "sudo":
        idx = 0
        while idx < len(args):
            arg = args[idx]
            if arg == "--":
                idx += 1
                break
            if not arg.startswith("-"):
                break
            if "S" in arg:
                return True
            idx += 1

        if idx < len(args):
            sub_cmd = args[idx]
            sub_args = args[idx + 1:]
            if sub_cmd == "su":
                return True
            if is_privilege_drift([sub_cmd] + sub_args):
                return True

    return False


def evaluate_command(cmd_str: str) -> tuple[str, str]:
    trimmed = cmd_str.strip()
    if not trimmed:
        return "deny", "Empty command rejected"

    try:
        lexer = shlex.shlex(trimmed, posix=True, punctuation_chars="|;&")
        lexer.whitespace_split = True
        raw_tokens = list(lexer)
    except Exception as e:
        return "deny", f"Command parsing error: {e}"

    if not raw_tokens:
        return "deny", "No executable tokens found"

    pipeline_segments: list[list[str]] = []
    curr_segment: list[str] = []
    for t in raw_tokens:
        if t in {"|", "||", ";", "&&", "&", "\n"}:
            if curr_segment:
                pipeline_segments.append(curr_segment)
                curr_segment = []
        else:
            curr_segment.append(t)
    if curr_segment:
        pipeline_segments.append(curr_segment)

    for seg in pipeline_segments:
        if not seg:
            continue

        for i, tok in enumerate(seg):
            if tok in SHELL_INTERPRETERS and i + 1 < len(seg):
                sub_flag = seg[i + 1]
                if "-c" in sub_flag and i + 2 < len(seg):
                    sub_str = seg[i + 2]
                    sub_dec, sub_reason = evaluate_command(sub_str)
                    if sub_dec == "deny":
                        return sub_dec, sub_reason

        if is_full_upgrade(seg):
            return "deny", f"Exploratory system upgrade denied: {' '.join(seg)}"

        if is_privilege_drift(seg):
            return "deny", f"Privilege acquisition drift denied: {' '.join(seg)}"

    return "allow", ""


def main() -> None:
    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            print(json.dumps({"decision": "allow"}))
            return
        event = json.loads(raw_input)
    except Exception:
        print(json.dumps({"decision": "allow"}))
        return

    tool_call = event.get("toolCall", {})
    if tool_call.get("name") != "run_command":
        print(json.dumps({"decision": "allow"}))
        return

    args = tool_call.get("args", {})
    command_line = args.get("CommandLine", "")

    if not command_line.startswith(MARKER):
        print(json.dumps({"decision": "allow"}))
        return

    stripped_cmd = command_line[len(MARKER):]
    decision, reason = evaluate_command(stripped_cmd)
    res = {"decision": decision}
    if reason:
        res["reason"] = reason
    print(json.dumps(res))


if __name__ == "__main__":
    main()
