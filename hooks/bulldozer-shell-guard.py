#!/usr/bin/env python3
"""Read AGY PreToolUse JSON from stdin and emit its allow/deny decision.

The boundary is NTG_BULLDOZER_NO_SHELL=1 in the process environment.
When set, run_command is denied with a clear message directing discovery to Jaguar.
Other tools and unmarked processes are allowed untouched.
"""

import json
import os
import re
import sys

ENV_MARKER = "NTG_BULLDOZER_NO_SHELL"
DENIAL_REASON = "Bulldozer has no shell authority; discovery routes to Jaguar."
# The one sanctioned shell use: the TEMPORARY headless Excavator transport (#174).
EXCAVATOR_TRANSPORT = "scripts/excavator-agy.mjs"


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

    return {"decision": "deny", "reason": DENIAL_REASON}


def main():
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)
        result = evaluate(payload)
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        if os.environ.get(ENV_MARKER) == "1":
            result = {"decision": "deny", "reason": "Malformed hook input: " + str(error)}
        else:
            result = {"decision": "allow", "reason": "Outside the Bulldozer no-shell boundary"}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
