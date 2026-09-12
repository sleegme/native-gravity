#!/usr/bin/env python3
"""AGY PreToolUse: stdin {toolCall: {name, args: {CommandLine}}}.

stdout is {decision: allow|deny, reason: string}; a policy denial exits zero so
AGY consumes the documented decision rather than treating it as a hook crash.
Unmarked commands are outside this role-specific guard. Marked commands use a
small read-only grammar, not a blacklist pretending to sandbox arbitrary code.
Executable resolution and machine configuration remain the host sandbox's job.
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
    """Accept one simple command; unknown options with write effects fail closed."""
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
        # rg can execute preprocessors or hostnames via a command option.
        return not any(a.startswith(("--pre", "--hostname-bin")) for a in args)
    if command == "git":
        if args and args[0] == "--no-optional-locks":
            args = args[1:]
        if not args or args[0] not in GIT_READ_COMMANDS:
            return False
        # Git accepts abbreviated long options. An allowlist avoids --out and
        # similar spellings bypassing --output/--filters/--textconv restrictions.
        safe_long_options = {
            "--short", "--branch", "--porcelain", "--untracked-files", "--ignored",
            "--stat", "--name-only", "--name-status", "--numstat", "--shortstat",
            "--check", "--cached", "--staged", "--no-ext-diff", "--no-textconv",
            "--exit-code", "--quiet", "--relative", "--binary", "--oneline",
            "--graph", "--decorate", "--no-decorate", "--all", "--pretty",
            "--format", "--abbrev-ref", "--verify", "--show-toplevel", "--",
        }
        return all(
            (a.split("=", 1)[0] in safe_long_options if a.startswith("--")
             else not a.startswith("-o"))
            for a in args[1:]
        )
    if command in {"node", "python3", "python"}:
        if args in (["--version"], ["-V"]):
            return True
        # Syntax checking does not execute a project script; arbitrary tests and
        # inline programs are deliberately not classified as read-only.
        return (command == "node" and len(args) == 2 and args[0] == "--check"
                and not args[1].startswith("-"))
    return False


def inspect_command(command):
    if "NTG_ZEN_VERIFY" not in command:
        return {"decision": "allow", "reason": "Outside the Zen-marked boundary"}
    denied = {"decision": "deny", "reason": "Zen permits only read-only verification commands"}
    # No expansions, redirects, subshells, process substitution, escaped command
    # names, comments, or shell control constructs. Comments are rejected so
    # newline normalization cannot hide a following command from the parser.
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
