#!/usr/bin/env python3
"""Universal NTG 2.0 Mutation Safety Guard (AGY PreToolUse hook).

Enforces safety boundaries unconditionally across BOTH `run_command` AND
file-mutation tools (`write_to_file`, `replace_file_content`,
`multi_replace_file_content`, `write_file`, `edit_file`) with zero
model-controlled bypass markers or shell exceptions:

1. Protected-path mutation invariant: unconditionally deny direct writes,
   edits, replacements, truncations, moves, or deletes targeting
   `.ntg/ledger.json`, `.ntg/ledger.json.lock`, `.ntg/lightweight-runs.jsonl`,
   `hooks.json`, `hooks/*.py`, or `plugin.json`. Only internal host-process
   APIs (LedgerKernel, LightweightLog, v1-compat) mutate protected paths.
2. Role-mutation authority invariant: deny file-mutation tools and mutating
   shell commands when runner-injected `NTG_ACTIVE_ROLE` is a non-mutating /
   READ_ONLY role (`zen`, `strix-halo`, `jaguar`, `piledriver`, `instinct`).
3. Privilege-escalation & credential-bypass prevention: deny stdin/piped
   password injection (`sudo -S`), password-guessing loops, `su`, `pkexec`,
   localhost root SSH, and shell-history credential mining.
4. Unauthorized persistent/destructive effect prevention: deny exploratory
   full-system upgrades and destructive host/repo mutations.
5. Environment & marker anti-spoofing: deny commands attempting to unset or
   override `NTG_ACTIVE_ROLE`, `NTG_SUPERVISOR_PID`, or `SKIP_LIVE_TESTS`.
"""

import json
import os
import posixpath
import re
import sys
from shlex import shlex
from typing import Any, Optional

FILE_MUTATION_TOOLS = frozenset({
    "write_to_file",
    "replace_file_content",
    "multi_replace_file_content",
    "write_file",
    "edit_file",
})

READ_ONLY_NON_SHELL_ROLES = frozenset({
    "piledriver",
    "instinct",
    "jaguar",
    "strix-halo",
    "strix_halo",
})
READ_ONLY_ROLES = READ_ONLY_NON_SHELL_ROLES | frozenset({"zen"})

SEPARATORS = {";", "&", "&&", "|", "||"}
WRAPPERS = {"command", "nohup", "exec", "do", "time"}
SHELLS = {"bash", "dash", "fish", "ksh", "sh", "zsh"}
HISTORY_TOOLS = {"awk", "cat", "grep", "head", "less", "more", "rg", "sed", "tail"}
HISTORY_NAMES = (".bash_history", ".zsh_history")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]", "[::1"}

PROTECTED_EXACT_NAMES = frozenset({"hooks.json", "plugin.json"})
PROTECTED_NTG_FILES = frozenset({
    ".ntg/ledger.json",
    ".ntg/ledger.json.lock",
    ".ntg/lightweight-runs.jsonl",
})
PROTECTED_BASENAMES = frozenset({
    "ledger.json",
    "ledger.json.lock",
    "lightweight-runs.jsonl",
    "hooks.json",
    "plugin.json",
})
PROTECTED_REGEX = re.compile(
    r"(?:^|[\s'\"=/\\])(?:\./)?"
    r"(?:[A-Za-z0-9_.\-]+/)*("
    r"\.ntg/ledger\.json(?:\.lock)?"
    r"|\.ntg/lightweight-runs\.jsonl"
    r"|hooks\.json"
    r"|plugin\.json"
    r"|hooks/[A-Za-z0-9_.\-*/]+"
    r"|hooks/?"
    r")(?=$|[\s'\",:;)])"
)

MUTATING_SHELL_COMMANDS = frozenset({
    "rm", "rmdir", "unlink", "mv", "cp", "dd", "truncate", "touch",
    "chmod", "chown", "chgrp", "ln", "install", "tee", "patch",
})
INLINE_EXEC_COMMANDS = frozenset({"python", "python3", "node", "perl", "ruby", "eval"})
INLINE_MUTATION_HINT = re.compile(
    r"(?:open\s*\([^)]*['\"](?:w|a|x|r\+)|writeFileSync|appendFileSync|unlinkSync|rmSync|renameSync|chmodSync|os\.remove|os\.unlink|os\.rename|shutil\.|Path\([^)]*\)\.(?:write_text|write_bytes|unlink|rename)|>)"
)

ASSIGNMENT = re.compile(r"([A-Za-z_][0-9A-Za-z_]*)=(.*)")
SUDO_VALUE_LETTERS = set("uUghpCDRrtT")
SUDO_VALUE_LONG = {
    "--user", "--other-user", "--group", "--host", "--prompt", "--close-from",
    "--chdir", "--chroot", "--role", "--type", "--command-timeout",
}
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

PROTECTED_ENV_VARS = frozenset({"NTG_ACTIVE_ROLE", "NTG_SUPERVISOR_PID"})
PRIVILEGE_REASON = (
    "Denied by universal safety guard: password injection, user switching, "
    "localhost root SSH, and shell-history credential mining are forbidden."
)
UPGRADE_REASON = (
    "Denied by universal safety guard: exploratory full-system upgrades are forbidden."
)
DESTRUCTIVE_REASON = (
    "Denied by universal safety guard: unauthorized destructive host/repository mutation is forbidden."
)
PROTECTED_PATH_REASON = (
    "Denied by universal safety guard: direct model-facing mutations to authoritative "
    "state or safety configuration (.ntg/ledger.json, .ntg/ledger.json.lock, "
    ".ntg/lightweight-runs.jsonl, hooks.json, hooks/*.py, plugin.json) are forbidden."
)
SPOOF_REASON = (
    "Denied by universal safety guard: unsetting or overriding NTG_ACTIVE_ROLE, "
    "NTG_SUPERVISOR_PID, or SKIP_LIVE_TESTS is forbidden."
)


def program(word: str) -> str:
    return word.split("/")[-1]


def normalize_rel_path(raw_path: str) -> str:
    cleaned = raw_path.strip().replace("\\", "/")
    if cleaned.startswith("./"):
        cleaned = cleaned[2:]
    return posixpath.normpath(cleaned)


def is_protected_path(raw_path: str) -> bool:
    if not isinstance(raw_path, str) or not raw_path.strip():
        return False
    norm = normalize_rel_path(raw_path)
    parts = [p for p in norm.split("/") if p and p != "."]
    if not parts:
        return False

    # Exact repository-relative protected files or suffix matches
    for suffix in PROTECTED_NTG_FILES:
        if norm == suffix or norm.endswith("/" + suffix):
            return True
    if norm in PROTECTED_EXACT_NAMES or parts[-1] in PROTECTED_EXACT_NAMES:
        return True
    if parts[-1] in {"ledger.json", "ledger.json.lock", "lightweight-runs.jsonl"} and (
        len(parts) == 1 or parts[-2] == ".ntg"
    ):
        return True
    # Any path inside a `hooks` directory (e.g. hooks/*.py, hooks/__init__.py)
    if "hooks" in parts[:-1]:
        return True
    if parts[-1] == "hooks" and len(parts) >= 1:
        return True
    return False


def extract_paths_from_args(value: Any) -> list[str]:
    paths: list[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            kl = str(k).lower()
            if isinstance(v, str) and kl in {
                "targetfile", "target_file", "path", "file_path",
                "filepath", "destination", "dest", "target", "file",
            }:
                paths.append(v)
            elif isinstance(v, (dict, list)):
                paths.extend(extract_paths_from_args(v))
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, str):
                paths.append(item)
            elif isinstance(item, (dict, list)):
                paths.extend(extract_paths_from_args(item))
    return paths


def check_env_spoofing(command: str, words: list[str]) -> Optional[str]:
    # Inspect raw assignment / export / unset / env -u attempts
    for m in re.finditer(r"(?:^|[;&|\s])(?:export\s+|env\s+)?([A-Za-z_][0-9A-Za-z_]*)\s*=\s*([^\s;&|]*)", command):
        var, val = m.group(1), m.group(2).strip("'\"")
        if var in PROTECTED_ENV_VARS:
            return SPOOF_REASON
        if var == "SKIP_LIVE_TESTS" and val != "1":
            return SPOOF_REASON
    for m in re.finditer(r"\bunset\s+([^\n;&|]+)", command):
        targets = m.group(1).split()
        if any(t in PROTECTED_ENV_VARS or t == "SKIP_LIVE_TESTS" for t in targets):
            return SPOOF_REASON
    for i, w in enumerate(words):
        if program(w) == "env":
            j = i + 1
            while j < len(words):
                opt = words[j]
                if opt in {"-u", "--unset"} and j + 1 < len(words):
                    if words[j + 1] in PROTECTED_ENV_VARS or words[j + 1] == "SKIP_LIVE_TESTS":
                        return SPOOF_REASON
                    j += 2
                    continue
                if opt.startswith("--unset="):
                    target = opt.split("=", 1)[1]
                    if target in PROTECTED_ENV_VARS or target == "SKIP_LIVE_TESTS":
                        return SPOOF_REASON
                if opt.startswith("-u") and len(opt) > 2:
                    target = opt[2:]
                    if target in PROTECTED_ENV_VARS or target == "SKIP_LIVE_TESTS":
                        return SPOOF_REASON
                j += 1
    return None


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


def words_touch_protected_path(args: list[str]) -> bool:
    for arg in args:
        if is_protected_path(arg):
            return True
        if PROTECTED_REGEX.search(arg):
            return True
    return False


def is_destructive_command(name: str, args: list[str]) -> bool:
    if name == "rm":
        flags = "".join(a for a in args if a.startswith("-"))
        recursive = "r" in flags or "R" in flags or "--recursive" in args
        for arg in args:
            if arg.startswith("-"):
                continue
            norm = normalize_rel_path(arg)
            if recursive and norm in {"/", "/*", "~", "~/", ".", "..", ".git", ".ntg"}:
                return True
            if norm == ".git" or norm.startswith(".git/"):
                return True
    if name == "git" and args:
        sub = args[0]
        if sub == "reset" and "--hard" in args:
            return True
        if sub == "clean" and any(a.startswith("-") and ("f" in a or "d" in a) for a in args[1:]):
            return True
        if sub == "push" and any(a in {"-f", "--force"} or a.startswith("--force-with-lease") for a in args[1:]):
            return True
    return False


def check_redirect_to_protected_path(text: str) -> bool:
    for match in re.finditer(r"(?:>>?|>\||2>>?)\s*([^\s;&|]+)", text):
        target = match.group(1).strip("'\"")
        if is_protected_path(target) or PROTECTED_REGEX.search(target):
            return True
    return False


def command_mutates_protected_path(name: str, args: list[str]) -> bool:
    if name in MUTATING_SHELL_COMMANDS and words_touch_protected_path(args):
        return True
    if name in {"sed", "perl"}:
        in_place = any(a == "-i" or a.startswith("-i") or a == "--in-place" or a.startswith("--in-place=") for a in args)
        if in_place and words_touch_protected_path(args):
            return True
    if name == "git" and args:
        sub = args[0]
        if sub in {"checkout", "restore", "reset", "clean", "rm", "mv", "commit", "apply"} and words_touch_protected_path(args[1:]):
            return True
    if name in INLINE_EXEC_COMMANDS:
        joined = " ".join(args)
        is_inline_code = (
            name == "eval"
            or any(a in {"-c", "-e"} for a in args)
            or name in {"python", "python3"} and any(a.startswith("-c") for a in args)
        )
        if is_inline_code and words_touch_protected_path(args) and INLINE_MUTATION_HINT.search(joined):
            return True
    return False


def violation_in_command(words: list[str], depth: int) -> Optional[str]:
    if depth > 6:
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

    if is_destructive_command(name, args):
        return DESTRUCTIVE_REASON

    if command_mutates_protected_path(name, args):
        return PROTECTED_PATH_REASON

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
    if check_redirect_to_protected_path(text):
        return PROTECTED_PATH_REASON
    scanner = shlex(text, posix=True, punctuation_chars=";&|")
    scanner.whitespace_split = True
    scanner.commenters = ""
    try:
        tokens = list(scanner)
    except ValueError:
        return "Denied by universal safety guard: shell command could not be parsed for inspection."

    spoof = check_env_spoofing(text, tokens)
    if spoof is not None:
        return spoof

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


def check_zen_readonly_shell(command: str) -> Optional[str]:
    """When NTG_ACTIVE_ROLE=zen, defer strict read-only command grammar check."""
    try:
        import importlib.util
        zen_path = posixpath.join(posixpath.dirname(__file__.replace("\\", "/")), "zen-shell-guard.py")
        spec = importlib.util.spec_from_file_location("zen_shell_guard", zen_path)
        if spec and spec.loader:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            verdict = mod.inspect_command(command)
            if verdict.get("decision") != "allow":
                return verdict.get("reason") or "Zen permits only read-only verification commands"
            return None
    except Exception as err:
        return f"Zen verification boundary check failed: {err}"
    return "Zen verification boundary unavailable"


def evaluate(payload: object, env: Optional[dict[str, str]] = None) -> dict[str, str]:
    active_env = env if env is not None else os.environ
    active_role = str(active_env.get("NTG_ACTIVE_ROLE", "")).strip().lower()

    if not isinstance(payload, dict) or not isinstance(payload.get("toolCall"), dict):
        return {"decision": "deny", "reason": "Malformed hook input: Expected AGY toolCall object"}

    call = payload["toolCall"]
    tool_name = call.get("name")
    args = call.get("args")

    if tool_name in FILE_MUTATION_TOOLS:
        if active_role in READ_ONLY_ROLES:
            return {
                "decision": "deny",
                "reason": f"Role '{active_role}' is non-mutating and cannot invoke '{tool_name}'.",
            }
        if not isinstance(args, dict):
            return {"decision": "deny", "reason": f"Malformed '{tool_name}' args"}
        paths = extract_paths_from_args(args)
        if not paths:
            return {"decision": "deny", "reason": f"Missing target file path for '{tool_name}'"}
        for p in paths:
            if is_protected_path(p):
                return {"decision": "deny", "reason": PROTECTED_PATH_REASON}
        return {"decision": "allow", "reason": "File mutation outside protected paths"}

    if tool_name != "run_command":
        return {"decision": "allow", "reason": "Not a guarded mutation or shell tool"}

    command = None
    if isinstance(args, dict):
        command = args.get("CommandLine") if "CommandLine" in args else args.get("command")
    if not isinstance(command, str) or not command.strip():
        return {"decision": "deny", "reason": "Expected non-empty CommandLine string"}

    if active_role in READ_ONLY_NON_SHELL_ROLES:
        return {
            "decision": "deny",
            "reason": f"Role '{active_role}' has no shell execution permission.",
        }

    reason = violation_in_body(command)
    if reason is not None:
        return {"decision": "deny", "reason": reason}

    if active_role == "zen":
        zen_reason = check_zen_readonly_shell(command)
        if zen_reason is not None:
            return {"decision": "deny", "reason": zen_reason}

    return {"decision": "allow", "reason": "Command passed universal safety guard"}


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except ValueError as err:
        print(json.dumps({"decision": "deny", "reason": f"Malformed hook input: {err}"}))
        return
    print(json.dumps(evaluate(payload)))


if __name__ == "__main__":
    main()
