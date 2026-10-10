#!/usr/bin/env python3
"""NTG gate panel — read-only renderer for Zen / Stop-hook gate state (issue #112).

PO picked option A on 2026-10-10: a persistent gate-status panel on the
Settings tabs surface. Limit (recorded per the #112 escape clause): neither
this repository nor the AGY plugin extension surface (`agy plugin validate`
reports agents / hooks / commands / skills / mcpServers only) provides a
Settings-tabs host for a plugin to render into. This module is therefore the
smallest useful version: a read-only renderer that produces the panel content
as a fixed-width, horizontal-only table suitable for embedding in whatever
tab/pane surface hosts it (a terminal tab, a split pane, or a future host
Settings tab), plus a `--json` machine form for programmatic consumers.

The panel reads gate state; it never owns or mutates it. Gate state derives
from the same transcripts and rules the Stop hooks enforce:

- hooks/primary-review-gate.py   -> bulldozer / piledriver completion gate
- hooks/excavator-review-gate.py -> excavator completion gate

Each row answers: which gate is armed for this session (or none), the latest
observed Zen verdict, the decision the Stop hook would return for the event
in effect, and the evidence the state was read from. Decisions come from each
hook's own decide(event, records) function — the panel reuses the enforced
code path instead of reimplementing it, so the two cannot drift apart.

Usage:
  python3 scripts/gate_panel.py --transcript /path/to/transcript.jsonl
  python3 scripts/gate_panel.py --transcript a.jsonl --transcript b.jsonl
  python3 scripts/gate_panel.py --event stop-event.json
  python3 scripts/gate_panel.py --transcript a.jsonl --json

Without --event, the panel synthesizes a normal-completion Stop event
(terminationReason=NO_TOOL_CALL, error="", fullyIdle=true) — the
"would the session be allowed to stop right now" question. Provide --event
to inspect the decision under a different event. fullyIdle=false events are
rejected as out of scope: mid-run events are transient by definition.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[1]
HOOKS_DIR = ROOT / "hooks"

# Column widths keep every row single-line under narrow horizontal splits.
W_GATE, W_ROLE, W_ZEN, W_HOOK, W_WHY, W_EVID = 9, 10, 6, 8, 46, 34
GATE_LABELS = {
    "bulldozer": "primary",
    "piledriver": "primary",
    "excavator": "excavator",
}


def _load_hook(name: str):
    spec = importlib.util.spec_from_file_location(f"ntg_{name}", HOOKS_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_hooks():
    """Load both Stop-hook modules once. Reuse, not reimplementation."""
    return _load_hook("primary-review-gate"), _load_hook("excavator-review-gate")


def detect_gate(records: list[Any], event: dict[str, Any], primary_gate, excavator_gate) -> Optional[str]:
    if (
        excavator_gate.has_structured_excavator_identity(records)
        or excavator_gate.has_excavator_system_prompt(records)
        or excavator_gate.has_excavator_marker(records)
    ):
        return "excavator"
    return primary_gate.detect_primary_role(
        records, role_hint=event.get("roleHint") or event.get("agentName"))


def evaluate(records: list[Any], event: dict[str, Any], role: str, primary_gate, excavator_gate) -> dict[str, Any]:
    """Compute the row state for one armed gate.

    The decision and reason come from the hook's own decide() — the exact
    chain main() enforces — so the panel can only display the real verdict.
    """
    if role == "excavator":
        gate = excavator_gate
        zen_started, verdict, verdict_index, latest_change = gate.review_state(records)
        stale = bool(verdict_index >= 0 and latest_change > verdict_index)
    else:
        gate = primary_gate
        zen_started, verdict, request_index, verdict_index = gate.review_state(records)
        stale = False

    decision, reason = gate.decide(event, records)

    return {
        "gate": GATE_LABELS[role],
        "role": role,
        "zen": verdict or ("pending" if zen_started else "none"),
        "zen_verdict_index": verdict_index,
        "stale": stale,
        "decision": decision,
        "reason": reason,
        "constraint": reason or _fallback_reason(gate, event, verdict),
    }


def _fallback_reason(gate, event: dict[str, Any], verdict: Optional[str]) -> str:
    """Display-only label when the hook emits a bare stop with no reason.

    Bare stop covers several hook paths (abnormal event, no role, no READY);
    the label states what the panel can see without guessing which one fired.
    """
    reason = str(event.get("terminationReason") or "").strip().lower()
    if str(event.get("error") or "").strip() or reason not in gate.NORMAL_STOP_REASONS:
        return "(abnormal stop event; hook stops without gate review)"
    if verdict == "GO":
        return "VERDICT: GO observed"
    return "-"


def _clip(text: str, width: int) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= width else text[: width - 1] + "~"


def render(rows: list[dict[str, Any]], evidence: list[str]) -> str:
    header = (
        f"{'GATE':<{W_GATE}} {'ROLE':<{W_ROLE}} {'ZEN':<{W_ZEN}} "
        f"{'HOOK':<{W_HOOK}} {'CONSTRAINT':<{W_WHY}} {'EVIDENCE':<{W_EVID}}"
    )
    sep = "-" * len(header)
    lines = ["NTG GATE PANEL (read-only; state from transcripts, owned by the Stop hooks)", sep, header, sep]
    for row in rows:
        lines.append(
            f"{row['gate']:<{W_GATE}} {row['role']:<{W_ROLE}} {row['zen']:<{W_ZEN}} "
            f"{row['decision']:<{W_HOOK}} {_clip(row['constraint'], W_WHY):<{W_WHY}} "
            f"{_clip(row['evidence'], W_EVID):<{W_EVID}}"
        )
    lines.append(sep)
    lines.append("evidence: " + "; ".join(evidence))
    return "\n".join(lines)


def read_event(path: str) -> dict[str, Any]:
    try:
        event = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"gate-panel: cannot read --event {path}: {exc}")
    if not isinstance(event, dict):
        raise SystemExit(f"gate-panel: --event {path} is not a JSON object")
    return event


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="gate-panel",
        description="Render the NTG Zen/Stop-hook gate panel for transcript evidence.",
    )
    parser.add_argument("--transcript", action="append", default=[],
                        help="transcript.jsonl path (repeatable)")
    parser.add_argument("--event", default=None,
                        help="Stop-event JSON file; default synthesizes fullyIdle NO_TOOL_CALL")
    parser.add_argument("--json", action="store_true", help="emit machine-readable rows")
    args = parser.parse_args(argv)

    primary_gate, excavator_gate = load_hooks()

    event = read_event(args.event) if args.event else {}
    if not event.get("fullyIdle", True):
        raise SystemExit("gate-panel: fullyIdle=false events are out of scope (mid-run state is transient)")

    transcripts = list(args.transcript)
    if event.get("transcriptPath") and event["transcriptPath"] not in transcripts:
        transcripts.insert(0, event["transcriptPath"])
    if not transcripts:
        parser.error("at least one --transcript (or an --event with transcriptPath) is required")

    rows, evidence, payload = [], [], []
    for transcript_path in transcripts:
        path = Path(transcript_path)
        if not path.is_file():
            rows.append({
                "gate": "-", "role": "-", "zen": "-", "decision": "-",
                "constraint": "transcript not found", "evidence": transcript_path,
            })
            payload.append({"transcript": transcript_path, "error": "not found"})
            evidence.append(f"{transcript_path} (missing)")
            continue

        records = primary_gate.read_transcript(str(path))
        role = detect_gate(records, event, primary_gate, excavator_gate)
        if role is None:
            rows.append({
                "gate": "none", "role": "-", "zen": "n/a", "decision": "stop",
                "constraint": "no NTG gate owns this session", "evidence": path.name,
            })
            payload.append({"transcript": transcript_path, "gate": None, "decision": "stop"})
            evidence.append(f"{transcript_path} (no gated role detected)")
            continue

        per_transcript_event = dict(event)
        per_transcript_event.setdefault("terminationReason", "NO_TOOL_CALL")
        per_transcript_event.setdefault("error", "")
        per_transcript_event["transcriptPath"] = str(path)
        per_transcript_event.setdefault("fullyIdle", True)

        state = evaluate(records, per_transcript_event, role, primary_gate, excavator_gate)
        rows.append({
            "gate": state["gate"],
            "role": role,
            "zen": state["zen"],
            "decision": state["decision"],
            "constraint": state["constraint"],
            "evidence": path.name,
        })
        payload.append({
            "transcript": transcript_path, "gate": state["gate"], "role": role,
            "zen": state["zen"], "zen_verdict_index": state["zen_verdict_index"],
            "stale": state["stale"], "decision": state["decision"], "reason": state["reason"],
        })
        evidence.append(f"{transcript_path} ({role} gate records={len(records)})")

    if args.json:
        print(json.dumps({"event_assumed": event or {"terminationReason": "NO_TOOL_CALL",
                          "error": "", "fullyIdle": True}, "rows": payload}, indent=2))
    else:
        print(render(rows, evidence))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
