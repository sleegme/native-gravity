#!/usr/bin/env python3
"""Read AGY PreToolUse JSON from stdin and emit its allow/deny decision.

Enforces Zen's non-mutating verification boundary (#201 A4):
- Active whenever runner-injected `NTG_ACTIVE_ROLE=zen` is set in the
  environment (across BOTH `run_command` and file-mutation tools), OR when
  `NTG_ZEN_VERIFY` is present in the command line.
- Marked or Zen-role shell commands must fit the small read-only verification
  grammar. File-mutation tools are unconditionally denied for `zen`.
"""

import json
import os
import re
import shlex
import sys
from typing import Optional

FILE_MUTATION_TOOLS = frozenset({
    "write_to_file",
    "replace_file_content",
    "multi_replace_file_content",
    "write_file",
    "edit_file",
})

READ_COMMANDS = {
    "cat", "head", "tail", "wc", "ls", "pwd", "stat", "readlink", "realpath",
    "cmp", "od", "sha256sum", "sha512sum", "true", "false", "test", "[",
}
GIT_READ_COMMANDS = {
    "status", "diff", "log", "show", "ls-files", "ls-tree", "rev-parse",
    "rev-list", "show-ref", "cat-file", "describe", "branch",
}
SEPARATORS = {";", "|", "&&", "||"}
TEST_FILE = re.compile(
    r"(?:[A-Za-z0-9_.-]+/)*tests?/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.(?:mjs|js|ts|mts)"
)
TEST_PY_FILE = re.compile(
    r"(?:[A-Za-z0-9_.-]+/)*tests?/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.py"
)
SUITE_GLOB = re.compile(r"tests?/\*\.(?:mjs|js|ts|mts)")


def is_named_test_file(path):
    """Named test-directory file only: glob metacharacters cannot stand in for it."""
    if not TEST_FILE.fullmatch(path):
        return False
    return ".." not in path


def is_named_py_test_file(path):
    """Named Python test file under tests/ or test/ only."""
    if not TEST_PY_FILE.fullmatch(path):
        return False
    return ".." not in path


def reads_only_test_files(args):
    """`node --test <path>...` is read-only only over named test files."""
    if len(args) < 2 or args[0] != "--test":
        return False
    return all(is_named_test_file(arg) or SUITE_GLOB.fullmatch(arg) for arg in args[1:])


def reads_only_py_unittest(args):
    """`python3 -m unittest` over named repository test files only."""
    if len(args) < 3 or args[0] != "-m" or args[1] != "unittest":
        return False
    rest = [arg for arg in args[2:] if arg not in {"-v", "--verbose"}]
    if not rest:
        return False
    return all(is_named_py_test_file(arg) for arg in rest)


def read_only_command(words):
    """Recognize a simple command without granting general program execution."""
    if words and words[0] == "env":
        words = words[1:]
    while words and words[0] in {"NTG_ZEN_VERIFY=1", "SKIP_LIVE_TESTS=1"}:
        words = words[1:]
    if not words:
        return False
    command, *args = words
    if command in READ_COMMANDS:
        return True
    if command in {"grep", "rg"}:
        return not any(arg.startswith(("--pre", "--hostname-bin")) for arg in args)
    if command == "git":
        if args and args[0] == "--no-optional-locks":
            args = args[1:]
        if not args or args[0] not in GIT_READ_COMMANDS:
            return False
        if args[0] == "branch":
            safe_long_options = {"--list", "--show-current", "--sort"}
            return all(
                (arg.split("=", 1)[0] in safe_long_options if arg.startswith("--")
                 else arg in {"-v", "-vv", "-a", "-r"} if arg.startswith("-")
                 else "--list" in args[1:] or args[index - 1] == "--sort")
                for index, arg in enumerate(args[1:], start=1)
            )
        safe_long_options = {
            "--short", "--branch", "--porcelain", "--untracked-files", "--ignored",
            "--stat", "--name-only", "--name-status", "--numstat", "--shortstat",
            "--check", "--cached", "--staged", "--no-ext-diff", "--no-textconv",
            "--exit-code", "--quiet", "--relative", "--binary", "--oneline",
            "--graph", "--decorate", "--no-decorate", "--all", "--pretty",
            "--format", "--abbrev-ref", "--verify", "--show-toplevel", "--",
        }
        if args[0] == "ls-files":
            safe_long_options.update({"--others", "--exclude-standard"})
        return all(
            (arg.split("=", 1)[0] in safe_long_options if arg.startswith("--")
             else not arg.startswith("-o") or (args[0] == "ls-files" and arg == "-o"))
            for arg in args[1:]
        )
    if command == "bunx":
        return (
            len(args) >= 3
            and args[:2] == ["vitest", "run"]
            and all(is_named_test_file(arg) for arg in args[2:])
        )
    if command in {"node", "python3", "python"}:
        if args in (["--version"], ["-V"]):
            return True
        if command == "node" and len(args) == 2 and args[0] == "--check" and not args[1].startswith("-"):
            return True
        if command == "node":
            return reads_only_test_files(args)
        return reads_only_py_unittest(args)
    return False


def inspect_command(command, env: Optional[dict[str, str]] = None):
    active_env = env if env is not None else os.environ
    active_role = str(active_env.get("NTG_ACTIVE_ROLE", "")).strip().lower()
    zen_env_scoped = active_role == "zen"
    has_marker = "NTG_ZEN_VERIFY" in command

    if not zen_env_scoped and not has_marker:
        return {"decision": "allow", "reason": "Outside the Zen boundary"}

    denied = {"decision": "deny", "reason": "Zen permits only read-only verification commands"}
    if any(char in command for char in "<>$`\\(){}#"):
        return denied
    try:
        lexer = shlex.shlex(command.replace("\n", ";"), posix=True,
                            punctuation_chars=";&|")
        lexer.whitespace_split = True
        words = list(lexer)
    except ValueError:
        return denied

    if not words:
        return denied
    # Reject attempts to disable NTG_ZEN_VERIFY or override NTG_ACTIVE_ROLE
    if re.search(r"(?:^|\s)(?:NTG_ACTIVE_ROLE|NTG_SUPERVISOR_PID)\s*=", command):
        return denied
    if not zen_env_scoped and not re.match(r"^(?:env\s+)?NTG_ZEN_VERIFY=1(?:\s|$)", command.strip()):
        return denied
    if has_marker and not re.match(r"^(?:env\s+)?NTG_ZEN_VERIFY=1(?:\s|$)", command.strip()):
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
    return {"decision": "allow", "reason": "Read-only Zen verification command"}


def evaluate(payload, env: Optional[dict[str, str]] = None):
    active_env = env if env is not None else os.environ
    active_role = str(active_env.get("NTG_ACTIVE_ROLE", "")).strip().lower()
    zen_env_scoped = active_role == "zen"

    if not isinstance(payload, dict) or not isinstance(payload.get("toolCall"), dict):
        raise ValueError("Expected AGY toolCall object")
    call = payload["toolCall"]
    tool_name = call.get("name")

    if tool_name in FILE_MUTATION_TOOLS:
        if zen_env_scoped:
            return {"decision": "deny", "reason": "Zen is non-mutating and cannot invoke file-mutation tools"}
        return {"decision": "allow", "reason": "Not inside Zen file-mutation boundary"}

    if tool_name != "run_command":
        return {"decision": "allow", "reason": "Not a shell or file-mutation tool"}
    args = call.get("args")
    if not isinstance(args, dict) or not isinstance(args.get("CommandLine"), str):
        raise ValueError("Expected toolCall.args.CommandLine string")
    return inspect_command(args["CommandLine"], env=active_env)


def main():
    try:
        result = evaluate(json.load(sys.stdin))
    except (ValueError, TypeError) as error:
        result = {"decision": "deny", "reason": "Malformed hook input: " + str(error)}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
