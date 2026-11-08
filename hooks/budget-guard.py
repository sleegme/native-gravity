#!/usr/bin/env python3
"""Stage 1 per-conversation budget guard (NTG subagent redesign 2026-11-08, §2.6.2).

Counts total tool calls, read-only inspection calls and invoke_subagent calls
per AGY conversationId and denies the call that would exceed its cap. The
backstop exists because the prose reading budgets were exceeded by roughly two
orders of magnitude in every observed runaway run (A2a Bulldozer: 368 calls,
269 reads, 15.18M polling tokens); prose alone could not control it.

Activation is process-tree scoped, not agent-identity scoped: the guard is
active only when NTG_SUPERVISOR_PID is set (a runner-spawned session), so
ordinary interactive agy sessions are unaffected. Inside an active tree, caps
apply only when NTG_BUDGET_STATE_DIR names a writable counter directory; other
roles (Zen, Piledriver) run uncounted. SessionStart binds the runner-started
root conversation before any native child can spawn; the root gets the tighter
Bulldozer caps, children get the uniform worker caps.

Salvage sessions (NTG_SALVAGE=1, §2.6.5) are packet-only: worker dispatch and
file edits are denied outright, and the call cap tightens to the salvage budget.
"""

import json
import os
import re
import sys

SUPERVISOR_MARKER = "NTG_SUPERVISOR_PID"
STATE_DIR_ENV = "NTG_BUDGET_STATE_DIR"
ROOT_FILE_ENV = "NTG_BUDGET_ROOT_FILE"
SALVAGE_MARKER = "NTG_SALVAGE"
CONVERSATION_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
)

READ_TOOLS = {"view_file", "list_dir", "find_by_name", "grep_search"}
SPAWN_TOOLS = {"invoke_subagent"}
EDIT_TOOLS = {"write_to_file", "replace_file_content"}

SALVAGE_DENIAL = (
    "Salvage session is packet-only: worker dispatch and file edits are denied. "
    "Build the result packet from the supplied material."
)
WRAP_UP_DENIAL = (
    "Budget cap reached ({which}: {count}/{cap}). Finish now: return your result "
    "packet with the work already done and list anything not completed as UNKNOWN."
)


def conversation_id(value):
    if not isinstance(value, str) or not re.fullmatch(CONVERSATION_RE, value):
        raise ValueError("Expected AGY conversation UUID")
    return value


def bind_root_conversation(payload):
    """SessionStart: first-seen conversation becomes the root (exclusive create)."""
    path = os.environ.get(ROOT_FILE_ENV)
    if not path or not active():
        return
    root = conversation_id(payload.get("conversationId"))
    try:
        with open(path, "x", encoding="utf-8") as stream:
            stream.write(root)
    except FileExistsError:
        pass


def active():
    return os.environ.get(SUPERVISOR_MARKER) is not None


def budget_configured():
    return bool(os.environ.get(STATE_DIR_ENV))


def is_root_conversation(current):
    path = os.environ.get(ROOT_FILE_ENV)
    if not path:
        return False
    try:
        with open(path, encoding="utf-8") as stream:
            return conversation_id(stream.read()) == current
    except (OSError, ValueError):
        # A missing/invalid binding cannot identify the root: treat the caller
        # as a child so uniform caps still apply, never the tighter root caps.
        return False


def counter_path(state_dir, current):
    return os.path.join(state_dir, current + ".json")


def read_counters(state_dir, current):
    try:
        with open(counter_path(state_dir, current), encoding="utf-8") as stream:
            data = json.load(stream)
    except (OSError, ValueError):
        data = {}
    return {
        "calls": int(data.get("calls", 0)),
        "reads": int(data.get("reads", 0)),
        "spawns": int(data.get("spawns", 0)),
    }


def write_counters(state_dir, current, counters):
    os.makedirs(state_dir, exist_ok=True)
    tmp = counter_path(state_dir, current) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as stream:
        json.dump(counters, stream)
    os.replace(tmp, counter_path(state_dir, current))


def env_int(name):
    try:
        value = int(os.environ.get(name, ""))
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def caps_for(root):
    if root:
        return {
            "calls": env_int("NTG_BUDGET_ROOT_MAX_CALLS"),
            "reads": env_int("NTG_BUDGET_ROOT_MAX_READ_CALLS"),
            "spawns": env_int("NTG_BUDGET_ROOT_MAX_SPAWN_CALLS"),
        }
    return {
        "calls": env_int("NTG_BUDGET_MAX_CALLS"),
        "reads": env_int("NTG_BUDGET_MAX_READ_CALLS"),
        "spawns": env_int("NTG_BUDGET_MAX_SPAWN_CALLS"),
    }


def evaluate(payload):
    if not active() or not budget_configured():
        return {"decision": "allow", "reason": "Outside the runner budget boundary"}

    if not isinstance(payload, dict) or not isinstance(payload.get("toolCall"), dict):
        raise ValueError("Expected AGY toolCall object")

    call = payload["toolCall"]
    tool_name = call.get("name")
    if not isinstance(tool_name, str) or not tool_name:
        raise ValueError("Expected non-empty string for toolCall.name")

    if os.environ.get(SALVAGE_MARKER) == "1" and (
        tool_name in SPAWN_TOOLS or tool_name in EDIT_TOOLS
    ):
        return {"decision": "deny", "reason": SALVAGE_DENIAL}

    current = conversation_id(payload.get("conversationId"))
    state_dir = os.environ[STATE_DIR_ENV]
    root = is_root_conversation(current)

    counters = read_counters(state_dir, current)
    counters["calls"] += 1
    if tool_name in READ_TOOLS:
        counters["reads"] += 1
    if tool_name in SPAWN_TOOLS:
        counters["spawns"] += 1

    caps = caps_for(root)
    for which, count in (
        ("calls", counters["calls"]),
        ("reads", counters["reads"]),
        ("spawns", counters["spawns"]),
    ):
        cap = caps[which]
        if cap is not None and count > cap:
            return {
                "decision": "deny",
                "reason": WRAP_UP_DENIAL.format(which=which, count=count, cap=cap),
            }

    write_counters(state_dir, current, counters)
    return {"decision": "allow", "reason": "Within budget"}


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
        # Fail closed while active and budgeted: a malformed payload must not
        # become an uncounted call (same posture as bulldozer-shell-guard).
        if active() and budget_configured():
            result = {"decision": "deny", "reason": "Malformed hook input: " + str(error)}
        else:
            result = {"decision": "allow", "reason": "Outside the runner budget boundary"}
        if session_start:
            print(result["reason"], file=sys.stderr)
            result = {}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
