#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PANEL = ROOT / "scripts" / "gate_panel.py"


def run_panel(*cli_args, expect_ok=True):
    result = subprocess.run(
        [sys.executable, str(PANEL), *cli_args],
        text=True, capture_output=True,
    )
    if expect_ok:
        assert result.returncode == 0, f"panel failed: {result.stderr}"
    return result


def write_transcript(tmp, records, name="transcript.jsonl"):
    transcript = Path(tmp) / name
    transcript.write_text(
        "".join(json.dumps(r) + "\n" for r in records), encoding="utf-8"
    )
    return transcript


def identity(role):
    return {"agentName": role}


def assistant(text):
    return {"message": {"role": "assistant", "content": text}}


def ready_report():
    return assistant(
        "ROOT_CAUSE — CONFIRMED\nCHANGES — fixed\nVERIFICATION_EVIDENCE — tests passed\nREADY"
    )


def excavator_zen_call():
    return {
        "toolCall": {
            "name": "invoke_subagent",
            "args": {
                "Subagents": [{
                    "TypeName": "zen",
                    "Role": "independent completion reviewer",
                    "Prompt": "Review current artifact and return one verdict.",
                }]
            },
        }
    }


def tool_verdict(value="GO"):
    return {"message": {"role": "tool", "content": f"VERDICT: {value}"}}


def write_call():
    return {
        "toolCall": {
            "name": "replace_file_content",
            "args": {"TargetFile": "src/app.py"},
        }
    }


def excavator_go_records():
    return [
        identity("excavator"),
        excavator_zen_call(),
        tool_verdict("GO"),
        ready_report(),
    ]


class GatePanelRenderTests(unittest.TestCase):

    def test_excavator_go_renders_stop(self):
        with tempfile.TemporaryDirectory() as tmp:
            transcript = write_transcript(tmp, excavator_go_records())
            out = run_panel("--transcript", str(transcript)).stdout
        row = next(l for l in out.splitlines() if "excavator" in l)
        self.assertIn("GO", row)
        self.assertIn("stop", row)

    def test_excavator_post_go_mutation_is_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            transcript = write_transcript(tmp, [
                identity("excavator"), excavator_zen_call(), tool_verdict("GO"),
                write_call(), ready_report(),
            ])
            out = run_panel("--transcript", str(transcript)).stdout
            payload = json.loads(run_panel("--transcript", str(transcript), "--json").stdout)
        row = next(l for l in out.splitlines() if "excavator" in l)
        self.assertIn("continue", row)
        self.assertIn("predates", row)
        self.assertTrue(payload["rows"][0]["stale"])

    def test_ungated_transcript_renders_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            transcript = write_transcript(tmp, [identity("jaguar"), assistant("done")])
            out = run_panel("--transcript", str(transcript)).stdout
        row = next(l for l in out.splitlines() if "none" in l and "no NTG gate" in l)
        self.assertIn("none", row)

    def test_missing_transcript_reports_not_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = run_panel("--transcript", str(Path(tmp) / "nope.jsonl")).stdout
        self.assertIn("transcript not found", out)

    def test_multiple_transcripts_render_one_row_each(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = write_transcript(tmp, excavator_go_records(), "a.jsonl")
            b = write_transcript(tmp, [identity("jaguar"), assistant("done")], "b.jsonl")
            out = run_panel("--transcript", str(a), "--transcript", str(b)).stdout
        self.assertIn("excavator", out)
        self.assertIn("no NTG gate", out)

    def test_json_output_is_machine_readable(self):
        with tempfile.TemporaryDirectory() as tmp:
            transcript = write_transcript(tmp, excavator_go_records())
            out = run_panel("--transcript", str(transcript), "--json").stdout
        payload = json.loads(out)
        self.assertEqual(payload["rows"][0]["gate"], "excavator")
        self.assertEqual(payload["rows"][0]["zen"], "GO")
        self.assertEqual(payload["rows"][0]["decision"], "stop")

    def test_event_file_supplies_transcript_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            transcript = write_transcript(tmp, excavator_go_records())
            event = Path(tmp) / "event.json"
            event.write_text(json.dumps({
                "terminationReason": "NO_TOOL_CALL", "error": "",
                "fullyIdle": True, "transcriptPath": str(transcript),
            }), encoding="utf-8")
            out = run_panel("--event", str(event)).stdout
        self.assertIn("excavator", out)
        self.assertIn("GO", out)

    def test_non_idle_event_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            transcript = write_transcript(tmp, excavator_go_records())
            event = Path(tmp) / "event.json"
            event.write_text(json.dumps({
                "terminationReason": "NO_TOOL_CALL", "error": "",
                "fullyIdle": False, "transcriptPath": str(transcript),
            }), encoding="utf-8")
            result = run_panel("--event", str(event), expect_ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("fullyIdle=false", result.stderr)

    def test_no_inputs_is_usage_error(self):
        result = run_panel(expect_ok=False)
        self.assertNotEqual(result.returncode, 0)


class GatePanelConsistencyTests(unittest.TestCase):

    def _hook_result(self, hook_path, event):
        result = subprocess.run(
            [sys.executable, str(hook_path)],
            input=json.dumps(event), text=True, capture_output=True, check=True,
        )
        return json.loads(result.stdout)

    def _run_hook(self, hook_path, transcript):
        event = {
            "terminationReason": "NO_TOOL_CALL", "error": "",
            "fullyIdle": True, "transcriptPath": str(transcript),
        }
        return self._hook_result(hook_path, event)["decision"]

    def _assert_hook_parity(self, tmp, hook_name, records, event=None):
        """Run the real hook and the panel on the same stop event; assert parity.

        The panel answers "what would the Stop hook decide for this session" —
        every divergence is a correctness bug, so decision and (when emitted)
        reason must be identical.
        """
        transcript = write_transcript(tmp, records)
        stop_event = {
            "terminationReason": "NO_TOOL_CALL", "error": "",
            "fullyIdle": True, "transcriptPath": str(transcript),
        }
        if event:
            stop_event.update(event)
        hook = self._hook_result(ROOT / "hooks" / hook_name, stop_event)
        event_path = Path(tmp) / "event.json"
        event_path.write_text(json.dumps(stop_event), encoding="utf-8")
        payload = json.loads(run_panel("--event", str(event_path), "--json").stdout)
        row = payload["rows"][0]
        self.assertEqual(hook["decision"], row["decision"])
        if "reason" in hook:
            self.assertEqual(hook["reason"], row["reason"])
        return row

    def test_abnormal_events_match_hooks(self):
        with tempfile.TemporaryDirectory() as tmp:
            for records, extra in (
                ([identity("excavator"), ready_report()], {"error": "boom"}),
                ([identity("excavator"), ready_report()], {"terminationReason": "MAX_STEPS"}),
            ):
                row = self._assert_hook_parity(
                    tmp, "excavator-review-gate.py", records, event=extra)
                self.assertEqual("stop", row["decision"])

    def test_excavator_decision_matches_excavator_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            for records in (excavator_go_records(),
                            [identity("excavator"), excavator_zen_call(),
                             tool_verdict("GO"), write_call(), ready_report()]):
                transcript = write_transcript(tmp, records)
                hook = self._run_hook(ROOT / "hooks" / "excavator-review-gate.py", transcript)
                out = run_panel("--transcript", str(transcript)).stdout
                row = next(l for l in out.splitlines() if "excavator" in l)
                self.assertIn(f" {hook} ", f" {row} ")


if __name__ == "__main__":
    unittest.main()
