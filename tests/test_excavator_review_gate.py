#!/usr/bin/env python3
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / "hooks" / "excavator-review-gate.py"


def run_gate(records, *, fully_idle=True, termination_reason="NO_TOOL_CALL", error=""):
    with tempfile.TemporaryDirectory() as tmp:
        transcript = Path(tmp) / "transcript.jsonl"
        transcript.write_text(
            "".join(json.dumps(record) + "\n" for record in records),
            encoding="utf-8",
        )
        event = {
            "executionNum": 0,
            "terminationReason": termination_reason,
            "error": error,
            "fullyIdle": fully_idle,
            "transcriptPath": str(transcript),
        }
        result = subprocess.run(
            [sys.executable, str(GATE)],
            input=json.dumps(event),
            text=True,
            capture_output=True,
            check=True,
        )
        return json.loads(result.stdout)


def ready_report():
    return {
        "message": {
            "role": "assistant",
            "content": (
                "ROOT_CAUSE — CONFIRMED\n"
                "CHANGES — fixed\n"
                "VERIFICATION_EVIDENCE — tests passed\n"
                "READY"
            ),
        }
    }


def blocked_report():
    return {
        "message": {
            "role": "assistant",
            "content": (
                "ROOT_CAUSE — LIKELY\n"
                "CHANGES — none\n"
                "VERIFICATION_EVIDENCE — unavailable\n"
                "BLOCKED"
            ),
        }
    }


def zen_call():
    return {
        "toolCall": {
            "name": "invoke_subagent",
            "args": {
                "Subagents": [
                    {
                        "TypeName": "zen",
                        "Role": "independent completion reviewer",
                        "Prompt": "Review current artifact and return one verdict.",
                    }
                ]
            },
        }
    }


def verdict(value):
    return {"message": {"role": "tool", "content": f"VERDICT: {value}"}}


def write_call():
    return {
        "toolCall": {
            "name": "replace_file_content",
            "args": {"TargetFile": "src/app.py"},
        }
    }


def excavator_shell(command="git status --short"):
    return {
        "toolCall": {
            "name": "run_command",
            "args": {"CommandLine": "NTG_EXCAVATOR=1 " + command},
        }
    }


def progress_update():
    return {
        "message": {
            "role": "assistant",
            "content": (
                "Still investigating the dispatch path. Found 2 of 4 expected "
                "config layers so far. Continuing to inspect the remaining sources."
            ),
        }
    }


def user_input_request():
    return {
        "message": {
            "role": "assistant",
            "content": (
                "The repair requires choosing between two viable approaches. "
                "Which direction should I take: option A (minimal patch) or "
                "option B (refactor the resolver)?"
            ),
        }
    }


def not_ready_statement():
    return {
        "message": {
            "role": "assistant",
            "content": "Not READY yet. Still waiting for test results.",
        }
    }


def ready_in_explanation():
    return {
        "message": {
            "role": "assistant",
            "content": (
                "The task is not complete. Before we can declare READY, "
                "we need to confirm the root cause with direct evidence "
                "and obtain a Zen VERDICT: GO on the current artifact."
            ),
        }
    }


def ready_in_progress_sentence():
    return {
        "message": {
            "role": "assistant",
            "content": (
                "Progress: verified 3 of 4 acceptance criteria. "
                "The fourth requires a live endpoint check; "
                "READY cannot be claimed until that succeeds."
            ),
        }
    }


def status_ready_report():
    return {
        "message": {
            "role": "assistant",
            "content": (
                "ROOT_CAUSE — CONFIRMED\n"
                "CHANGES — fixed\n"
                "VERIFICATION_EVIDENCE — tests passed\n"
                "ZEN_VERDICT — VERDICT: GO\n"
                "STATUS: READY"
            ),
        }
    }


class ExcavatorReviewGateTests(unittest.TestCase):
    def test_non_excavator_session_is_unaffected(self):
        result = run_gate([{"agentName": "bulldozer"}, ready_report()])
        self.assertEqual(result["decision"], "stop")

    def test_system_prompt_scopes_excavator_without_identity_field(self):
        result = run_gate(
            [
                {
                    "role": "system",
                    "content": "You are Excavator, Native Gravity's autonomous troubleshooting primary agent.",
                },
                ready_report(),
            ]
        )
        self.assertEqual(result["decision"], "continue")

    def test_blocked_excavator_may_stop_without_review(self):
        result = run_gate([{"agentName": "excavator"}, blocked_report()])
        self.assertEqual(result["decision"], "stop")

    def test_ready_without_zen_review_is_forced_to_continue(self):
        result = run_gate([{"agentName": "excavator"}, ready_report()])
        self.assertEqual(result["decision"], "continue")
        self.assertIn("Zen", result["reason"])

    def test_marker_scopes_excavator_when_agent_identity_is_absent(self):
        result = run_gate([excavator_shell("pytest -q"), ready_report()])
        self.assertEqual(result["decision"], "continue")

    def test_zen_go_allows_ready(self):
        result = run_gate(
            [{"agentName": "excavator"}, write_call(), zen_call(), verdict("GO"), ready_report()]
        )
        self.assertEqual(result["decision"], "stop")

    def test_zen_no_go_forces_correction(self):
        result = run_gate(
            [{"agentName": "excavator"}, zen_call(), verdict("NO-GO"), ready_report()]
        )
        self.assertEqual(result["decision"], "continue")
        self.assertIn("NO-GO", result["reason"])

    def test_new_zen_invocation_invalidates_older_go_until_fresh_verdict(self):
        result = run_gate(
            [
                {"agentName": "excavator"},
                zen_call(),
                verdict("GO"),
                zen_call(),
                ready_report(),
            ]
        )
        self.assertEqual(result["decision"], "continue")

    def test_material_write_after_go_requires_fresh_review(self):
        result = run_gate(
            [
                {"agentName": "excavator"},
                zen_call(),
                verdict("GO"),
                write_call(),
                ready_report(),
            ]
        )
        self.assertEqual(result["decision"], "continue")
        self.assertIn("later Excavator write", result["reason"])

    def test_marked_shell_after_go_requires_fresh_review(self):
        result = run_gate(
            [
                {"agentName": "excavator"},
                zen_call(),
                verdict("GO"),
                excavator_shell(),
                ready_report(),
            ]
        )
        self.assertEqual(result["decision"], "continue")
        self.assertIn("marked shell", result["reason"])

    def test_fresh_go_after_material_write_allows_ready(self):
        result = run_gate(
            [
                {"agentName": "excavator"},
                zen_call(),
                verdict("GO"),
                write_call(),
                zen_call(),
                verdict("GO"),
                ready_report(),
            ]
        )
        self.assertEqual(result["decision"], "stop")

    def test_non_idle_excavator_waits(self):
        result = run_gate(
            [{"agentName": "excavator"}, zen_call(), ready_report()],
            fully_idle=False,
        )
        self.assertEqual(result["decision"], "continue")
        self.assertIn("background", result["reason"])

    def test_abnormal_termination_does_not_create_stop_loop(self):
        result = run_gate(
            [{"agentName": "excavator"}, ready_report()],
            termination_reason="error",
            error="boom",
        )
        self.assertEqual(result["decision"], "stop")

    def test_excavator_progress_update_without_ready_may_stop(self):
        result = run_gate(
            [{"agentName": "excavator"}, progress_update()],
        )
        self.assertEqual(result["decision"], "stop")

    def test_excavator_user_input_request_without_ready_may_stop(self):
        result = run_gate(
            [{"agentName": "excavator"}, user_input_request()],
        )
        self.assertEqual(result["decision"], "stop")

    def test_excavator_mid_investigation_stop_may_proceed(self):
        result = run_gate(
            [
                {"agentName": "excavator"},
                excavator_shell("grep -r 'dispatch' src/"),
                progress_update(),
            ],
        )
        self.assertEqual(result["decision"], "stop")

    def test_not_ready_yet_is_not_completion_attempt(self):
        result = run_gate(
            [{"agentName": "excavator"}, not_ready_statement()],
        )
        self.assertEqual(result["decision"], "stop")

    def test_ready_in_explanation_sentence_is_not_attempt(self):
        result = run_gate(
            [{"agentName": "excavator"}, ready_in_explanation()],
        )
        self.assertEqual(result["decision"], "stop")

    def test_ready_in_progress_report_is_not_attempt(self):
        result = run_gate(
            [{"agentName": "excavator"}, ready_in_progress_sentence()],
        )
        self.assertEqual(result["decision"], "stop")

    def test_past_ready_followed_by_progress_update_may_stop(self):
        result = run_gate(
            [
                {"agentName": "excavator"},
                ready_report(),
                progress_update(),
            ],
        )
        self.assertEqual(result["decision"], "stop")

    def test_past_ready_followed_by_user_input_request_may_stop(self):
        result = run_gate(
            [
                {"agentName": "excavator"},
                ready_report(),
                user_input_request(),
            ],
        )
        self.assertEqual(result["decision"], "stop")

    def test_status_ready_is_completion_attempt(self):
        result = run_gate(
            [{"agentName": "excavator"}, status_ready_report()],
        )
        self.assertEqual(result["decision"], "continue")
        self.assertIn("Zen", result["reason"])

    def test_status_ready_with_zen_go_allows_stop(self):
        result = run_gate(
            [
                {"agentName": "excavator"},
                zen_call(),
                verdict("GO"),
                status_ready_report(),
            ]
        )
        self.assertEqual(result["decision"], "stop")


if __name__ == "__main__":
    unittest.main()
