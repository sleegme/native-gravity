#!/usr/bin/env python3
"""Read AGY PreToolUse JSON from stdin and emit its allow/deny decision.

The process marker enables the guard, not native-worker identity. SessionStart
binds the root conversation before it can delegate; PreToolUse compares AGY's
conversationId against that per-invocation binding. This is a hook-level
control, not isolation from same-user filesystem tampering.
"""

import json
import os
import re
import sys

ENV_MARKER = "NTG_BULLDOZER_NO_SHELL"
CONVERSATION_FILE_ENV = "NTG_BULLDOZER_CONVERSATION_FILE"
DENIAL_REASON = "Bulldozer has no shell authority; discovery routes to Jaguar."
# The one sanctioned shell use: the TEMPORARY headless Excavator transport (#174).
EXCAVATOR_TRANSPORT = "scripts/excavator-agy.mjs"


def conversation_id(value):
    if not isinstance(value, str) or not re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", value
    ):
        raise ValueError("Expected AGY conversation UUID")
    return value


def bind_root_conversation(payload):
    path = os.environ.get(CONVERSATION_FILE_ENV)
    if os.environ.get(ENV_MARKER) != "1" or not path:
        return
    root = conversation_id(payload.get("conversationId"))
    try:
        # The runner starts a fresh AGY session: its SessionStart completes
        # before any native child can be spawned. Child SessionStart must not
        # replace this binding, even when the child makes the first shell call.
        with open(path, "x", encoding="utf-8") as stream:
            stream.write(root)
    except FileExistsError:
        pass


def is_excavator_transport(command):
    # Strict shape: `node` then plain tokens or single-quoted tokens (no
    # expansion inside single quotes). Any other shell metacharacter
    # (redirection, chaining, substitution, double quotes, newlines) denies.
    token = r"(?:[A-Za-z0-9_./=:@%+,\-]+|'[^'\n\r]*')"
    if not re.fullmatch(r"node(?: " + token + r")+", command):
        return False
    return EXCAVATOR_TRANSPORT in command.split("'")[0]


def evaluate(payload):
    if os.environ.get(ENV_MARKER) != "1":
        return {"decision": "allow", "reason": "Outside the Bulldozer no-shell boundary"}

    if not isinstance(payload, dict) or not isinstance(payload.get("toolCall"), dict):
        raise ValueError("Expected AGY toolCall object")

    call = payload["toolCall"]
    tool_name = call.get("name")
    if not isinstance(tool_name, str) or not tool_name:
        raise ValueError("Expected non-empty string for toolCall.name")

    if tool_name != "run_command":
        return {"decision": "allow", "reason": "Not a shell tool"}

    call_args = call.get("args") or call.get("arguments") or {}
    command = ""
    if isinstance(call_args, dict):
        command = str(call_args.get("CommandLine") or call_args.get("command") or "")
    elif isinstance(call_args, str):
        command = call_args
    if is_excavator_transport(command):
        return {"decision": "allow", "reason": "Sanctioned Excavator transport"}

    path = os.environ.get(CONVERSATION_FILE_ENV)
    if path:
        current = conversation_id(payload.get("conversationId"))
        with open(path, encoding="utf-8") as stream:
            root = conversation_id(stream.read())
        if current != root:
            return {"decision": "allow", "reason": "Native child conversation; other guards still apply"}

    return {"decision": "deny", "reason": DENIAL_REASON}


def main():
    session_start = sys.argv[1:] == ["--session-start"]
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)
        if session_start:
            if not isinstance(payload, dict):
                raise ValueError("Expected AGY session object")
            bind_root_conversation(payload)
            result = {}
        else:
            result = evaluate(payload)
    except (ValueError, TypeError, OSError) as error:
        # A failed SessionStart cannot authorize shell execution: subsequent
        # PreToolUse calls fail closed on the missing/invalid binding.
        if os.environ.get(ENV_MARKER) == "1":
            result = {"decision": "deny", "reason": "Malformed hook input: " + str(error)}
        else:
            result = {"decision": "allow", "reason": "Outside the Bulldozer no-shell boundary"}
        if session_start:
            print(result["reason"], file=sys.stderr)
            result = {}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
