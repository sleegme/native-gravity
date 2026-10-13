#!/usr/bin/env python3
"""Read AGY PreToolUse JSON from stdin and emit its allow/deny decision.

The boundary is the explicit NTG_EXCAVATOR marker, not agent identity: the
hook applies only to run_command calls whose command line starts with it.
Anything else - other tools, unmarked commands, payloads without a marked
command string - belongs to other roles and is allowed untouched.

Inside the boundary, two kinds of role drift are refused while ordinary sudo
diagnostics and task-relevant privileged repair stay allowed:

* privilege drift: feeding sudo a password on stdin (including a for-loop that
  guesses passwords), switching user with su or pkexec, root SSH to the local
  host, and reading bash/zsh history files for credentials;
* full-system upgrades used as a troubleshooting step (pacman/yay/paru,
  apt/apt-get, dnf, yum, zypper).

Every simple command of a sequence is inspected, through leading variable
assignments, the env/command/nohup/exec wrappers, sudo, `do` loop bodies,
shell -c programs, and eval. A marked body that is empty or cannot be
tokenized is refused rather than waved through. Denials exit successfully so
AGY receives a policy decision, not a hook failure. This is a behavioral
backstop, not a privilege sandbox.
"""

import json
import re
import sys
from shlex import shlex
from typing import Optional

MARKER = "NTG_EXCAVATOR=1 "
MAX_NESTING = 6

PRIVILEGE_REASON = (
    "Excavator may run sudo for the bounded repair, but missing authorization is "
    "not a puzzle to solve: do not feed or guess passwords, switch users, or mine "
    "shell history. Keep diagnosing with what is available, ask the user to "
    "grant access, or return BLOCKED for the step that needs elevated rights."
)
UPGRADE_REASON = (
    "A full-system upgrade is not a diagnostic step for Excavator. Keep the "
    "user's constraints and apply only the smallest change the evidence supports."
)

SEPARATORS = {";", "&", "&&", "|", "||"}
WRAPPERS = {"command", "nohup", "exec", "do"}
SHELLS = {"bash", "dash", "fish", "ksh", "sh", "zsh"}
HISTORY_TOOLS = {"awk", "cat", "grep", "head", "rg", "sed", "tail"}
HISTORY_NAMES = (".bash_history", ".zsh_history")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]", "[::1", "::1]"}
ASSIGNMENT = re.compile(r"[A-Z_a-z][0-9A-Z_a-z]*=")

# sudo options whose value is the next word unless attached to the letter.
SUDO_VALUE_LETTERS = set("uUghpCDRrtT")
SUDO_VALUE_LONG = {
    "--user", "--other-user", "--group", "--host", "--prompt", "--close-from",
    "--chdir", "--chroot", "--role", "--type", "--command-timeout",
}
# env options whose value is the next word unless attached.
ENV_VALUE_OPTIONS = {"-u", "--unset", "-C", "--chdir"}

APT_UPGRADES = frozenset({"dist-upgrade", "full-upgrade", "upgrade"})
UPGRADE_ACTIONS = {
    "apt": APT_UPGRADES,
    "apt-get": APT_UPGRADES,
    "dnf": frozenset({"system-upgrade", "update", "upgrade"}),
    "yum": frozenset({"update", "upgrade"}),
    "zypper": frozenset({"dist-upgrade", "dup", "up", "update"}),
}
PACMAN_FAMILY = {"pacman", "yay", "paru"}


def program(word: str) -> str:
    return word.split("/")[-1]


def drop_assignments(words: list[str]) -> list[str]:
    while words and ASSIGNMENT.match(words[0]):
        words = words[1:]
    return words


def skip_env_options(words: list[str]) -> list[str]:
    while words:
        option = words[0]
        if option == "--":
            return words[1:]
        if option in ENV_VALUE_OPTIONS:
            words = words[2:]
        elif option.startswith("-") or ASSIGNMENT.match(option):
            words = words[1:]
        else:
            break
    return words


def peel(words: list[str]) -> list[str]:
    words = drop_assignments(words)
    while words:
        name = program(words[0])
        if name in WRAPPERS:
            words = drop_assignments(words[1:])
        elif name == "env":
            words = drop_assignments(skip_env_options(words[1:]))
        else:
            break
    return words


def split_sudo(args: list[str]) -> tuple[bool, list[str]]:
    """Separate sudo's own options from the command it runs.

    Returns whether a password is read from stdin, and the command words.
    Any short-option cluster that contains S counts as a stdin password read.
    """
    stdin_password = False
    index = 0
    while index < len(args):
        word = args[index]
        if word == "--":
            return stdin_password, args[index + 1:]
        if word == "-" or not word.startswith("-"):
            break
        index += 1
        if word.startswith("--"):
            name = word.split("=", 1)[0]
            if name == "--stdin":
                stdin_password = True
            if name in SUDO_VALUE_LONG and "=" not in word:
                index += 1
            continue
        cluster = word[1:]
        if "S" in cluster:
            stdin_password = True
        for position, letter in enumerate(cluster):
            if letter in SUDO_VALUE_LETTERS:
                if position == len(cluster) - 1:
                    index += 1
                break
    return stdin_password, args[index:]


def is_root_local_ssh(args: list[str]) -> bool:
    for arg in args:
        user, at, host = arg.lower().partition("@")
        if at and user == "root" and host in LOCAL_HOSTS:
            return True
    return False


def reads_history(name: str, args: list[str]) -> bool:
    if name not in HISTORY_TOOLS:
        return False
    return any(file in word for word in args for file in HISTORY_NAMES)


def is_full_upgrade(name: str, args: list[str]) -> bool:
    name = name.lower()
    flags = [word.lower() for word in args]
    if name in PACMAN_FAMILY:
        letters = {
            letter for word in flags if word[:1] == "-" and word[:2] != "--"
            for letter in word[1:]
        }
        return "--sysupgrade" in flags or {"s", "u"} <= letters
    actions = UPGRADE_ACTIONS.get(name, frozenset())
    return any(word in actions for word in flags)


def inline_programs(args: list[str]) -> list[str]:
    # Preserve the baseline's literal -c inspection, then locate clustered
    # forms without mistaking option values or positional parameters for code.
    scripts = [
        args[index + 1] for index, word in enumerate(args[:-1]) if word == "-c"
    ]
    wants_program = False
    index = 0
    while index < len(args):
        word = args[index]
        if word in {"--", "-"}:
            index += 1
            break
        if word.startswith("--"):
            index += 2 if word in {"--rcfile", "--init-file"} else 1
            continue
        if len(word) < 2 or word[0] not in {"-", "+"}:
            break
        letters = word[1:]
        if word[0] == "-" and "c" in letters:
            wants_program = True
        index += 1 + letters.count("o") + letters.count("O")
    if wants_program and index < len(args) and args[index] not in scripts:
        scripts.append(args[index])
    return scripts


def loop_guesses_password(body: str) -> bool:
    """Detect `for ... in ...; do <body>` whose body runs su or sudo with -S.

    Matched on raw text, case-insensitively, one loop body up to its next `;`.
    """
    text = body.lower()
    for found in re.finditer(r"\bfor\b", text):
        header, semicolon, rest = text[found.end():].partition(";")
        if not semicolon or not re.search(r"\bin\b", header):
            continue
        opener = re.match(r"\s*do\b", rest)
        if not opener:
            continue
        loop_body = rest[opener.end():].split(";", 1)[0]
        if re.search(r"\bsu\b", loop_body):
            return True
        sudo = re.search(r"sudo\b", loop_body)
        if sudo and "-s" in loop_body[sudo.end():]:
            return True
    return False


def violation_in_command(words: list[str], depth: int) -> Optional[str]:
    if depth > MAX_NESTING:
        return PRIVILEGE_REASON
    words = peel(words)
    if not words:
        return None
    name, args = program(words[0]), words[1:]
    if name == "sudo":
        stdin_password, target = split_sudo(args)
        if stdin_password:
            return PRIVILEGE_REASON
        return violation_in_command(target, depth + 1)
    if name in {"su", "pkexec"}:
        return PRIVILEGE_REASON
    if name == "ssh" and is_root_local_ssh(args):
        return PRIVILEGE_REASON
    if reads_history(name, args):
        return PRIVILEGE_REASON
    if is_full_upgrade(name, args):
        return UPGRADE_REASON
    if name in SHELLS:
        for script in inline_programs(args):
            reason = violation_in_body(script, depth + 1)
            if reason is not None:
                return reason
    if name == "eval":
        return violation_in_body(" ".join(args), depth + 1)
    return None


def violation_in_body(text: str, depth: int = 0) -> Optional[str]:
    if loop_guesses_password(text):
        return PRIVILEGE_REASON
    scanner = shlex(text, posix=True, punctuation_chars=";&|")
    scanner.whitespace_split = True
    scanner.commenters = ""
    try:
        tokens = list(scanner)
    except ValueError:
        return "Excavator shell command could not be parsed for inspection."
    command: list[str] = []
    for token in tokens + [";"]:
        if token in SEPARATORS:
            reason = violation_in_command(command, depth)
            if reason is not None:
                return reason
            command = []
        else:
            command.append(token)
    return None


def decide(payload: object) -> dict[str, str]:
    call = payload.get("toolCall") if isinstance(payload, dict) else None
    if not isinstance(call, dict) or call.get("name") != "run_command":
        return {"decision": "allow"}
    args = call.get("args")
    line = args.get("CommandLine") if isinstance(args, dict) else None
    if not isinstance(line, str) or not line.startswith(MARKER):
        return {"decision": "allow"}
    body = line[len(MARKER):].strip()
    if not body:
        return {"decision": "deny", "reason": "Excavator shell command was empty."}
    reason = violation_in_body(body)
    if reason is not None:
        return {"decision": "deny", "reason": reason}
    return {"decision": "allow"}


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        payload = None
    print(json.dumps(decide(payload)))


if __name__ == "__main__":
    main()
