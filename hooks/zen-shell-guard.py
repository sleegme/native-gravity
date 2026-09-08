#!/usr/bin/env python3
"""Native Gravity - Zen Shell Guard Hook.

Backstop guard for Zen verification shell commands marked with NTG_ZEN_VERIFY=1 .
Permits independent read-only verification commands while denying common intentional
project and state mutation paths.
"""

import json
import re
import shlex
import sys

MARKER = "NTG_ZEN_VERIFY=1 "

SHELL_WRAPPERS = {"sudo", "env", "command", "exec", "nohup"}

MUTATING_FS_COMMANDS = {
    "rm", "mv", "cp", "mkdir", "rmdir", "touch", "chmod", "chown",
    "truncate", "dd", "ln", "install", "unlink", "patch"
}

MUTATING_GIT_SUBCOMMANDS = {
    "add", "commit", "push", "stash", "reset", "restore", "rm", "mv",
    "merge", "rebase", "cherry-pick", "apply", "clean", "tag", "branch",
    "revert", "pull"
}


def contains_redirection(cmd_str: str) -> bool:
    in_quote = None
    i = 0
    while i < len(cmd_str):
        c = cmd_str[i]
        if in_quote:
            if c == in_quote:
                in_quote = None
        else:
            if c == "'" or c == '"':
                in_quote = c
            elif c == ">":
                return True
            elif c in ("1", "2", "&") and i + 1 < len(cmd_str) and cmd_str[i + 1] == ">":
                return True
        i += 1
    return False


def is_mutating_git(tokens: list[str]) -> bool:
    idx = 0
    while idx < len(tokens):
        tok = tokens[idx]
        if tok in {"-C", "-c", "--work-tree", "--git-dir"}:
            idx += 2
            continue
        if tok.startswith("-"):
            idx += 1
            continue
        if tok in MUTATING_GIT_SUBCOMMANDS:
            return True
        break
    return False


def is_mutating_command(tokens: list[str]) -> tuple[bool, str]:
    if not tokens:
        return False, ""

    while tokens and tokens[0] in SHELL_WRAPPERS:
        tokens = tokens[1:]

    if not tokens:
        return False, ""

    cmd = tokens[0]
    args = tokens[1:]

    if cmd == "tee":
        return True, "Direct tee write detected"

    if cmd in MUTATING_FS_COMMANDS:
        return True, f"Filesystem mutation command detected: {cmd}"

    if cmd == "git":
        if is_mutating_git(args):
            return True, "Git state mutation detected"

    if cmd == "sed":
        for a in args:
            if a == "-i" or (a.startswith("-") and "i" in a and not a.startswith("--")):
                return True, "In-place sed edit detected"

    if cmd == "npm" and any(a in {"install", "i", "add", "uninstall", "remove", "update"} for a in args):
        return True, "npm package install/remove detected"

    if cmd == "pip" and any(a in {"install", "uninstall"} for a in args):
        return True, "pip package install/remove detected"

    if cmd == "prettier" and "--write" in args:
        return True, "prettier write mode detected"

    if cmd == "gofmt" and "-w" in args:
        return True, "gofmt write mode detected"

    if cmd in {"python", "python3", "node", "perl", "ruby"}:
        for a in args:
            if "open(" in a and any(m in a for m in ["'w'", '"w"', "'a'", '"a"']):
                return True, "Inline script write detected"
            if "fs.write" in a:
                return True, "Inline script write detected"

    return False, ""


def evaluate_command(cmd_str: str) -> tuple[str, str]:
    trimmed = cmd_str.strip()
    if not trimmed:
        return "deny", "Empty command rejected"

    if contains_redirection(trimmed):
        return "deny", "Output redirection detected"

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
        if t in {"|", "||", ";", "&&", "&"}:
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

        mutating, reason = is_mutating_command(seg)
        if mutating:
            return "deny", reason

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
