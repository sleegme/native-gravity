#!/usr/bin/env python3
"""Read AGY PreToolUse JSON from stdin and emit its allow/deny decision.

The boundary is the explicit NTG_EXCAVATOR marker, not agent identity: the
hook applies only to run_command calls whose command line starts with it.
Marked commands are inspected for a narrow set of reproduced failure modes —
password piping into sudo, alternate privilege acquisition, shell-history
credential mining, and full-system upgrades — while ordinary sudo diagnostics
and task-relevant privileged repair stay allowed. Commands without the marker
belong to other roles and are returned untouched. Denials exit successfully so
AGY receives a policy decision, not a hook failure. This is a behavioral
backstop, not a privilege sandbox; executable resolution and host
configuration remain the host's responsibility.
"""

import json
import re
import shlex
import sys


MARKER = "NTG_EXCAVATOR=1 "
MAX_WRAPPER_DEPTH = 6

# Password feeders and prompt helpers: sudo must not read credentials from
# stdin or an askpass program during non-interactive troubleshooting.
SUDO_SECRET_FLAGS = {"-S", "--stdin", "-A", "--askpass"}
# sudo option letters that consume the following word (or attached text) as a
# value, so the command word is identified correctly and a downstream "-S"
# stays the invoked command's own flag.
SUDO_VALUE_LETTERS = {"u", "U", "g", "h", "p", "C", "D", "R", "r", "t", "T", "c"}
SUDO_LONG_VALUE_FLAGS = {
    "--user", "--group", "--host", "--runas-group", "--prompt", "--role",
    "--type", "--close-from", "--chdir", "--chroot", "--timeout",
    "--command-timeout",
}

PRIVILEGE_COMMANDS = {"su", "pkexec", "doas", "ksu", "runuser", "newgrp", "sg"}
WRAPPER_COMMANDS = {"command", "builtin", "exec", "nohup"}
SHELL_COMMANDS = {"bash", "sh", "zsh", "dash", "ksh"}

HISTORY_FILE_RE = re.compile(
    r"(^|/)(\.(zsh|bash|sh)_history|\.history|fish_history)$"
)
ROOT_LOCALHOST_RE = re.compile(
    r"^root@(localhost|127\.0\.0\.1|::1|0\.0\.0\.0)$"
)
LOCALHOST_TARGETS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}

PACMAN_LIKE = {"pacman", "yay", "paru", "pikaur", "trizen", "pamac"}
APT_LIKE = {"apt", "apt-get", "aptitude", "nala"}
DNF_LIKE = {"dnf"}
YUM_LIKE = {"yum"}
ZYPPER_LIKE = {"zypper"}

APT_UPGRADE_OPS = {"upgrade", "full-upgrade", "dist-upgrade", "safe-upgrade"}
DNF_UPGRADE_OPS = {"upgrade", "update", "dist-upgrade", "system-upgrade"}
YUM_UPGRADE_OPS = {"update", "upgrade", "localupdate"}
ZYPPER_UPGRADE_OPS = {"dup", "dist-upgrade", "up", "update"}


def deny(reason):
    return {"decision": "deny", "reason": reason}


def sudo_split(args):
    """Split sudo's own leading flags from the command word and its args.

    Returns (password_flag_seen, command_words).
    """
    index = 0
    secret = False
    while index < len(args):
        flag = args[index]
        if not flag.startswith("-") or flag == "-":
            break
        head = flag.split("=", 1)[0]
        if flag.startswith("--"):
            if head in SUDO_SECRET_FLAGS:
                secret = True
            if head in SUDO_LONG_VALUE_FLAGS and "=" not in flag:
                index += 2
                continue
        else:
            letters = flag[1:]
            if any(letter in "SA" for letter in letters):
                secret = True
            if letters and letters[0] in SUDO_VALUE_LETTERS:
                # A value-taking short option: attached text is its value,
                # otherwise the following word is.
                if len(letters) == 1:
                    index += 2
                    continue
        index += 1
    return secret, args[index:]


def history_mining(words):
    return any(HISTORY_FILE_RE.search(word) for word in words)


def root_localhost_ssh(args):
    if any(ROOT_LOCALHOST_RE.match(arg) for arg in args):
        return True
    for index, arg in enumerate(args):
        if arg == "-l" and index + 1 < len(args) and args[index + 1] == "root":
            return any(target in LOCALHOST_TARGETS for target in args[index + 2:])
    return False


def full_system_upgrade(command, args):
    if command in PACMAN_LIKE:
        for arg in args:
            if arg == "--sysupgrade":
                return True
            if arg.startswith("-") and not arg.startswith("--"):
                letters = arg[1:]
                if "u" in letters and ("S" in letters or "y" in letters):
                    return True
        return False
    if command in APT_LIKE:
        return any(arg in APT_UPGRADE_OPS for arg in args)
    if command in DNF_LIKE:
        return any(arg in DNF_UPGRADE_OPS for arg in args)
    if command in YUM_LIKE:
        return any(arg in YUM_UPGRADE_OPS for arg in args)
    if command in ZYPPER_LIKE:
        return any(arg in ZYPPER_UPGRADE_OPS for arg in args)
    return False


def shell_inline_script(command, args):
    """Return the inline program text when a shell runs one via -c."""
    if command not in SHELL_COMMANDS:
        return None
    for index, arg in enumerate(args):
        if arg.startswith("-") and not arg.startswith("--") and "c" in arg[1:]:
            if index + 1 < len(args):
                return args[index + 1]
            return ""
    return None


def strip_wrappers(words):
    while words:
        head = words[0]
        if head in WRAPPER_COMMANDS:
            words = words[1:]
            continue
        if head == "env":
            words = words[1:]
            while words and (words[0].startswith("-") or "=" in words[0]):
                words = words[1:]
            continue
        break
    return words


def check_simple(words, depth):
    """Return a deny decision, or None when the simple command is permitted."""
    if depth > MAX_WRAPPER_DEPTH:
        return deny("Wrapper nesting too deep to inspect")
    if history_mining(words):
        return deny("Shell history must not be mined for credentials")
    words = strip_wrappers(words)
    if not words:
        return None
    command, *args = words
    if command in {"sudo", "sudoedit"}:
        secret, remaining = sudo_split(args)
        if secret:
            return deny("Sudo must not acquire passwords non-interactively")
        return check_simple(remaining, depth + 1) if remaining else None
    if command in PRIVILEGE_COMMANDS:
        return deny("Alternate privilege acquisition is not exploratory repair")
    if command == "ssh" and root_localhost_ssh(args):
        return deny("Root SSH to localhost is not exploratory repair")
    if full_system_upgrade(command, args):
        return deny("Full-system upgrades are not exploratory troubleshooting")
    inline = shell_inline_script(command, args)
    if inline is not None:
        return inspect_body(inline, depth + 1)
    if command == "eval":
        return inspect_body(" ".join(args), depth + 1)
    return None


def inspect_body(body, depth=0):
    try:
        lexer = shlex.shlex(body.replace("\n", ";"), posix=True,
                            punctuation_chars=";&|")
        lexer.whitespace_split = True
        words = list(lexer)
    except ValueError:
        return deny("Command line cannot be parsed for inspection")
    simple = []
    for word in words:
        if word and all(char in ";&|" for char in word):
            verdict = check_simple(simple, depth)
            if verdict:
                return verdict
            simple = []
        else:
            simple.append(word)
    verdict = check_simple(simple, depth)
    if verdict:
        return verdict
    return {"decision": "allow", "reason": "Marked command within Excavator shell boundary"}


def inspect_command(command):
    if not command.startswith(MARKER):
        return {"decision": "allow", "reason": "Outside the Excavator-marked boundary"}
    return inspect_body(command[len(MARKER):])


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
        result = deny("Malformed hook input: " + str(error))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
