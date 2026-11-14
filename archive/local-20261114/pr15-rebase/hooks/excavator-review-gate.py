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
REVIEW_CONTRADICTORY = (
    "Excavator reported contradictory terminal states (both READY and BLOCKED). Reconcile "
    "completion status before stopping."
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
        if isinstance(node.get("name"), str) and (
            isinstance(node.get("args"), dict) or isinstance(node.get("args"), str)
        ):
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
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            return ""
    if not isinstance(args, dict):
        return ""
    cmd = str(
        args.get("CommandLine")
        or args.get("commandLine")
        or args.get("command")
        or ""
    ).strip()
    if (cmd.startswith('"') and cmd.endswith('"')) or (cmd.startswith("'") and cmd.endswith("'")):
        cmd = cmd[1:-1].strip()
    return cmd


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


_READY_LINE = re.compile(r"^\s*READY\s*$")
_STATUS_READY_LINE = re.compile(r"^\s*STATUS\s*[:\-\u2014]\s*READY\s*$")
_BLOCKED_LINE = re.compile(r"^\s*BLOCKED\s*$")
_STATUS_BLOCKED_LINE = re.compile(r"^\s*STATUS\s*[:\-\u2014]\s*BLOCKED\s*$")


def extract_assistant_text_from_record(record: Any) -> str | None:
    if isinstance(record, dict):
        source = str(record.get("source") or "").strip().upper()
        rec_type = str(record.get("type") or "").strip().upper()
        if source == "MODEL" and rec_type in {"PLANNER_RESPONSE", "GENERIC"}:
            content = record.get("content")
            if isinstance(content, str) and content.strip():
                if not content.strip().startswith("Created At:"):
                    return content

        for node in iter_dicts(record):
            role = str(node.get("role") or "").strip().lower()
            if role == "assistant":
                text = text_content(node.get("content") if "content" in node else node)
                if text.strip():
                    return text
    return None


def get_latest_assistant_text(records: list[Any]) -> str | None:
    for record in reversed(records):
        text = extract_assistant_text_from_record(record)
        if text is not None:
            return text
    return None


def is_zen_invocation(call: dict[str, Any]) -> bool:
    if tool_name(call) != "invoke_subagent":
        return False
    args = call.get("args")
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            return False
    if not isinstance(args, dict):
        return False

    subagents = args.get("Subagents")
    if subagents is None:
        subagents = args.get("subagents")

    items: list[Any] = []
    if isinstance(subagents, str):
        try:
            parsed = json.loads(subagents)
            if isinstance(parsed, list):
                items = parsed
            elif isinstance(parsed, dict):
                items = [parsed]
        except Exception:
            items = []
    elif isinstance(subagents, list):
        items = subagents
    elif isinstance(subagents, dict):
        items = [subagents]
    else:
        items = [args]

    for item in items:
        if not isinstance(item, dict):
            continue
        for k, v in item.items():
            if normalize_key(k) in {"typename", "type_name"}:
                if str(v).strip().lower() == "zen":
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


def is_provider_system_message(record: Any) -> tuple[bool, str | None, str]:
    if not isinstance(record, dict):
        return False, None, ""
    source = str(record.get("source") or "").strip().upper()
    if source == "MODEL":
        return False, None, ""
    role = str(record.get("role") or "").strip().lower()
    if role == "assistant":
        return False, None, ""
    for node in iter_dicts(record):
        if str(node.get("role") or "").strip().lower() == "assistant":
            return False, None, ""
        if str(node.get("source") or "").strip().upper() == "MODEL":
            return False, None, ""

    rec_type = str(record.get("type") or "").strip().upper()
    content = str(record.get("content") or "")

    is_system = (source == "SYSTEM" and rec_type == "SYSTEM_MESSAGE") or role == "system"
    if not is_system:
        for node in iter_dicts(record):
            if str(node.get("role") or "").strip().lower() == "system":
                is_system = True
                if not content:
                    content = text_content(node)
                break

    if not is_system:
        return False, None, ""

    m = re.search(
        r'\[Message\][^\n]*\bsender=(?P<sender>[^\s]+)[^\n]*\bcontent=(?P<payload>[\s\S]*?)(?:</SYSTEM_MESSAGE>|\Z)',
        content,
    )
    if m:
        sender = m.group("sender").strip("\"'")
        payload = m.group("payload").strip()
        return True, sender, payload
    return True, None, content


def extract_created_subagent(record: Any) -> tuple[str | None, str | None]:
    if not isinstance(record, dict):
        return None, None
    content = str(record.get("content") or "")
    if "Created the following subagents:" not in content and "conversationId" not in content:
        return None, None

    conv_id = None
    log_uri = None
    m_cid = re.search(r'"conversationId":\s*"([^"]+)"', content)
    if m_cid:
        conv_id = m_cid.group(1).strip()
    m_uri = re.search(r'"logAbsoluteUri":\s*"([^"]+)"', content)
    if m_uri:
        log_uri = m_uri.group(1).strip()
    return conv_id, log_uri


def check_child_log_verdict(uri: str) -> str | None:
    if uri.startswith("file://"):
        path = Path(uri[7:])
    else:
        path = Path(uri)
    try:
        if not path.is_file():
            return None
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        for line in reversed(lines):
            if not line.strip():
                continue
            try:
                data = json.loads(line)
            except Exception:
                continue
            tc_list = data.get("tool_calls") or []
            for tc in tc_list:
                if tc.get("name") == "send_message":
                    args = tc.get("args") or {}
                    msg = str(args.get("Message") or "")
                    v = extract_verdict_from_text(msg)
                    if v:
                        return v
            content = str(data.get("content") or "")
            v = extract_verdict_from_text(content)
            if v:
                return v
    except Exception:
        return None
    return None


def is_legacy_tool_record(record: Any) -> bool:
    if not isinstance(record, dict):
        return False
    source = str(record.get("source") or "").strip().upper()
    if source == "MODEL":
        return False
    role = str(record.get("role") or "").strip().lower()
    if role == "assistant":
        return False
    if role == "tool":
        return True
    for node in iter_dicts(record):
        r = str(node.get("role") or "").strip().lower()
        if r == "assistant":
            return False
        if r == "tool":
            return True
    return False


def extract_verdict_from_text(text: str) -> str | None:
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
    active_zen_conv_id: str | None = None
    active_zen_log_uri: str | None = None
    awaiting_subagent_creation = False

    for index, record in enumerate(records):
        if material_change_candidate_in(record):
            latest_change = index

        invoked_here = any(is_zen_invocation(call) for call in iter_tool_calls(record))
        if invoked_here:
            zen_started = True
            latest_verdict = None
            verdict_index = -1
            active_zen_conv_id = None
            active_zen_log_uri = None
            awaiting_subagent_creation = True
            continue

        if zen_started and awaiting_subagent_creation:
            cid, uri = extract_created_subagent(record)
            if cid:
                active_zen_conv_id = cid
                active_zen_log_uri = uri
                awaiting_subagent_creation = False

        if zen_started:
            is_sys_msg, sender, payload = is_provider_system_message(record)
            if is_sys_msg:
                if active_zen_conv_id is not None:
                    if sender == active_zen_conv_id:
                        v = extract_verdict_from_text(payload)
                        if v:
                            latest_verdict = v
                            verdict_index = index
                else:
                    v = extract_verdict_from_text(payload)
                    if v:
                        latest_verdict = v
                        verdict_index = index
                continue

            if is_legacy_tool_record(record):
                v = extract_verdict_from_text(text_content(record))
                if v:
                    latest_verdict = v
                    verdict_index = index
                continue

            if active_zen_log_uri and latest_verdict is None:
                v = check_child_log_verdict(active_zen_log_uri)
                if v:
                    latest_verdict = v
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

    latest_text = get_latest_assistant_text(records)
    if latest_text is None:
        respond("stop")
        return

    has_ready = any(
        _READY_LINE.match(line) or _STATUS_READY_LINE.match(line)
        for line in latest_text.splitlines()
    )
    has_blocked = any(
        _BLOCKED_LINE.match(line) or _STATUS_BLOCKED_LINE.match(line)
        for line in latest_text.splitlines()
    )

    if has_ready and has_blocked:
        respond("continue", REVIEW_CONTRADICTORY)
        return

    if has_blocked:
        respond("stop")
        return

    if not has_ready:
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
