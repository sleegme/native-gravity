#!/usr/bin/env python3
"""Read AGY PreToolUse JSON from stdin and emit its allow/deny decision.

The role boundary is NTG_ZEN_VERIFY, not every user's shell command. Marked
commands must fit a small read-only grammar. Denials exit successfully so AGY
receives a policy decision, not a hook failure. This is not a general sandbox:
executable resolution and host configuration remain the host's responsibility.
"""

import json
import re
import shlex
import sys


READ_COMMANDS = {
    "cat", "head", "tail", "wc", "ls", "pwd", "stat", "readlink", "realpath",
    "cmp", "od", "sha256sum", "sha512sum", "true", "false", "test", "[",
}
GIT_READ_COMMANDS = {
    "status", "diff", "log", "show", "ls-files", "ls-tree", "rev-parse",
    "rev-list", "show-ref", "cat-file", "describe",
}
SEPARATORS = {";", "|", "&&", "||"}


def read_only_command(words):
    """Recognize a simple command without granting general program execution."""
    if words and words[0] == "env":
        words = words[1:]
    while words and words[0] == "NTG_ZEN_VERIFY=1":
        words = words[1:]
    if not words:
        return False
    command, *args = words
    if command in READ_COMMANDS:
        return True
    if command in {"grep", "rg"}:
        # Search must not launch a preprocessor or hostname helper.
        return not any(arg.startswith(("--pre", "--hostname-bin")) for arg in args)
    if command == "git":
        if args and args[0] == "--no-optional-locks":
            args = args[1:]
        if not args or args[0] not in GIT_READ_COMMANDS:
            return False
        # Enumerate long options: Git's abbreviations must not turn --out into
        # an output write or permit external diff, filters, or text conversion.
        safe_long_options = {
            "--short", "--branch", "--porcelain", "--untracked-files", "--ignored",
            "--stat", "--name-only", "--name-status", "--numstat", "--shortstat",
            "--check", "--cached", "--staged", "--no-ext-diff", "--no-textconv",
            "--exit-code", "--quiet", "--relative", "--binary", "--oneline",
            "--graph", "--decorate", "--no-decorate", "--all", "--pretty",
            "--format", "--abbrev-ref", "--verify", "--show-toplevel", "--",
        }
        return all(
            (arg.split("=", 1)[0] in safe_long_options if arg.startswith("--")
             else not arg.startswith("-o"))
            for arg in args[1:]
        )
    if command in {"node", "python3", "python"}:
        if args in (["--version"], ["-V"]):
            return True
        # Node syntax checking does not run the script. Arbitrary test runners,
        # inline programs, and runtime preload options are not read-only checks.
        return (command == "node" and len(args) == 2 and args[0] == "--check"
                and not args[1].startswith("-"))
    return False


def inspect_command(command):
    if "NTG_ZEN_VERIFY" not in command:
        return {"decision": "allow", "reason": "Outside the Zen-marked boundary"}
    denied = {"decision": "deny", "reason": "Zen permits only read-only verification commands"}
    # Reject expansions, redirects, escaped names, subshells, and comments before
    # lexing. In particular, comments must not conceal a newline-separated effect.
    if any(char in command for char in "<>$`\\(){}#"):
        return denied
    try:
        lexer = shlex.shlex(command.replace("\n", ";"), posix=True,
                            punctuation_chars=";&|")
        lexer.whitespace_split = True
        words = list(lexer)
    except ValueError:
        return denied
    if not words or not re.match(r"^(?:env\s+)?NTG_ZEN_VERIFY=1(?:\s|$)", command.strip()):
        return denied
    simple = []
    for word in words:
        if word in SEPARATORS:
            if not read_only_command(simple):
                return denied
            simple = []
        elif word and all(char in ";&|" for char in word):
            return denied
        else:
            simple.append(word)
    if not read_only_command(simple):
        return denied
    return {"decision": "allow", "reason": "Marked read-only verification command"}


def evaluate(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("toolCall"), dict):
        raise ValueError("Expected AGY toolCall object")
    call = payload["toolCall"]
    if call.get("name") != "run_command":
        return {"decision": "allow", "reason": "Not a shell tool"}
    args = call.get("args")
    if not isinstance(args, dict) or not isinstance(args.get("CommandLine"), str):
        raise ValueError("Expected toolCall.args.CommandLine string")
    return inspect_command(args["CommandLine"])


def main():
    try:
        result = evaluate(json.load(sys.stdin))
    except (ValueError, TypeError) as error:
        result = {"decision": "deny", "reason": "Malformed hook input: " + str(error)}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
