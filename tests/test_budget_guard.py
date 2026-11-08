#!/usr/bin/env python3
"""Unit tests for budget-guard (Stage 1, §2.6.2) and hooks.json registration."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "hooks" / "budget-guard.py"
SUPERVISOR_MARKER = "NTG_SUPERVISOR_PID"
STATE_DIR_ENV = "NTG_BUDGET_STATE_DIR"
ROOT_FILE_ENV = "NTG_BUDGET_ROOT_FILE"
SALVAGE_MARKER = "NTG_SALVAGE"
ROOT_CONVERSATION = "28cef410-65b7-4009-858a-3dc9fe05c53a"
CHILD_CONVERSATION = "bf1327b8-1285-4ddd-a6c5-36633861e359"
SECOND_CHILD = "0f1e2d3c-4b5a-4958-8776-655443332211"

GUARD_ENV_KEYS = {
    "NTG_BUDGET_MAX_CALLS",
    "NTG_BUDGET_MAX_SPAWN_CALLS",
    "NTG_BUDGET_ROOT_MAX_CALLS",
    "NTG_BUDGET_ROOT_MAX_READ_CALLS",
    "NTG_BUDGET_ROOT_MAX_SPAWN_CALLS",
}


def clean_env():
    env = os.environ.copy()
    for key in [SUPERVISOR_MARKER, STATE_DIR_ENV, ROOT_FILE_ENV, SALVAGE_MARKER, *GUARD_ENV_KEYS, "NTG_BUDGET_MAX_READ_CALLS"]:
        env.pop(key, None)
    return env


def run_payload(payload, env=None, args=()):
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    current_env = clean_env()
    if env is not None:
        current_env.update(env)
    result = subprocess.run(
        [sys.executable, str(GUARD), *args],
        input=raw,
        text=True,
        capture_output=True,
        timeout=5,
        check=True,
        env=current_env,
    )
    if result.stderr:
        raise AssertionError(f"Unexpected stderr: {result.stderr}")
    return json.loads(result.stdout)


def tool_payload(tool_name, conversation=ROOT_CONVERSATION):
    return {
        "toolCall": {"name": tool_name, "args": {}},
        "stepIdx": 0,
        "conversationId": conversation,
    }


def session_start(conversation, env):
    return run_payload({"conversationId": conversation}, env, ("--session-start",))


class BudgetGuardTests(unittest.TestCase):
    def test_inactive_without_supervisor_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            result = run_payload(tool_payload("view_file"), env={
                STATE_DIR_ENV: directory,
            })
            self.assertEqual(result["decision"], "allow")

    def test_active_without_state_dir_allows_uncounted(self):
        result = run_payload(tool_payload("view_file"), env={
            SUPERVISOR_MARKER: "1",
        })
        self.assertEqual(result["decision"], "allow")

    def test_root_total_cap_denies_with_wrap_up_message(self):
        with tempfile.TemporaryDirectory() as directory:
            binding = Path(directory) / "root"
            env = {SUPERVISOR_MARKER: "1", STATE_DIR_ENV: directory,
                   ROOT_FILE_ENV: str(binding), "NTG_BUDGET_ROOT_MAX_CALLS": "2"}
            self.assertEqual(session_start(ROOT_CONVERSATION, env), {})
            for _ in range(2):
                self.assertEqual(run_payload(tool_payload("grep_search"), env)["decision"], "allow")
            denied = run_payload(tool_payload("grep_search"), env)
            self.assertEqual(denied["decision"], "deny")
            self.assertIn("calls", denied["reason"])
            self.assertIn("UNKNOWN", denied["reason"])

    def test_root_read_cap_tighter_than_child_uniform_caps(self):
        with tempfile.TemporaryDirectory() as directory:
            binding = Path(directory) / "root"
            env = {SUPERVISOR_MARKER: "1", STATE_DIR_ENV: directory,
                   ROOT_FILE_ENV: str(binding),
                   "NTG_BUDGET_ROOT_MAX_READ_CALLS": "1",
                   "NTG_BUDGET_MAX_READ_CALLS": "5"}
            self.assertEqual(session_start(ROOT_CONVERSATION, env), {})
            self.assertEqual(run_payload(tool_payload("view_file"), env)["decision"], "allow")
            denied = run_payload(tool_payload("view_file"), env)
            self.assertEqual(denied["decision"], "deny")
            self.assertIn("reads", denied["reason"])
            # A child conversation has its own counters and no root read cap.
            self.assertEqual(run_payload(tool_payload("view_file", CHILD_CONVERSATION), env)["decision"], "allow")

    def test_spawn_cap_denies_second_invoke_subagent(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {SUPERVISOR_MARKER: "1", STATE_DIR_ENV: directory,
                   "NTG_BUDGET_MAX_SPAWN_CALLS": "1"}
            self.assertEqual(run_payload(tool_payload("invoke_subagent", CHILD_CONVERSATION), env)["decision"], "allow")
            denied = run_payload(tool_payload("invoke_subagent", CHILD_CONVERSATION), env)
            self.assertEqual(denied["decision"], "deny")
            self.assertIn("spawns", denied["reason"])

    def test_root_binding_first_writer_wins(self):
        with tempfile.TemporaryDirectory() as directory:
            binding = Path(directory) / "root"
            env = {SUPERVISOR_MARKER: "1", STATE_DIR_ENV: directory, ROOT_FILE_ENV: str(binding)}
            self.assertEqual(session_start(ROOT_CONVERSATION, env), {})
            self.assertEqual(session_start(CHILD_CONVERSATION, env), {})
            self.assertEqual(binding.read_text(), ROOT_CONVERSATION)
            # The late-starting child never gets root caps even without a root cap set.
            self.assertEqual(run_payload(tool_payload("view_file", CHILD_CONVERSATION), env)["decision"], "allow")

    def test_invalid_root_binding_treats_caller_as_child(self):
        with tempfile.TemporaryDirectory() as directory:
            binding = Path(directory) / "root"
            binding.write_text("not-a-conversation")
            env = {SUPERVISOR_MARKER: "1", STATE_DIR_ENV: directory,
                   ROOT_FILE_ENV: str(binding),
                   "NTG_BUDGET_ROOT_MAX_CALLS": "1",
                   "NTG_BUDGET_MAX_CALLS": "3"}
            # Root caps must not apply through a corrupt binding: the caller
            # is counted as a child under the uniform caps.
            self.assertEqual(run_payload(tool_payload("view_file"), env)["decision"], "allow")
            self.assertEqual(run_payload(tool_payload("view_file"), env)["decision"], "allow")
            self.assertEqual(run_payload(tool_payload("view_file"), env)["decision"], "allow")
            denied = run_payload(tool_payload("view_file"), env)
            self.assertEqual(denied["decision"], "deny")
            self.assertIn("calls", denied["reason"])

    def test_salvage_mode_denies_spawns_edits_and_shell_without_counting(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {SUPERVISOR_MARKER: "1", STATE_DIR_ENV: directory,
                   SALVAGE_MARKER: "1", "NTG_BUDGET_ROOT_MAX_CALLS": "1"}
            for tool in ("invoke_subagent", "write_to_file", "replace_file_content", "run_command"):
                with self.subTest(tool=tool):
                    denied = run_payload(tool_payload(tool), env)
                    self.assertEqual(denied["decision"], "deny")
                    self.assertIn("packet-only", denied["reason"])
            # Reads still work in salvage mode.
            self.assertEqual(run_payload(tool_payload("view_file"), env)["decision"], "allow")

    def test_run_command_is_denied_only_in_salvage_mode(self):
        # Stage 1 gate-review follow-up: the shell side door must be closed in
        # salvage mode (the Bulldozer shell exception could otherwise reach the
        # headless Excavator transport) without touching ordinary runs.
        with tempfile.TemporaryDirectory() as directory:
            env = {SUPERVISOR_MARKER: "1", STATE_DIR_ENV: directory,
                   "NTG_BUDGET_ROOT_MAX_CALLS": "1"}
            allowed = run_payload(tool_payload("run_command"), env)
            self.assertEqual(allowed["decision"], "allow")
            salvage_env = {**env, SALVAGE_MARKER: "1"}
            denied = run_payload(tool_payload("run_command"), salvage_env)
            self.assertEqual(denied["decision"], "deny")
            self.assertIn("shell", denied["reason"])

    def test_malformed_payload_fails_closed_while_budgeted(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {SUPERVISOR_MARKER: "1", STATE_DIR_ENV: directory}
            denied = run_payload({"toolCall": None}, env)
            self.assertEqual(denied["decision"], "deny")
            self.assertIn("Malformed hook input", denied["reason"])
            # Outside the budget boundary the same payload stays allowed.
            allowed = run_payload({"toolCall": None}, {STATE_DIR_ENV: directory})
            self.assertEqual(allowed["decision"], "allow")

    def test_counters_are_per_conversation(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {SUPERVISOR_MARKER: "1", STATE_DIR_ENV: directory,
                   "NTG_BUDGET_MAX_CALLS": "1"}
            self.assertEqual(run_payload(tool_payload("view_file", CHILD_CONVERSATION), env)["decision"], "allow")
            self.assertEqual(run_payload(tool_payload("view_file", SECOND_CHILD), env)["decision"], "allow")
            self.assertEqual(run_payload(tool_payload("view_file", CHILD_CONVERSATION), env)["decision"], "deny")
            self.assertEqual(run_payload(tool_payload("view_file", SECOND_CHILD), env)["decision"], "deny")


class HooksRegistrationTests(unittest.TestCase):
    def test_budget_guard_registered_for_all_tools_with_session_start(self):
        hooks = json.loads((ROOT / "hooks.json").read_text())
        boundary = hooks.get("role-budget-boundary")
        self.assertIsNotNone(boundary)
        pre = boundary["PreToolUse"][0]
        self.assertEqual(pre["matcher"], ".*")
        self.assertIn("budget-guard.py", pre["hooks"][0]["command"])
        session = boundary["SessionStart"][0]
        self.assertIn("--session-start", session["command"])

    def test_existing_boundaries_unchanged(self):
        hooks = json.loads((ROOT / "hooks.json").read_text())
        for name in ("zen-verification-boundary", "excavator-migration-boundary",
                     "bulldozer-no-shell-boundary"):
            self.assertIn(name, hooks)


if __name__ == "__main__":
    unittest.main()
