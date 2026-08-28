#!/usr/bin/env python3
"""Role-scoped behavioral backstop for Excavator shell calls.

Excavator may use sudo and mutate when the bounded repair needs it. This hook is
not a privilege sandbox; it blocks reproduced role drift: acquiring privilege
after authorization is unavailable and broad system upgrades used as diagnosis.
"""

import json
import re
import shlex
import sys

MARKER = "NTG_EXCAVATOR=1 "
PRIVILEGE = "privilege"
FULL_UPGRADE = "full-upgrade"

REASONS = {
    PRIVILEGE: (
        "Excavator may use sudo for task-relevant work, but it must not turn missing "
        "authorization into a credential-discovery or privilege-acquisition task. "
        "Continue with available diagnostics, ask the user to provide authorization, "
        "or report the privileged step as BLOCKED."
    ),
    FULL_UPGRADE: (
        "Excavator must not use a full-system upgrade as an exploratory troubleshooting "
        "step. Preserve the user's constraints and make the smallest evidence-backed "
        "change needed for the bounded problem."
    ),
}

CONTROL = {";", "&&", "||", "|", "&"}
WRAPPERS = {"command", "nohup"}
SHELLS = {"sh", "bash", "dash", "zsh", "fish"}
HISTORY_READERS = {"cat", "tail", "head", "grep", "rg", "sed", "awk"}
SUDO_VALUE_OPTIONS = {
    "-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt",
    "-C", "--close-from", "-T", "--command-timeout", "-R", "--chroot",
    "-D", "--chdir",
}
PASSWORD_GUESS_LOOP = re.compile(
    r"(?is)\bfor\b[^;]*\bin\b[^;]*;\s*do\b[^;]*(?:sudo\b[^;]*-S|\bsu\b)"
)


def basename(token: str) -> str:
    return token.rsplit("/", 1)[-1]


def respond(decision: str, reason: str | None = None) -> None:
    payload = {"decision": decision}
    if reason:
        payload["reason"] = reason
    print(json.dumps(payload))


def shell_commands(body: str) -> list[list[str]]:
    lexer = shlex.shlex(body, posix=True, punctuation_chars=";&|")
    lexer.whitespace_split = True
    lexer.commenters = ""
    commands, current = [], []
    for token in lexer:
        if token in CONTROL:
            if current:
                commands.append(current)
                current = []
        else:
            current.append(token)
    if current:
        commands.append(current)
    return commands


def strip_assignments(tokens: list[str]) -> list[str]:
    while tokens and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", tokens[0]):
        tokens = tokens[1:]
    return tokens


def unwrap(tokens: list[str]) -> list[str]:
    tokens = strip_assignments(tokens)
    while tokens:
        executable = basename(tokens[0])
        if executable in WRAPPERS:
            tokens = strip_assignments(tokens[1:])
            continue
        if executable != "env":
            return tokens

        index = 1
        while index < len(tokens):
            token = tokens[index]
            if token == "--":
                index += 1
                break
            if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", token):
                index += 1
                continue
            if token in {"-i", "--ignore-environment", "-0", "--null"}:
                index += 1
                continue
            if token in {"-u", "--unset", "-C", "--chdir"}:
                index += 2
                continue
            if (
                token.startswith("--unset=")
                or token.startswith("--chdir=")
                or (token.startswith("-u") and token != "-u")
                or (token.startswith("-C") and token != "-C")
            ):
                index += 1
                continue
            if token.startswith("-"):
                return tokens
            break
        tokens = strip_assignments(tokens[index:])
    return tokens


def sudo_target(tokens: list[str]) -> tuple[bool, list[str]]:
    """Return whether sudo reads a password from stdin, plus its target command."""
    index = 1
    stdin_password = False
    while index < len(tokens):
        token = tokens[index]
        if token == "--":
            return stdin_password, tokens[index + 1:]
        if token in {"-S", "--stdin"}:
            stdin_password = True
            index += 1
            continue
        if token.startswith("--"):
            if token in SUDO_VALUE_OPTIONS and "=" not in token:
                index += 2
            else:
                index += 1
            continue
        if token.startswith("-") and token != "-":
            if "S" in token[1:]:
                stdin_password = True
            index += 2 if token in SUDO_VALUE_OPTIONS else 1
            continue
        break
    return stdin_password, tokens[index:]


def is_full_upgrade(executable: str, args: list[str]) -> bool:
    name = basename(executable).lower()
    lowered = [arg.lower() for arg in args]

    if name in {"pacman", "yay", "paru"}:
        short_flags = "".join(
            arg[1:] for arg in lowered
            if arg.startswith("-") and not arg.startswith("--")
        )
        return ("s" in short_flags and "u" in short_flags) or "--sysupgrade" in lowered

    actions = {
        "apt": {"upgrade", "full-upgrade", "dist-upgrade"},
        "apt-get": {"upgrade", "full-upgrade", "dist-upgrade"},
        "dnf": {"upgrade", "update", "system-upgrade"},
        "yum": {"upgrade", "update"},
        "zypper": {"dup", "dist-upgrade", "update", "up"},
    }
    return name in actions and any(arg in actions[name] for arg in lowered)


def classify_command(tokens: list[str], depth: int = 0) -> str | None:
    if depth > 2:
        return None

    tokens = unwrap(tokens)
    if not tokens:
        return None

    executable = basename(tokens[0])
    args = tokens[1:]

    if executable == "sudo":
        stdin_password, target = sudo_target(tokens)
        if stdin_password:
            return PRIVILEGE
        return classify_command(target, depth + 1)

    if executable in {"su", "pkexec"}:
        return PRIVILEGE

    if executable == "ssh" and any(
        re.fullmatch(r"root@(?:localhost|127\.0\.0\.1|\[?::1\]?)", arg, re.IGNORECASE)
        for arg in args
    ):
        return PRIVILEGE

    if executable in HISTORY_READERS and any(
        history in arg for arg in args for history in (".bash_history", ".zsh_history")
    ):
        return PRIVILEGE

    if is_full_upgrade(executable, args):
        return FULL_UPGRADE

    if executable in SHELLS:
        for index, arg in enumerate(args):
            if arg == "-c" and index + 1 < len(args):
                return classify_shell(args[index + 1], depth + 1)

    return None


def classify_shell(body: str, depth: int = 0) -> str | None:
    if PASSWORD_GUESS_LOOP.search(body):
        return PRIVILEGE
    try:
        commands = shell_commands(body)
    except ValueError:
        return None
    for command in commands:
        result = classify_command(command, depth)
        if result:
            return result
    return None


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except Exception:
        respond("allow")
        return

    tool_call = event.get("toolCall") or {}
    args = tool_call.get("args") or {}
    command = str(args.get("CommandLine") or "")

    if tool_call.get("name") != "run_command" or not command.startswith(MARKER):
        respond("allow")
        return

    body = command[len(MARKER):].strip()
    if not body:
        respond("deny", "Excavator shell command was empty.")
        return

    violation = classify_shell(body)
    if violation:
        respond("deny", REASONS[violation])
        return

    respond("allow")


if __name__ == "__main__":
    main()
