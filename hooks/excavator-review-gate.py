#!/usr/bin/env python3
"""Stop-hook completion gate requiring independent Zen review for Excavator."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable

EXCAVATOR_MARKER = "NTG_EXCAVATOR=1 "
ROLE_SIGNATURE = "You are Excavator, Native Gravity's autonomous troubleshooting primary agent."
DIRECT_MUTATION_TOOLS = {
    "write_to_file",
    "replace_file_content",
    "multi_replace_file_content",
}
IDENTITY_KEYS = {
    "agentname",
    "agent_name",
    "customagentname",
    "custom_agent_name",
    "selectedagent",
    "selected_agent",
}
NORMAL_STOP_REASONS = {
    "model_stop",
    "no_tool_call",
    "stop",
    "completed",
    "complete",
    "",
}

REVIEW_REQUIRED = (
    "Excavator completion requires an independent Zen review of the current artifact. "
    "Invoke only the `zen` subagent with the original task contract, current changed-artifact "
    "context, and verification evidence. Observe its verdict before claiming READY."
)
REVIEW_PENDING = (
    "Excavator cannot stop while background work is still active. Wait for the Zen review "
    "or other active verification to finish, then observe the result before claiming READY."
)
REVIEW_NO_GO = (
    "Zen returned VERDICT: NO-GO. Address the smallest concrete blockers, re-run relevant "
    "verification, then request a fresh Zen review. Do not claim READY yet."
)
REVIEW_STALE = (
    "The last Zen VERDICT: GO predates a later Excavator write or marked shell call. Re-run "
    "relevant verification and obtain a fresh Zen review of the current artifact before "
    "claiming READY."
)
REVIEW_NO_VERDICT = (
    "A Zen review was started but no final VERDICT: GO was observed. Wait for or inspect the "
    "review result before claiming READY."
)


def respond(decision: str, reason: str | None = None) -> None:
    payload = {"decision": decision}
    if reason:
        payload["reason"] = reason
    print(json.dumps(payload))


def normalize_key(key: object) -> str:
    return str(key).replace("-", "_").lower()


def iter_dicts(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from iter_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_dicts(child)


def iter_tool_calls(value: Any) -> Iterable[dict[str, Any]]:
    for node in iter_dicts(value):
        nested = node.get("toolCall")
        if isinstance(nested, dict):
            yield nested
        nested = node.get("tool_call")
        if isinstance(nested, dict):
            yield nested
        if isinstance(node.get("name"), str) and isinstance(node.get("args"), dict):
            yield node


def text_content(value: Any) -> str:
    parts: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, str):
            parts.append(node)
        elif isinstance(node, dict):
            for child in node.values():
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(value)
    return "\n".join(parts)


def read_transcript(path_value: object) -> list[Any]:
    if not path_value:
        return []
    path = Path(str(path_value)).expanduser()
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []

    records: list[Any] = []
    for line in lines:
        if not line.strip():
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            records.append(line)
    return records


def tool_name(call: dict[str, Any]) -> str:
    return str(call.get("name") or "").strip().lower()


def command_line(call: dict[str, Any]) -> str:
    args = call.get("args")
    if not isinstance(args, dict):
        return ""
    return str(
        args.get("CommandLine")
        or args.get("commandLine")
        or args.get("command")
        or ""
    )


def has_structured_excavator_identity(records: list[Any]) -> bool:
    for record in records:
        for node in iter_dicts(record):
            for key, value in node.items():
                if normalize_key(key) in IDENTITY_KEYS and str(value).strip().lower() == "excavator":
                    return True
    return False


def has_excavator_system_prompt(records: list[Any]) -> bool:
    prompt_keys = {
        "systemprompt",
        "system_prompt",
        "systeminstruction",
        "system_instruction",
        "instructions",
    }
    for record in records:
        for node in iter_dicts(record):
            role = str(node.get("role") or "").strip().lower()
            if role == "system" and ROLE_SIGNATURE in text_content(node):
                return True
            for key, value in node.items():
                if normalize_key(key) in prompt_keys and ROLE_SIGNATURE in text_content(value):
                    return True
    return False


def has_excavator_marker(records: list[Any]) -> bool:
    for record in records:
        for call in iter_tool_calls(record):
            if tool_name(call) == "run_command" and command_line(call).startswith(EXCAVATOR_MARKER):
                return True
    return False


def tail_is_blocked(records: list[Any]) -> bool:
    for record in records[-3:]:
        text = text_content(record)
        if (
            "ROOT_CAUSE" in text
            and "VERIFICATION_EVIDENCE" in text
            and re.search(r"\bBLOCKED\b", text)
            and not re.search(r"\bREADY\b", text)
        ):
            return True
    return False


def is_zen_invocation(call: dict[str, Any]) -> bool:
    if tool_name(call) != "invoke_subagent":
        return False
    args = call.get("args")
    if not isinstance(args, dict):
        return False

    for node in iter_dicts(args):
        for key, value in node.items():
            normalized = normalize_key(key)
            if normalized in {"typename", "type_name", "name"}:
                if str(value).strip().lower() == "zen":
                    return True
            if normalized == "role":
                role = str(value).strip().lower()
                if role == "zen" or re.search(r"\bzen\b", role):
                    return True
    return False


def material_change_candidate_in(record: Any) -> bool:
    for call in iter_tool_calls(record):
        name = tool_name(call)
        if name in DIRECT_MUTATION_TOOLS:
            return True
        if name == "run_command" and command_line(call).startswith(EXCAVATOR_MARKER):
            # The Stop payload does not expose shell effects. Conservatively invalidate
            # a prior review after any marked Excavator shell call so shell-mediated
            # mutation cannot make an older GO look fresh.
            return True
    return False


def verdict_in(record: Any) -> str | None:
    text = text_content(record)
    has_no_go = "VERDICT: NO-GO" in text
    has_go = "VERDICT: GO" in text
    if has_no_go:
        return "NO-GO"
    if has_go and not has_no_go:
        return "GO"
    return None


def review_state(records: list[Any]) -> tuple[bool, str | None, int, int]:
    zen_started = False
    latest_verdict: str | None = None
    verdict_index = -1
    latest_change = -1

    for index, record in enumerate(records):
        if material_change_candidate_in(record):
            latest_change = index

        invoked_here = any(is_zen_invocation(call) for call in iter_tool_calls(record))
        if invoked_here:
            zen_started = True
            latest_verdict = None
            verdict_index = -1
            continue

        if zen_started:
            verdict = verdict_in(record)
            if verdict:
                latest_verdict = verdict
                verdict_index = index

    return zen_started, latest_verdict, verdict_index, latest_change


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except Exception:
        respond("stop")
        return

    reason = str(event.get("terminationReason") or "").strip().lower()
    error = str(event.get("error") or "").strip()
    if error or reason not in NORMAL_STOP_REASONS:
        respond("stop")
        return

    records = read_transcript(event.get("transcriptPath"))
    if not records:
        respond("stop")
        return

    is_excavator = (
        has_structured_excavator_identity(records)
        or has_excavator_system_prompt(records)
        or has_excavator_marker(records)
    )
    if not is_excavator:
        respond("stop")
        return

    if tail_is_blocked(records):
        respond("stop")
        return

    zen_started, verdict, verdict_index, latest_change = review_state(records)

    if not event.get("fullyIdle", True):
        respond("continue", REVIEW_PENDING)
        return

    if not zen_started:
        respond("continue", REVIEW_REQUIRED)
        return

    if verdict == "NO-GO":
        respond("continue", REVIEW_NO_GO)
        return

    if verdict != "GO":
        respond("continue", REVIEW_NO_VERDICT)
        return

    if latest_change > verdict_index:
        respond("continue", REVIEW_STALE)
        return

    respond("stop")


if __name__ == "__main__":
    main()
