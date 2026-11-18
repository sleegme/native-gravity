#!/usr/bin/env python3
"""Unit tests for observation-first telemetry guard (hooks/telemetry-guard.py)."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "hooks" / "telemetry-guard.py"


def run_telemetry(payload, env, session_start=False):
    args = [sys.executable, str(GUARD)] + (["--session-start"] if session_start else [])
    merged_env = dict(os.environ)
    merged_env.update(env)
    proc = subprocess.run(
        args,
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        timeout=5,
        check=True,
        env=merged_env,
    )
    if proc.stderr:
        raise AssertionError(proc.stderr)
    return json.loads(proc.stdout)


class ObservationFirstTelemetryTests(unittest.TestCase):
    def test_high_call_count_without_stagnation_never_blocks(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "telemetry.jsonl"
            state_dir = Path(tmp) / "state"
            env = {
                "NTG_SUPERVISOR_PID": "12345",
                "NTG_ACTIVE_ROLE": "bulldozer",
                "NTG_TELEMETRY_LOG": str(log_path),
                "NTG_TELEMETRY_STATE_DIR": str(state_dir),
            }
            start = run_telemetry({"conversationId": "conv-1", "cwd": tmp}, env, session_start=True)
            self.assertEqual(start, {})

            # 250 varied read/tool calls (well above legacy 140/90/12 count caps) are all allowed
            for idx in range(250):
                res = run_telemetry(
                    {
                        "conversationId": "conv-1",
                        "cwd": tmp,
                        "toolCall": {"name": "view_file", "args": {"Path": f"src/file_{idx}.mjs"}},
                    },
                    env,
                )
                self.assertEqual(res["decision"], "allow")

            records = [json.loads(line) for line in log_path.read_text().splitlines() if line.strip()]
            self.assertEqual(len(records), 251)  # 1 session_start + 250 observations
            self.assertEqual(records[-1]["total_calls"], 250)

    def test_repeated_calls_with_novelty_state_change_or_post_failure_retry_stay_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "telemetry.jsonl"
            state_dir = Path(tmp) / "state"
            env = {
                "NTG_SUPERVISOR_PID": "12345",
                "NTG_ACTIVE_ROLE": "bobcat",
                "NTG_TELEMETRY_LOG": str(log_path),
                "NTG_TELEMETRY_STATE_DIR": str(state_dir),
            }
            payload_base = {
                "conversationId": "conv-2",
                "cwd": tmp,
                "toolCall": {"name": "run_command", "args": {"CommandLine": "node --test tests/a.mjs"}},
            }
            for telemetry in [
                {"output_novelty": True, "workspace_state_changed": False, "task_progress_advancing": True},
                {"output_novelty": False, "workspace_state_changed": True, "task_progress_advancing": True},
                {"output_novelty": False, "workspace_state_changed": False, "post_failure_or_edit_retry": True},
            ]:
                res = run_telemetry({**payload_base, "telemetry": telemetry}, env)
                self.assertEqual(res["decision"], "allow")

    def test_confirmed_non_progressing_identical_loop_triggers_minimal_intervention(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "telemetry.jsonl"
            state_dir = Path(tmp) / "state"
            env = {
                "NTG_SUPERVISOR_PID": "12345",
                "NTG_ACTIVE_ROLE": "bulldozer",
                "NTG_TELEMETRY_LOG": str(log_path),
                "NTG_TELEMETRY_STATE_DIR": str(state_dir),
            }
            stagnant = {
                "conversationId": "conv-3",
                "cwd": tmp,
                "toolCall": {"name": "view_file", "args": {"Path": "src/same.mjs"}},
                "telemetry": {
                    "output_novelty": False,
                    "workspace_state_changed": False,
                    "task_progress_advancing": False,
                    "post_failure_or_edit_retry": False,
                },
            }
            self.assertEqual(run_telemetry(stagnant, env)["decision"], "allow")
            self.assertEqual(run_telemetry(stagnant, env)["decision"], "allow")
            res3 = run_telemetry(stagnant, env)
            self.assertEqual(res3["decision"], "deny")
            self.assertIn("non-progressing identical loop", res3["reason"])

    def test_ambient_pretooluse_resets_stagnation_on_edit_or_workspace_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            repo.mkdir()
            subprocess.run(["git", "init"], cwd=str(repo), check=True, capture_output=True)
            subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=str(repo), check=True, capture_output=True)
            subprocess.run(["git", "config", "user.name", "Test"], cwd=str(repo), check=True, capture_output=True)
            target = repo / "app.mjs"
            target.write_text("export const x = 1;\n", encoding="utf-8")
            subprocess.run(["git", "add", "app.mjs"], cwd=str(repo), check=True, capture_output=True)
            subprocess.run(["git", "commit", "-m", "init"], cwd=str(repo), check=True, capture_output=True)

            log_path = Path(tmp) / "telemetry.jsonl"
            state_dir = Path(tmp) / "state"
            env = {
                "NTG_SUPERVISOR_PID": "12345",
                "NTG_ACTIVE_ROLE": "bobcat",
                "NTG_TELEMETRY_LOG": str(log_path),
                "NTG_TELEMETRY_STATE_DIR": str(state_dir),
            }
            status_payload = {
                "conversationId": "conv-ambient",
                "cwd": str(repo),
                "toolCall": {"name": "run_command", "args": {"CommandLine": "git status --short"}},
            }
            write_payload = {
                "conversationId": "conv-ambient",
                "cwd": str(repo),
                "toolCall": {"name": "write_file", "args": {"Path": str(target)}},
            }

            self.assertEqual(run_telemetry(status_payload, env)["decision"], "allow")
            self.assertEqual(run_telemetry(status_payload, env)["decision"], "allow")
            self.assertEqual(run_telemetry(status_payload, env)["decision"], "allow")

            # Intervening edit tool resets stagnation and allows subsequent identical test/status runs
            self.assertEqual(run_telemetry(write_payload, env)["decision"], "allow")
            self.assertEqual(run_telemetry(status_payload, env)["decision"], "allow")
            self.assertEqual(run_telemetry(status_payload, env)["decision"], "allow")

            # Actual workspace file change resets stagnation even on further identical status calls
            target.write_text("export const x = 2;\n", encoding="utf-8")
            self.assertEqual(run_telemetry(status_payload, env)["decision"], "allow")
            target.write_text("export const x = 3;\nexport const y = 4;\n", encoding="utf-8")
            self.assertEqual(run_telemetry(status_payload, env)["decision"], "allow")
            target.write_text("export const x = 4;\nexport const y = 5;\nexport const z = 6;\n", encoding="utf-8")
            self.assertEqual(run_telemetry(status_payload, env)["decision"], "allow")

            # Ambient identical PreToolUse read calls WITHOUT observed output never block by count alone (#236)
            read_payload = {
                "conversationId": "conv-ambient-read",
                "cwd": str(repo),
                "toolCall": {"name": "view_file", "args": {"Path": str(target)}},
            }
            for _ in range(5):
                res = run_telemetry(read_payload, env)
                self.assertEqual(res["decision"], "allow")

    def test_post_tool_use_varying_vs_identical_outputs_and_retries(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            repo.mkdir()
            subprocess.run(["git", "init"], cwd=str(repo), check=True, capture_output=True)
            subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=str(repo), check=True, capture_output=True)
            subprocess.run(["git", "config", "user.name", "Test"], cwd=str(repo), check=True, capture_output=True)
            target = repo / "app.mjs"
            target.write_text("export const x = 1;\n", encoding="utf-8")
            subprocess.run(["git", "add", "app.mjs"], cwd=str(repo), check=True, capture_output=True)
            subprocess.run(["git", "commit", "-m", "init"], cwd=str(repo), check=True, capture_output=True)

            log_path = Path(tmp) / "telemetry.jsonl"
            state_dir = Path(tmp) / "state"
            env = {
                "NTG_SUPERVISOR_PID": "12345",
                "NTG_ACTIVE_ROLE": "bobcat",
                "NTG_TELEMETRY_LOG": str(log_path),
                "NTG_TELEMETRY_STATE_DIR": str(state_dir),
            }

            # 1. Identical args with different observed outputs -> always allow (#236 case 1)
            varying_call = {
                "conversationId": "conv-vary",
                "cwd": str(repo),
                "toolCall": {"name": "run_command", "args": {"CommandLine": "tail -n 5 app.log"}},
            }
            for i in range(6):
                self.assertEqual(run_telemetry(varying_call, env)["decision"], "allow")
                res_post = subprocess.run(
                    [sys.executable, str(GUARD), "--post-tool-use"],
                    input=json.dumps({**varying_call, "toolResult": {"output": f"tick {i}"}}),
                    text=True,
                    capture_output=True,
                    timeout=5,
                    check=True,
                    env={**os.environ, **env},
                )
                self.assertEqual(json.loads(res_post.stdout), {})

            # 2. Identical args + identical observed output + no progress -> bounded deny (#236 case 2)
            stagnant_cmd = {
                "conversationId": "conv-same-out",
                "cwd": str(repo),
                "toolCall": {"name": "view_file", "args": {"Path": str(target)}},
            }
            for attempt in range(3):
                self.assertEqual(run_telemetry(stagnant_cmd, env)["decision"], "allow")
                subprocess.run(
                    [sys.executable, str(GUARD), "--post-tool-use"],
                    input=json.dumps({**stagnant_cmd, "toolResult": {"output": "export const x = 1;\n"}}),
                    text=True,
                    capture_output=True,
                    timeout=5,
                    check=True,
                    env={**os.environ, **env},
                )
            res_deny = run_telemetry(stagnant_cmd, env)
            self.assertEqual(res_deny["decision"], "deny")
            self.assertIn("non-progressing identical loop", res_deny["reason"])

            # 3. Edit right after stagnant streak allows re-verification of identical call (#236 case 4)
            edit_call = {
                "conversationId": "conv-same-out",
                "cwd": str(repo),
                "toolCall": {"name": "edit_file", "args": {"Path": str(target)}},
            }
            self.assertEqual(run_telemetry(edit_call, env)["decision"], "allow")
            target.write_text("export const x = 2;\n", encoding="utf-8")
            subprocess.run(
                [sys.executable, str(GUARD), "--post-tool-use"],
                input=json.dumps({**edit_call, "toolResult": {"ok": True}}),
                text=True,
                capture_output=True,
                timeout=5,
                check=True,
                env={**os.environ, **env},
            )
            self.assertEqual(run_telemetry(stagnant_cmd, env)["decision"], "allow")

            # 4. Legitimate retry right after tool failure stays allowed (#236 case 5)
            fail_cmd = {
                "conversationId": "conv-fail-retry",
                "cwd": str(repo),
                "toolCall": {"name": "run_command", "args": {"CommandLine": "node --test"}},
            }
            for _ in range(4):
                self.assertEqual(run_telemetry(fail_cmd, env)["decision"], "allow")
                subprocess.run(
                    [sys.executable, str(GUARD), "--post-tool-use"],
                    input=json.dumps({**fail_cmd, "toolResult": {"exitCode": 1, "output": "test failed"}}),
                    text=True,
                    capture_output=True,
                    timeout=5,
                    check=True,
                    env={**os.environ, **env},
                )

    def test_hooks_json_drops_budget_guard_and_registers_telemetry_guard(self):
        config = json.loads((ROOT / "hooks.json").read_text())
        self.assertNotIn("role-budget-boundary", config)
        self.assertIn("observation-telemetry-boundary", config)
        boundary = config["observation-telemetry-boundary"]
        self.assertIn("telemetry-guard.py --session-start", boundary["SessionStart"][0]["command"])
        self.assertIn("telemetry-guard.py", boundary["PreToolUse"][0]["hooks"][0]["command"])
        self.assertIn("PostToolUse", boundary)
        self.assertIn("telemetry-guard.py --post-tool-use", boundary["PostToolUse"][0]["hooks"][0]["command"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
