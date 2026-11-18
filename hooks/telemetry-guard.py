#!/usr/bin/env python3
"""Observation-first telemetry hook for NTG 2.0 (SessionStart / PreToolUse / PostToolUse).

Replaces retired hard-count `budget-guard.py`. Logs structured tool-call and
tool-result observations to `.ntg/telemetry.jsonl` (or `NTG_TELEMETRY_LOG`) and
evaluates four progress signals:
1. output_novelty: whether observed call outputs return new information vs identical output.
2. workspace_state_changed: whether OBSERVED workspace state changed.
3. task_progress_advancing: whether overall task progress is advancing.
4. post_failure_or_edit_retry: whether the call is a reasonable retry after failure or edit.

Repetition count is strictly a telemetry signal, NEVER an automatic waste
verdict or count-only block threshold (#236). When no actual output has been
observed yet (e.g., PreToolUse without PostToolUse result or explicit
observation), output novelty stays unknown (None) and repetition alone never
denies the call. Selective minimal intervention occurs only when observed
outputs/telemetry confirm a non-progressing identical loop.
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

FILE_EDIT_TOOLS = frozenset({
    "write_to_file",
    "replace_file_content",
    "multi_replace_file_content",
    "write_file",
    "edit_file",
})

EDIT_OR_STATE_TOOLS = FILE_EDIT_TOOLS | frozenset({
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


def compute_output_digest(raw_output: Any) -> Optional[str]:
    if raw_output is None:
        return None
    if isinstance(raw_output, str):
        serialized = raw_output
    else:
        serialized = json.dumps(raw_output, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:16]


def load_session_state(state_path: Path) -> dict[str, Any]:
    defaults: dict[str, Any] = {
        "total_calls": 0,
        "last_signature": None,
        "last_tool": None,
        "last_workspace_fingerprint": None,
        "consecutive_identical_calls": 0,
        "stagnant_identical_streak": 0,
        "recent_signatures": [],
        "last_output_digest_by_signature": {},
        "last_output_signature": None,
        "last_observed_novelty": None,
        "observed_identical_output_streak": 0,
        "last_call_failed": False,
        "last_edit_or_state_change": False,
    }
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        for key, val in defaults.items():
            state.setdefault(key, val if not isinstance(val, (dict, list)) else type(val)(val))
        return state
    except (OSError, ValueError):
        return defaults


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


def extract_tool_call(payload: dict[str, Any]) -> tuple[str, Any]:
    call = payload.get("toolCall") if isinstance(payload.get("toolCall"), dict) else {}
    if not call and isinstance(payload.get("tool_call"), dict):
        call = payload["tool_call"]
    tool_name = str(call.get("name") or payload.get("toolName") or "")
    args = call.get("args") if "args" in call else payload.get("toolArgs")
    return tool_name, args


def extract_raw_output(payload: dict[str, Any]) -> Any:
    for key in (
        "toolResult",
        "tool_result",
        "toolOutput",
        "tool_output",
        "result",
        "output",
        "previousOutput",
        "lastToolResult",
    ):
        if key in payload and payload[key] is not None:
            return payload[key]
    obs = payload.get("telemetry") if isinstance(payload.get("telemetry"), dict) else {}
    for key in ("output_digest", "output", "result", "stdout"):
        if key in obs and obs[key] is not None:
            return obs[key]
    return None


def is_failure_result(payload: dict[str, Any], raw_output: Any) -> bool:
    if payload.get("error") or payload.get("isError"):
        return True
    for code_key in ("exitCode", "exit_code", "returncode"):
        if isinstance(payload.get(code_key), int) and payload[code_key] != 0:
            return True
    if isinstance(raw_output, dict):
        if raw_output.get("error") or raw_output.get("isError") or raw_output.get("ok") is False:
            return True
        if str(raw_output.get("status") or "").strip().lower() in ("error", "failed", "failure"):
            return True
        for code_key in ("exitCode", "exit_code", "returncode"):
            if isinstance(raw_output.get(code_key), int) and raw_output[code_key] != 0:
                return True
    return False


def update_digest_map(digest_map: dict[str, str], signature: str, digest: str) -> dict[str, str]:
    updated = dict(digest_map)
    if signature in updated:
        del updated[signature]
    updated[signature] = digest
    if len(updated) > 50:
        for oldest in list(updated.keys())[:-50]:
            del updated[oldest]
    return updated


def extract_observation_signals(
    payload: dict[str, Any],
    state: dict[str, Any],
    signature: str,
    tool_name: str,
    current_fingerprint: Optional[str] = None,
) -> dict[str, Any]:
    obs = payload.get("telemetry") if isinstance(payload.get("telemetry"), dict) else {}

    same_signature = state.get("last_signature") == signature
    prev_fp = state.get("last_workspace_fingerprint")
    fp_changed = (
        current_fingerprint is not None
        and prev_fp is not None
        and current_fingerprint != prev_fp
    )

    # Signal 2: OBSERVED workspace state change (or mutating/stateful tool boundary)
    if "workspace_state_changed" in obs:
        workspace_state_changed = bool(obs["workspace_state_changed"])
    elif fp_changed:
        workspace_state_changed = True
    else:
        workspace_state_changed = bool(tool_name in EDIT_OR_STATE_TOOLS and not same_signature)

    # Signal 1: output novelty (ONLY from actual observed outputs or explicit telemetry)
    digest_map = state.get("last_output_digest_by_signature")
    if not isinstance(digest_map, dict):
        digest_map = {}

    if "output_novelty" in obs:
        output_novelty: Optional[bool] = bool(obs["output_novelty"])
        output_novelty_observed = True
    elif "identical_output" in obs:
        output_novelty = not bool(obs["identical_output"])
        output_novelty_observed = True
    else:
        inline_digest: Optional[str] = None
        if isinstance(obs.get("output_digest"), str) and obs["output_digest"].strip():
            inline_digest = obs["output_digest"].strip()
        elif any(k in obs for k in ("output", "result", "stdout")) or any(
            k in payload for k in ("output_digest", "output", "previousOutput", "lastToolResult")
        ):
            raw_inline = (
                obs.get("output")
                if "output" in obs
                else obs.get("result")
                if "result" in obs
                else obs.get("stdout")
                if "stdout" in obs
                else payload.get("output_digest")
                if "output_digest" in payload
                else payload.get("output")
                if "output" in payload
                else payload.get("previousOutput")
                if "previousOutput" in payload
                else payload.get("lastToolResult")
            )
            inline_digest = compute_output_digest(raw_inline)

        if inline_digest is not None:
            prev_digest = digest_map.get(signature)
            output_novelty = True if prev_digest is None or fp_changed else (inline_digest != prev_digest)
            output_novelty_observed = True
            state["last_output_digest_by_signature"] = update_digest_map(digest_map, signature, inline_digest)
            state["last_output_signature"] = signature
            state["last_observed_novelty"] = output_novelty
        elif (
            same_signature
            and not fp_changed
            and state.get("last_output_signature") == signature
            and state.get("last_observed_novelty") is not None
        ):
            output_novelty = bool(state["last_observed_novelty"])
            output_novelty_observed = True
        else:
            output_novelty = None
            output_novelty_observed = False

    # Signal 4: reasonable retry after failure or edit / workspace change
    if "post_failure_or_edit_retry" in obs:
        post_failure_or_edit_retry = bool(obs["post_failure_or_edit_retry"])
    else:
        post_failure_or_edit_retry = bool(
            payload.get("error")
            or obs.get("after_failure")
            or obs.get("after_edit")
            or state.get("last_call_failed")
            or state.get("last_edit_or_state_change")
            or fp_changed
            or (
                state.get("last_tool") in FILE_EDIT_TOOLS
                and state.get("consecutive_identical_calls", 0) <= 2
            )
        )

    # Signal 3: overall task progress advancing
    if "task_progress_advancing" in obs:
        task_progress_advancing: Optional[bool] = bool(obs["task_progress_advancing"])
    elif (
        output_novelty_observed
        and output_novelty is False
        and same_signature
        and not workspace_state_changed
        and not post_failure_or_edit_retry
    ):
        task_progress_advancing = False
    elif output_novelty is True or workspace_state_changed or not same_signature:
        task_progress_advancing = True
    else:
        task_progress_advancing = None

    return {
        "output_novelty": output_novelty,
        "output_novelty_observed": output_novelty_observed,
        "workspace_state_changed": workspace_state_changed,
        "task_progress_advancing": task_progress_advancing,
        "post_failure_or_edit_retry": post_failure_or_edit_retry,
    }


def _record_post_tool_use(
    payload: dict[str, Any],
    log_path: Path,
    conversation_id: str,
    active_role: Optional[str],
    active_env: dict[str, str],
) -> dict[str, Any]:
    tool_name, args = extract_tool_call(payload)
    signature = call_signature(tool_name, args)
    state_path = resolve_state_path(log_path, conversation_id, env=active_env)
    state = load_session_state(state_path)

    cwd_val = payload.get("cwd")
    cwd_path = Path(cwd_val) if isinstance(cwd_val, str) and cwd_val else Path.cwd()
    current_fingerprint = compute_workspace_fingerprint(cwd_path)
    prev_fp = state.get("last_workspace_fingerprint")
    fp_changed = (
        current_fingerprint is not None
        and prev_fp is not None
        and current_fingerprint != prev_fp
    )

    raw_output = extract_raw_output(payload)
    obs = payload.get("telemetry") if isinstance(payload.get("telemetry"), dict) else {}
    output_digest = (
        obs["output_digest"].strip()
        if isinstance(obs.get("output_digest"), str) and obs["output_digest"].strip()
        else compute_output_digest(raw_output)
    )
    call_failed = is_failure_result(payload, raw_output)
    is_edit_or_state = tool_name in FILE_EDIT_TOOLS or fp_changed

    digest_map = state.get("last_output_digest_by_signature")
    if not isinstance(digest_map, dict):
        digest_map = {}

    observed_novelty: Optional[bool] = None
    if call_failed:
        state["last_call_failed"] = True
        state["observed_identical_output_streak"] = 0
        state["last_observed_novelty"] = None
    elif is_edit_or_state:
        state["last_edit_or_state_change"] = True
        state["last_call_failed"] = False
        state["observed_identical_output_streak"] = 0
        state["stagnant_identical_streak"] = 0
        state["last_output_digest_by_signature"] = {}
        state["last_observed_novelty"] = None
        observed_novelty = True
    elif output_digest is not None:
        state["last_call_failed"] = False
        prev_digest = digest_map.get(signature)
        if prev_digest is None:
            observed_novelty = True
            state["observed_identical_output_streak"] = 0
        else:
            observed_novelty = output_digest != prev_digest
            if not observed_novelty and state.get("last_output_signature") == signature:
                state["observed_identical_output_streak"] = (
                    int(state.get("observed_identical_output_streak", 0)) + 1
                )
            else:
                state["observed_identical_output_streak"] = 0
        state["last_output_digest_by_signature"] = update_digest_map(
            digest_map, signature, output_digest
        )
        state["last_output_signature"] = signature
        state["last_observed_novelty"] = observed_novelty

    state["last_workspace_fingerprint"] = current_fingerprint
    save_session_state(state_path, state)

    append_telemetry(
        log_path,
        {
            "event": "tool_result_observation",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "conversation_id": conversation_id,
            "role": active_role,
            "tool": tool_name,
            "signature": signature,
            "output_digest": output_digest,
            "output_novelty": observed_novelty,
            "workspace_state_changed": bool(is_edit_or_state),
            "call_failed": call_failed,
        },
    )
    return {}


def evaluate(
    payload: Any,
    env: Optional[dict[str, str]] = None,
    session_start: bool = False,
    post_tool_use: bool = False,
) -> dict[str, Any]:
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

    if not is_active(active_env):
        if post_tool_use:
            return {}
        return {"decision": "allow", "reason": "Outside active telemetry boundary"}

    inferred_post = post_tool_use or any(
        k in payload for k in ("toolResult", "tool_result", "toolOutput", "tool_output")
    )
    if inferred_post:
        return _record_post_tool_use(payload, log_path, conversation_id, active_role, active_env)

    tool_name, args = extract_tool_call(payload)
    signature = call_signature(tool_name, args)

    state_path = resolve_state_path(log_path, conversation_id, env=active_env)
    state = load_session_state(state_path)

    cwd_val = payload.get("cwd") if isinstance(payload, dict) else None
    cwd_path = Path(cwd_val) if isinstance(cwd_val, str) and cwd_val else Path.cwd()
    current_fingerprint = compute_workspace_fingerprint(cwd_path)

    state["total_calls"] = int(state.get("total_calls", 0)) + 1
    same_as_last = state.get("last_signature") == signature
    state["consecutive_identical_calls"] = (
        int(state.get("consecutive_identical_calls", 0)) + 1 if same_as_last else 1
    )

    signals = extract_observation_signals(
        payload, state, signature, tool_name, current_fingerprint=current_fingerprint
    )

    if signals["workspace_state_changed"]:
        state["observed_identical_output_streak"] = 0
        state["last_observed_novelty"] = None
        state["last_output_digest_by_signature"] = {}

    non_progressing_identical = bool(
        same_as_last
        and signals["output_novelty_observed"]
        and signals["output_novelty"] is False
        and not signals["workspace_state_changed"]
        and signals["task_progress_advancing"] is False
        and not signals["post_failure_or_edit_retry"]
    )
    if non_progressing_identical:
        state["stagnant_identical_streak"] = int(state.get("stagnant_identical_streak", 0)) + 1
    else:
        state["stagnant_identical_streak"] = 0

    if tool_name in FILE_EDIT_TOOLS or signals["workspace_state_changed"]:
        state["last_edit_or_state_change"] = True
        state["stagnant_identical_streak"] = 0
    else:
        state["last_edit_or_state_change"] = False
        # One retry consumes last_call_failed until PostToolUse observes another failure.
        state["last_call_failed"] = False

    state["last_signature"] = signature
    state["last_tool"] = tool_name
    state["last_workspace_fingerprint"] = current_fingerprint
    recent = list(state.get("recent_signatures", []))
    recent.append(signature)
    state["recent_signatures"] = recent[-20:]
    save_session_state(state_path, state)

    # Intervention happens ONLY when observed outputs/telemetry confirm a non-progressing loop.
    confirmed_wasteful_loop = bool(
        non_progressing_identical and state["stagnant_identical_streak"] >= 2
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
        **(
            {"signal_warning": "repeated_call_without_observed_output"}
            if same_as_last
            and not signals["output_novelty_observed"]
            and state["consecutive_identical_calls"] >= 3
            else {}
        ),
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
    post_tool_use = sys.argv[1:] == ["--post-tool-use"]
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        payload = {}
    result = evaluate(payload, session_start=session_start, post_tool_use=post_tool_use)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
