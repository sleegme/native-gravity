#!/usr/bin/env python3
"""Marker-scoped AGY guard, independently authored from NTG's effect contract.

This denies known privilege drift, credential mining and broad upgrades, not
ordinary repair mutations. It is not a sandbox for arbitrary executable files.
"""
import json
import os
import re
import shlex
import sys

MARKER = "NTG_EXCAVATOR=1 "
GUIDANCE = "; continue available diagnostics, ask the user for authorization, or report BLOCKED"
SHELLS = {"sh", "bash", "dash", "zsh", "ksh", "fish"}


def inspect_script(script, depth=0):
    if depth > 16:
        return "Shell nesting exceeds inspection limit"
    lexer = shlex.shlex(script.replace("\n", ";"), posix=True,
                        punctuation_chars=";&|()<>")
    lexer.whitespace_split = True
    lexer.commenters = "#"
    words = list(lexer)
    # Expansions can synthesize executable names; fail closed rather than
    # guessing their runtime value. Literal quoted diagnostic text stays usable.
    if any("`" in word or "$" in word for word in words):
        return "Dynamic shell expansion cannot be inspected reliably"
    segments = []
    current = []
    piped = False
    for word in words:
        if word and all(char in ";&|()<>" for char in word):
            if current:
                segments.append((current, piped or "<" in word))
                current = []
            piped = "|" in word or "<" in word
        else:
            current.append(word)
    if current:
        segments.append((current, piped))
    for command, stdin_supplied in segments:
        reason = inspect_simple(command, stdin_supplied, depth)
        if reason:
            return reason
    return None


def inspect_simple(words, stdin_supplied, depth):
    words = list(words)
    while words:
        name = os.path.basename(words[0])
        if re.match(r"^[A-Za-z_][A-Za-z_0-9]*=", words[0]):
            words.pop(0)
            continue
        if name in {"nohup", "nice", "timeout", "xargs"}:
            words.pop(0)
            value_options = {
                "nohup": set(),
                "nice": {"-n", "--adjustment"},
                "timeout": {"-k", "--kill-after", "-s", "--signal"},
                "xargs": {"-a", "--arg-file", "-d", "--delimiter", "-E",
                          "-I", "-L", "--max-lines", "-n", "--max-args",
                          "-P", "--max-procs", "-s", "--max-chars",
                          "--process-slot-var"},
            }[name]
            flags = {
                "nohup": {"--help", "--version"},
                "nice": {"--help", "--version"},
                "timeout": {"--preserve-status", "--foreground", "-v",
                            "--verbose", "--help", "--version"},
                "xargs": {"-0", "--null", "-r", "--no-run-if-empty", "-t",
                          "--verbose", "-p", "--interactive", "-x", "--exit",
                          "--help", "--version"},
            }[name]
            while words and words[0].startswith("-"):
                option = words.pop(0)
                if option == "--":
                    break
                if option in value_options:
                    if not words:
                        return "Missing wrapper option value"
                    words.pop(0)
                elif option in flags:
                    continue
                elif any(option.startswith(opt + "=") if opt.startswith("--")
                         else option.startswith(opt) and len(option) > len(opt)
                         for opt in value_options):
                    continue
                elif name == "nice" and re.fullmatch(r"-\d+", option):
                    continue
                else:
                    return "Wrapper option cannot be inspected reliably"
            if name == "timeout":
                if not words or not re.fullmatch(r"\d+(?:\.\d+)?[smhd]?", words.pop(0)):
                    return "Missing or malformed timeout duration"
            if not words and name in {"nohup", "timeout"}:
                return "Missing wrapped command"
            continue
        if name in {"command", "builtin", "exec", "env", "sudo"}:
            words.pop(0)
            if name == "sudo" and stdin_supplied:
                return "Piped or redirected sudo input is privilege acquisition"
            while words and words[0].startswith("-") and words[0] != "-":
                option = words.pop(0)
                if name == "sudo":
                    if option == "--stdin" or (not option.startswith("--") and "S" in option):
                        return "Non-interactive sudo password injection is forbidden"
                    if option in {"-u", "-g", "-h", "-p", "-C", "-T", "-R", "-D", "--user", "--group", "--host", "--prompt", "--chroot", "--chdir", "--close-from", "--command-timeout", "--login-class", "--role", "--type", "--other-user"} and words:
                        words.pop(0)
                elif name == "env" and option in {"-u", "--unset", "-C", "--chdir"} and words:
                    words.pop(0)
                elif name == "env" and option in {"-S", "--split-string"}:
                    return inspect_script(" ".join(words), depth + 1)
                if option == "--":
                    break
            continue
        break
    if not words:
        return None
    name, args = os.path.basename(words[0]), words[1:]
    if name in {"su", "pkexec", "doas"}:
        return "Alternate privilege acquisition is forbidden"
    if name in SHELLS:
        for index, arg in enumerate(args):
            if arg.startswith("-") and not arg.startswith("--") and "c" in arg:
                if index + 1 >= len(args):
                    return "Missing shell command body"
                return inspect_script(args[index + 1], depth + 1)
    if name == "eval":
        return inspect_script(" ".join(args), depth + 1)
    if name == "ssh":
        root = any(arg.startswith("root@") for arg in args)
        root = root or any(arg == "-lroot" or arg == "User=root" for arg in args)
        root = root or any(args[i:i + 2] == ["-l", "root"] for i in range(len(args)))
        local = any(arg.removeprefix("root@").strip("[]").lower() in
                    {"localhost", "localhost.localdomain", "127.0.0.1", "::1", "0.0.0.0"}
                    for arg in args)
        if root and local:
            return "Loopback root SSH is privilege acquisition"
    if name in {"cat", "grep", "rg", "head", "tail", "less", "more", "awk", "sed", "strings", "cp"}:
        if any(re.search(r"(?:^|/)(?:\.[^/]*history|[^/]*history[^/]*)$", arg, re.I) for arg in args):
            return "Reading interactive shell history risks credential mining"
    # Redirect-based history reads: `cat < ~/.bash_history` puts the history
    # file as the segment's command name after the '<' separator.
    if stdin_supplied and re.search(r"(?:^|/)(?:\.[^/]*history|[^/]*history[^/]*)$", name, re.I):
        return "Reading interactive shell history risks credential mining"
    if name in {"history", "fc"}:
        return "Interactive shell history is not an authorized credential source"
    if name == "zypper" and "up" in args:
        return "Exploratory full-system upgrades are forbidden"
    if name in {"apt", "apt-get", "yum", "dnf", "dnf5", "zypper"}:
        if any(arg in {"upgrade", "full-upgrade", "dist-upgrade", "system-upgrade", "update", "dup"} for arg in args):
            # apt update refreshes metadata, not the installed system.
            if not (name in {"apt", "apt-get"} and "update" in args and not any(
                    arg in {"upgrade", "full-upgrade", "dist-upgrade"} for arg in args)):
                return "Exploratory full-system upgrades are forbidden"
    if name in {"pacman", "yay", "paru"}:
        if any(arg == "--sysupgrade" or (arg.startswith("-") and not arg.startswith("--") and "u" in arg) for arg in args):
            return "Exploratory full-system upgrades are forbidden"
    return None


def evaluate(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("toolCall"), dict):
        raise ValueError("Expected AGY toolCall object")
    call = payload["toolCall"]
    if not isinstance(call.get("name"), str):
        raise ValueError("Expected tool name")
    if call["name"] != "run_command":
        return {"decision": "allow", "reason": "Not a shell tool"}
    args = call.get("args")
    if not isinstance(args, dict) or not isinstance(args.get("CommandLine"), str):
        raise ValueError("Expected toolCall.args.CommandLine string")
    command = args["CommandLine"]
    if not command.startswith(MARKER):
        return {"decision": "allow", "reason": "Outside the Excavator-marked boundary"}
    script = command[len(MARKER):]
    if not script.strip():
        raise ValueError("Empty marked shell command")
    reason = inspect_script(script)
    if reason:
        return {"decision": "deny", "reason": reason + GUIDANCE}
    return {"decision": "allow", "reason": "No prohibited Excavator effect detected"}


def main():
    try:
        result = evaluate(json.load(sys.stdin))
    except (ValueError, TypeError, RecursionError) as error:
        result = {"decision": "deny", "reason": "Malformed hook input: " + str(error) + GUIDANCE}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
