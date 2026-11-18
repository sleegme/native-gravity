#!/usr/bin/env python3
"""Observation-first telemetry hook for NTG 2.0 (AGY SessionStart / PreToolUse).

Replaces retired hard-count `budget-guard.py`. Logs structured tool-call
observations to `.ntg/telemetry.jsonl` (or `NTG_TELEMETRY_LOG`) and evaluates
four progress signals:
1. output_novelty: whether repeated calls return new information vs identical output.
2. workspace_state_changed: whether OBSERVED workspace state changed.
3. task_progress_advancing: whether overall task progress is advancing.
4. post_failure_or_edit_retry: whether the call is a reasonable retry after failure or edit.

Repetition count is strictly a telemetry signal, NEVER an automatic waste
verdict or count-only block threshold. Selective minimal intervention occurs
only when telemetry confirms non-progressing wasteful looping (identical call,
identical output, zero workspace state change, zero progress, and not a
post-failure/post-edit retry).
"""

import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

SUPERVISOR_MARKER = "NTG_SUPERVISOR_PID"
ACTIVE_ROLE_ENV = "NTG_ACTIVE_ROLE"
TELEMETRY_LOG_ENV = "NTG_TELEMETRY_LOG"
TELEMETRY_STATE_DIR_ENV = "NTG_TELEMETRY_STATE_DIR"

EDIT_OR_STATE_TOOLS = frozenset({
    "write_to_file",
    "replace_file_content",
    "multi_replace_file_content",
    "write_file",
    "edit_file",
    "invoke_subagent",
    "run_command",
})


def is_active(env: Optional[dict[str, str]] = None) -> bool:
    active_env = env if env is not None else os.environ
    return any(
        bool(active_env.get(k))
        for k in (SUPERVISOR_MARKER, ACTIVE_ROLE_ENV, TELEMETRY_LOG_ENV, TELEMETRY_STATE_DIR_ENV)
    )


def resolve_log_path(payload: dict[str, Any], env: Optional[dict[str, str]] = None) -> Path:
    active_env = env if env is not None else os.environ
    explicit = active_env.get(TELEMETRY_LOG_ENV)
    if explicit:
        return Path(explicit)
    cwd = payload.get("cwd") if isinstance(payload, dict) else None
    base = Path(cwd) if isinstance(cwd, str) and cwd else Path.cwd()
    return base / ".ntg" / "telemetry.jsonl"


def resolve_state_path(log_path: Path, conversation_id: str, env: Optional[dict[str, str]] = None) -> Path:
    active_env = env if env is not None else os.environ
    state_dir = active_env.get(TELEMETRY_STATE_DIR_ENV)
    safe_conv = "".join(c if c.isalnum() or c in "-_" else "_" for c in (conversation_id or "default"))
    if state_dir:
        return Path(state_dir) / f"{safe_conv}.json"
    return log_path.parent / f".telemetry-state-{safe_conv}.json"


def call_signature(tool_name: str, args: Any) -> str:
    canonical = json.dumps({"tool": tool_name, "args": args}, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def load_session_state(state_path: Path) -> dict[str, Any]:
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state.setdefault("last_workspace_fingerprint", None)
        state.setdefault("last_tool", None)
        return state
    except (OSError, ValueError):
        return {
            "total_calls": 0,
            "last_signature": None,
            "last_tool": None,
            "last_workspace_fingerprint": None,
            "consecutive_identical_calls": 0,
            "stagnant_identical_streak": 0,
            "recent_signatures": [],
        }


def compute_workspace_fingerprint(cwd: Path) -> Optional[str]:
    try:
        status_proc = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(cwd),
            text=True,
            capture_output=True,
            timeout=2,
        )
        if status_proc.returncode != 0:
            return None
        diff_proc = subprocess.run(
            ["git", "diff", "--numstat"],
            cwd=str(cwd),
            text=True,
            capture_output=True,
            timeout=2,
        )
        if diff_proc.returncode != 0:
            return None
        combined = f"{status_proc.stdout}\n---\n{diff_proc.stdout}"
        return hashlib.sha256(combined.encode("utf-8")).hexdigest()
    except (OSError, subprocess.TimeoutExpired):
        return None


def save_session_state(state_path: Path, state: dict[str, Any]) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = state_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state), encoding="utf-8")
    os.replace(tmp, state_path)


def append_telemetry(log_path: Path, record: dict[str, Any]) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")


def extract_observation_signals(
    payload: dict[str, Any],
    state: dict[str, Any],
    signature: str,
    tool_name: str,
    current_fingerprint: Optional[str] = None,
) -> dict[str, Any]:
    obs = payload.get("telemetry") if isinstance(payload.get("telemetry"), dict) else {}

    same_signature = state.get("last_signature") == signature
    seen_before = signature in state.get("recent_signatures", [])

    # Signal 1: output novelty (explicitly observed or inferred from non-repeated signature)
    if "output_novelty" in obs:
        output_novelty = bool(obs["output_novelty"])
    elif "identical_output" in obs:
        output_novelty = not bool(obs["identical_output"])
    else:
        output_novelty = not same_signature

    # Signal 2: OBSERVED workspace state change (or mutating/stateful tool boundary)
    prev_fp = state.get("last_workspace_fingerprint")
    if "workspace_state_changed" in obs:
        workspace_state_changed = bool(obs["workspace_state_changed"])
    elif current_fingerprint is not None and prev_fp is not None and current_fingerprint != prev_fp:
        workspace_state_changed = True
    else:
        workspace_state_changed = tool_name in EDIT_OR_STATE_TOOLS and not same_signature

    # Signal 3: overall task progress advancing
    if "task_progress_advancing" in obs:
        task_progress_advancing = bool(obs["task_progress_advancing"])
    else:
        task_progress_advancing = not same_signature and not seen_before

    # Signal 4: reasonable retry after failure or edit
    if "post_failure_or_edit_retry" in obs:
        post_failure_or_edit_retry = bool(obs["post_failure_or_edit_retry"])
    else:
        post_failure_or_edit_retry = bool(
            payload.get("error")
            or obs.get("after_failure")
            or obs.get("after_edit")
            or (
                state.get("last_tool") in EDIT_OR_STATE_TOOLS
                and state.get("consecutive_identical_calls", 0) <= 2
            )
        )

    return {
        "output_novelty": output_novelty,
        "workspace_state_changed": workspace_state_changed,
        "task_progress_advancing": task_progress_advancing,
        "post_failure_or_edit_retry": post_failure_or_edit_retry,
    }


def evaluate(payload: Any, env: Optional[dict[str, str]] = None, session_start: bool = False) -> dict[str, Any]:
    active_env = env if env is not None else os.environ
    if not isinstance(payload, dict):
        return {"decision": "allow", "reason": "Telemetry observation skipped for non-object payload"}

    log_path = resolve_log_path(payload, env=active_env)
    conversation_id = str(payload.get("conversationId") or "default")
    active_role = str(active_env.get(ACTIVE_ROLE_ENV, "")).strip().lower() or None

    if session_start:
        if is_active(active_env):
            append_telemetry(log_path, {
                "event": "session_start",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "conversation_id": conversation_id,
                "role": active_role,
            })
        return {}

    call = payload.get("toolCall") if isinstance(payload.get("toolCall"), dict) else {}
    tool_name = str(call.get("name") or "")
    args = call.get("args")
    signature = call_signature(tool_name, args)

    if not is_active(active_env):
        return {"decision": "allow", "reason": "Outside active telemetry boundary"}

    state_path = resolve_state_path(log_path, conversation_id, env=active_env)
    state = load_session_state(state_path)

    cwd_val = payload.get("cwd") if isinstance(payload, dict) else None
    cwd_path = Path(cwd_val) if isinstance(cwd_val, str) and cwd_val else Path.cwd()
    current_fingerprint = compute_workspace_fingerprint(cwd_path)

    state["total_calls"] = int(state.get("total_calls", 0)) + 1
    same_as_last = state.get("last_signature") == signature
    state["consecutive_identical_calls"] = int(state.get("consecutive_identical_calls", 0)) + 1 if same_as_last else 1

    signals = extract_observation_signals(
        payload, state, signature, tool_name, current_fingerprint=current_fingerprint
    )
    non_progressing_identical = (
        same_as_last
        and not signals["output_novelty"]
        and not signals["workspace_state_changed"]
        and not signals["task_progress_advancing"]
        and not signals["post_failure_or_edit_retry"]
    )
    if non_progressing_identical:
        state["stagnant_identical_streak"] = int(state.get("stagnant_identical_streak", 0)) + 1
    else:
        state["stagnant_identical_streak"] = 0

    state["last_signature"] = signature
    state["last_tool"] = tool_name
    state["last_workspace_fingerprint"] = current_fingerprint
    recent = list(state.get("recent_signatures", []))
    recent.append(signature)
    state["recent_signatures"] = recent[-20:]
    save_session_state(state_path, state)

    # Confirm non-progressing wasteful looping only after repeated stagnant identical observations
    has_explicit_telemetry = isinstance(payload.get("telemetry"), dict)
    if has_explicit_telemetry:
        confirmed_wasteful_loop = non_progressing_identical and state["stagnant_identical_streak"] >= 2
    else:
        confirmed_wasteful_loop = (
            non_progressing_identical
            and state["stagnant_identical_streak"] >= 3
            and not signals["workspace_state_changed"]
        )

    record = {
        "event": "tool_observation",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "conversation_id": conversation_id,
        "role": active_role,
        "tool": tool_name,
        "signature": signature,
        "repetition_count": state["consecutive_identical_calls"],
        "total_calls": state["total_calls"],
        "signals": signals,
        "confirmed_wasteful_loop": confirmed_wasteful_loop,
    }
    append_telemetry(log_path, record)

    if confirmed_wasteful_loop:
        return {
            "decision": "deny",
            "reason": (
                "Observation telemetry confirmed a non-progressing identical loop "
                "(no output novelty, no observed workspace state change, no task progress, "
                "and not a post-failure/edit retry). Choose an alternative action or report findings."
            ),
        }

    return {"decision": "allow", "reason": "Observation-first telemetry recorded"}


def main() -> None:
    session_start = sys.argv[1:] == ["--session-start"]
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        payload = {}
    result = evaluate(payload, session_start=session_start)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
