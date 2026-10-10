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
ZEN_ID = "9fc98728-eb32-45d5-a643-2809d0e0d5f4"


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


def plan_ready_report():
    return assistant("All checks recorded.\nPLAN READY")


def primary_zen_call():
    return {
        "step_index": 1,
        "source": "MODEL",
        "type": "PLANNER_RESPONSE",
        "status": "DONE",
        "tool_calls": [{
            "name": "invoke_subagent",
            "args": {"Subagents": json.dumps([{
                "TypeName": "zen",
                "Role": "independent completion reviewer",
                "Prompt": "Review and return VERDICT: GO or VERDICT: NO-GO.",
            }])},
        }],
    }


def primary_zen_created(conv_id=ZEN_ID):
    return {
        "step_index": 2,
        "source": "MODEL",
        "type": "GENERIC",
        "status": "DONE",
        "content": (
            'Created At: now\nCompleted At: now\nCreated the following subagents:\n'
            '{\n'
            f'  "conversationId": "{conv_id}",\n'
            '  "logAbsoluteUri": "file:///tmp/zen.jsonl"\n'
            "}\nThe subagents will send you a message when they have completed their task."
        ),
    }


def primary_provider_verdict(value="GO", sender=ZEN_ID):
    return {
        "step_index": 3,
        "source": "SYSTEM",
        "type": "SYSTEM_MESSAGE",
        "status": "DONE",
        "content": (
            "The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n"
            "<SYSTEM_MESSAGE>\n"
            f"[Message] timestamp=now sender={sender} priority=MESSAGE_PRIORITY_HIGH content=VERDICT: {value}\n"
            "</SYSTEM_MESSAGE>"
        ),
    }


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


def bulldozer_go_records():
    return [
        identity("bulldozer"),
        primary_zen_call(),
        primary_zen_created(),
        primary_provider_verdict("GO"),
        ready_report(),
    ]


def excavator_go_records():
    return [
        identity("excavator"),
        excavator_zen_call(),
        tool_verdict("GO"),
        ready_report(),
    ]


class GatePanelRenderTests(unittest.TestCase):

    def test_bulldozer_go_renders_stop_with_verdict(self):
        with tempfile.TemporaryDirectory() as tmp:
            transcript = write_transcript(tmp, bulldozer_go_records())
            out = run_panel("--transcript", str(transcript)).stdout
        self.assertIn("NTG GATE PANEL", out)
        self.assertIn("GATE", out)
        row = next(l for l in out.splitlines() if "bulldozer" in l)
        self.assertIn("primary", row)
        self.assertIn("GO", row)
        self.assertIn("stop", row)
        self.assertIn("VERDICT: GO", row)
        self.assertIn(transcript.name, out)

    def test_bulldozer_no_go_renders_continue(self):
        with tempfile.TemporaryDirectory() as tmp:
            records = bulldozer_go_records()
            records[3] = primary_provider_verdict("NO-GO")
            transcript = write_transcript(tmp, records)
            out = run_panel("--transcript", str(transcript)).stdout
        row = next(l for l in out.splitlines() if "bulldozer" in l)
        self.assertIn("NO-GO", row)
        self.assertIn("continue", row)

    def test_bulldozer_ready_without_zen_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            transcript = write_transcript(tmp, [identity("bulldozer"), ready_report()])
            out = run_panel("--transcript", str(transcript)).stdout
            payload = json.loads(run_panel("--transcript", str(transcript), "--json").stdout)
        row = next(l for l in out.splitlines() if "bulldozer" in l)
        self.assertIn("none", row)
        self.assertIn("continue", row)
        self.assertIn("Zen", payload["rows"][0]["reason"])

    def test_piledriver_plan_ready_go_renders_stop(self):
        with tempfile.TemporaryDirectory() as tmp:
            transcript = write_transcript(tmp, [
                identity("piledriver"), primary_zen_call(), primary_zen_created(),
                primary_provider_verdict("GO"), plan_ready_report(),
            ])
            out = run_panel("--transcript", str(transcript)).stdout
        row = next(l for l in out.splitlines() if "piledriver" in l)
        self.assertIn("primary", row)
        self.assertIn("GO", row)
        self.assertIn("stop", row)

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
            a = write_transcript(tmp, bulldozer_go_records(), "a.jsonl")
            b = write_transcript(tmp, excavator_go_records(), "b.jsonl")
            out = run_panel("--transcript", str(a), "--transcript", str(b)).stdout
        self.assertIn("bulldozer", out)
        self.assertIn("excavator", out)

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
            transcript = write_transcript(tmp, bulldozer_go_records())
            event = Path(tmp) / "event.json"
            event.write_text(json.dumps({
                "terminationReason": "NO_TOOL_CALL", "error": "",
                "fullyIdle": True, "transcriptPath": str(transcript),
            }), encoding="utf-8")
            out = run_panel("--event", str(event)).stdout
        self.assertIn("bulldozer", out)
        self.assertIn("GO", out)

    def test_non_idle_event_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            transcript = write_transcript(tmp, bulldozer_go_records())
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

    def test_pending_zen_review_matches_primary_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            for records in (
                [identity("bulldozer"), primary_zen_call(), primary_zen_created(),
                 assistant("still working on it")],
                [identity("bulldozer"), primary_zen_call(), primary_zen_created(),
                 ready_report()],
                [identity("piledriver"), primary_zen_call(), primary_zen_created(),
                 plan_ready_report()],
            ):
                row = self._assert_hook_parity(tmp, "primary-review-gate.py", records)
                self.assertEqual("continue", row["decision"])

    def test_role_hint_event_matches_primary_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            row = self._assert_hook_parity(
                tmp, "primary-review-gate.py", [ready_report()],
                event={"roleHint": "bulldozer"})
            self.assertEqual("bulldozer", row["role"])
            self.assertEqual("continue", row["decision"])

    def test_agent_name_event_matches_primary_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            row = self._assert_hook_parity(
                tmp, "primary-review-gate.py", [plan_ready_report()],
                event={"agentName": "piledriver"})
            self.assertEqual("piledriver", row["role"])
            self.assertEqual("continue", row["decision"])

    def test_abnormal_events_match_hooks(self):
        with tempfile.TemporaryDirectory() as tmp:
            for hook_name, records, extra in (
                ("primary-review-gate.py",
                 [identity("bulldozer"), ready_report()], {"error": "boom"}),
                ("primary-review-gate.py",
                 [identity("bulldozer"), ready_report()],
                 {"terminationReason": "MAX_STEPS"}),
                ("excavator-review-gate.py",
                 [identity("excavator"), ready_report()], {"error": "boom"}),
                ("excavator-review-gate.py",
                 [identity("excavator"), ready_report()],
                 {"terminationReason": "MAX_STEPS"}),
            ):
                row = self._assert_hook_parity(tmp, hook_name, records, event=extra)
                self.assertEqual("stop", row["decision"])

    def test_bulldozer_decision_matches_primary_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            for records in (bulldozer_go_records(),
                            [identity("bulldozer"), ready_report()]):
                transcript = write_transcript(tmp, records)
                hook = self._run_hook(ROOT / "hooks" / "primary-review-gate.py", transcript)
                out = run_panel("--transcript", str(transcript)).stdout
                row = next(l for l in out.splitlines() if "bulldozer" in l)
                self.assertIn(f" {hook} ", f" {row} ")

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
