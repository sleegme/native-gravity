#!/usr/bin/env python3
"""Stop-hook completion gate for Bulldozer and Piledriver Zen review cycles."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable, Optional

ROLE_SIGNATURES = {
    "bulldozer": "You are Bulldozer, Native Gravity's general Host and orchestrator.",
    "piledriver": "You are Piledriver, Native Gravity's plan-first primary agent.",
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

_READY_LINE = re.compile(r"^\s*READY\s*$")
_STATUS_READY_LINE = re.compile(r"^\s*STATUS\s*[:\-\u2014]\s*READY\s*$")
_BLOCKED_LINE = re.compile(r"^\s*BLOCKED\s*$")
_STATUS_BLOCKED_LINE = re.compile(r"^\s*STATUS\s*[:\-\u2014]\s*BLOCKED\s*$")
_PLAN_READY_LINE = re.compile(r"^\s*PLAN READY\s*$")

REVIEW_PENDING = (
    "A Zen review request is still pending. Wait for the current Zen child to return an "
    "observed verdict before stopping; requesting or messaging the reviewer is not review evidence."
)
REVIEW_REQUIRED_BULLDOZER = (
    "Bulldozer successful completion requires an independent Zen review of the current integrated "
    "artifact and an observed current VERDICT: GO before the final READY status."
)
REVIEW_REQUIRED_PILEDRIVER = (
    "Piledriver PLAN READY requires an independent Zen review of the current plan and an observed "
    "current VERDICT: GO."
)
REVIEW_NO_GO = (
    "The current Zen review returned VERDICT: NO-GO. Address only the concrete blockers within the "
    "active primary role, re-verify as needed, then request a fresh Zen review before claiming readiness."
)
REVIEW_NO_VERDICT = (
    "The current Zen review has no observed provenance-bound verdict. Do not convert a review request, "
    "self-report, or unrelated transcript text into VERDICT: GO."
)
CONTRADICTORY = (
    "The primary agent reported contradictory terminal states. Reconcile the completion status before stopping."
)


def respond(decision: str, reason: Optional[str] = None) -> None:
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


def parse_args(call: dict[str, Any]) -> dict[str, Any]:
    args = call.get("args")
    if isinstance(args, str):
        try:
            parsed = json.loads(args)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return args if isinstance(args, dict) else {}


def detect_primary_role(records: list[Any]) -> Optional[str]:
    for record in records:
        for node in iter_dicts(record):
            for key, value in node.items():
                if normalize_key(key) in IDENTITY_KEYS:
                    candidate = str(value).strip().lower()
                    if candidate in ROLE_SIGNATURES:
                        return candidate

    full_text = text_content(records)
    for role, signature in ROLE_SIGNATURES.items():
        if signature in full_text:
            return role
    return None


def extract_assistant_text_from_record(record: Any) -> Optional[str]:
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


def get_latest_assistant_text(records: list[Any]) -> Optional[str]:
    for record in reversed(records):
        text = extract_assistant_text_from_record(record)
        if text is not None:
            return text
    return None


def is_zen_invocation(call: dict[str, Any]) -> bool:
    if tool_name(call) != "invoke_subagent":
        return False
    args = parse_args(call)
    subagents = args.get("Subagents")
    if subagents is None:
        subagents = args.get("subagents")

    items: list[Any] = []
    if isinstance(subagents, str):
        try:
            parsed = json.loads(subagents)
        except Exception:
            parsed = None
        if isinstance(parsed, list):
            items = parsed
        elif isinstance(parsed, dict):
            items = [parsed]
    elif isinstance(subagents, list):
        items = subagents
    elif isinstance(subagents, dict):
        items = [subagents]
    else:
        items = [args]

    for item in items:
        if not isinstance(item, dict):
            continue
        for key, value in item.items():
            if normalize_key(key) in {"typename", "type_name"}:
                if str(value).strip().lower() == "zen":
                    return True
    return False


def extract_created_subagent(record: Any) -> Optional[str]:
    if not isinstance(record, dict):
        return None
    content = str(record.get("content") or "")
    if "Created the following subagents:" not in content and "conversationId" not in content:
        return None
    match = re.search(r'"conversationId":\s*"([^"]+)"', content)
    return match.group(1).strip() if match else None


def is_provider_system_message(record: Any) -> tuple[bool, Optional[str], str]:
    if not isinstance(record, dict):
        return False, None, ""

    source = str(record.get("source") or "").strip().upper()
    role = str(record.get("role") or "").strip().lower()
    if source == "MODEL" or role == "assistant":
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

    match = re.search(
        r'\[Message\][^\n]*\bsender=(?P<sender>[^\s]+)[^\n]*\bcontent=(?P<payload>[\s\S]*?)(?:</SYSTEM_MESSAGE>|\Z)',
        content,
    )
    if match:
        sender = match.group("sender").strip("\"'")
        payload = match.group("payload").strip()
        return True, sender, payload
    return True, None, content


def extract_verdict_from_text(text: str) -> Optional[str]:
    has_no_go = "VERDICT: NO-GO" in text
    has_go = "VERDICT: GO" in text
    if has_no_go:
        return "NO-GO"
    if has_go and not has_no_go:
        return "GO"
    return None


def call_targets_conversation(call: dict[str, Any], conversation_id: str) -> bool:
    if tool_name(call) != "send_message":
        return False
    args = parse_args(call)
    if not args:
        return False

    preferred_keys = {
        "conversationid",
        "conversation_id",
        "targetconversationid",
        "target_conversation_id",
        "recipient",
        "recipientid",
        "recipient_id",
        "subagentid",
        "subagent_id",
    }
    for key, value in args.items():
        if normalize_key(key) in preferred_keys and str(value).strip() == conversation_id:
            return True

    # AGY schemas have changed across builds. Once a Zen child id is already observed,
    # an exact argument-value match is still provenance-bound to that known child.
    for value in args.values():
        if isinstance(value, str) and value.strip() == conversation_id:
            return True
    return False


def review_state(records: list[Any]) -> tuple[bool, Optional[str], int, int]:
    zen_started = False
    active_zen_conv_id: Optional[str] = None
    awaiting_subagent_creation = False
    latest_request_index = -1
    latest_verdict: Optional[str] = None
    verdict_index = -1

    for index, record in enumerate(records):
        invoked_here = any(is_zen_invocation(call) for call in iter_tool_calls(record))
        if invoked_here:
            zen_started = True
            active_zen_conv_id = None
            awaiting_subagent_creation = True
            latest_request_index = index
            latest_verdict = None
            verdict_index = -1
            continue

        if zen_started and awaiting_subagent_creation:
            conv_id = extract_created_subagent(record)
            if conv_id:
                active_zen_conv_id = conv_id
                awaiting_subagent_creation = False

        if zen_started and active_zen_conv_id:
            fresh_message = any(
                call_targets_conversation(call, active_zen_conv_id)
                for call in iter_tool_calls(record)
            )
            if fresh_message:
                latest_request_index = index
                latest_verdict = None
                verdict_index = -1

            is_system, sender, payload = is_provider_system_message(record)
            if is_system and sender == active_zen_conv_id:
                verdict = extract_verdict_from_text(payload)
                if verdict:
                    latest_verdict = verdict
                    verdict_index = index

    return zen_started, latest_verdict, latest_request_index, verdict_index


def has_line(pattern: re.Pattern[str], text: str) -> bool:
    return any(pattern.match(line) for line in text.splitlines())


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

    role = detect_primary_role(records)
    if role not in {"bulldozer", "piledriver"}:
        respond("stop")
        return

    latest_text = get_latest_assistant_text(records)
    if latest_text is None:
        respond("stop")
        return

    zen_started, verdict, request_index, verdict_index = review_state(records)
    pending_review = zen_started and request_index > verdict_index
    if pending_review:
        respond("continue", REVIEW_PENDING)
        return

    if role == "bulldozer":
        ready = has_line(_READY_LINE, latest_text) or has_line(_STATUS_READY_LINE, latest_text)
        blocked = has_line(_BLOCKED_LINE, latest_text) or has_line(_STATUS_BLOCKED_LINE, latest_text)

        if ready and blocked:
            respond("continue", CONTRADICTORY)
            return
        if blocked or not ready:
            respond("stop")
            return
        if not event.get("fullyIdle", True):
            respond("continue", REVIEW_PENDING)
            return
        if not zen_started:
            respond("continue", REVIEW_REQUIRED_BULLDOZER)
            return
        if verdict == "NO-GO":
            respond("continue", REVIEW_NO_GO)
            return
        if verdict != "GO":
            respond("continue", REVIEW_NO_VERDICT)
            return
        respond("stop")
        return

    plan_ready = has_line(_PLAN_READY_LINE, latest_text)
    if not plan_ready:
        respond("stop")
        return
    if not event.get("fullyIdle", True):
        respond("continue", REVIEW_PENDING)
        return
    if not zen_started:
        respond("continue", REVIEW_REQUIRED_PILEDRIVER)
        return
    if verdict == "NO-GO":
        respond("continue", REVIEW_NO_GO)
        return
    if verdict != "GO":
        respond("continue", REVIEW_NO_VERDICT)
        return
    respond("stop")


if __name__ == "__main__":
    main()
