#!/usr/bin/env python3
"""Unit tests for bulldozer-shell-guard and hooks.json registration."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "hooks" / "bulldozer-shell-guard.py"
ENV_MARKER = "NTG_BULLDOZER_NO_SHELL"
DENIAL_REASON = "Bulldozer has no shell authority; discovery routes to Jaguar."
CONVERSATION_FILE_ENV = "NTG_BULLDOZER_CONVERSATION_FILE"
ROOT_CONVERSATION = "28cef410-65b7-4009-858a-3dc9fe05c53a"
CHILD_CONVERSATION = "bf1327b8-1285-4ddd-a6c5-36633861e359"


def run_payload(payload, env=None, args=()):
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    current_env = os.environ.copy()
    current_env.pop(ENV_MARKER, None)
    current_env.pop(CONVERSATION_FILE_ENV, None)
    if env is not None:
        current_env.update(env)
    else:
        current_env.pop(ENV_MARKER, None)
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


def tool_payload(tool_name, args=None):
    return {
        "toolCall": {
            "name": tool_name,
            "args": args or {},
        },
        "stepIdx": 0,
        "conversationId": "synthetic-test-conversation",
    }


class BulldozerShellGuardTests(unittest.TestCase):
    def test_native_bobcat_shell_allowed_under_inherited_marker(self):
        # Given the distinct runtime IDs captured from AGY 1.4.12, and the
        # root conversation binding established before native delegation.
        with tempfile.TemporaryDirectory() as directory:
            binding = Path(directory) / "conversation"
            binding.write_text(ROOT_CONVERSATION)
            payload = tool_payload("run_command", {"CommandLine": "printf NTG184_BOBCAT"})
            payload["conversationId"] = CHILD_CONVERSATION

            # When Bobcat reaches the same hook with the inherited marker.
            result = run_payload(payload, env={
                ENV_MARKER: "1", CONVERSATION_FILE_ENV: str(binding),
            })

            # Then native worker verification is not blocked as Bulldozer.
            self.assertEqual(result["decision"], "allow")

    def test_session_start_binds_root_before_child_first_shell(self):
        with tempfile.TemporaryDirectory() as directory:
            binding = Path(directory) / "conversation"
            env = {ENV_MARKER: "1", CONVERSATION_FILE_ENV: str(binding)}
            # Both SessionStart events precede the first shell command.
            for identity in (ROOT_CONVERSATION, CHILD_CONVERSATION):
                self.assertEqual(run_payload(
                    {"conversationId": identity}, env, ("--session-start",),
                ), {})
            self.assertEqual(binding.read_text(), ROOT_CONVERSATION)
            payload = tool_payload("run_command", {"CommandLine": "node --version"})
            payload["conversationId"] = CHILD_CONVERSATION

            result = run_payload(payload, env)

            self.assertEqual(result["decision"], "allow")

    def test_root_shell_stays_denied_despite_command_or_argument_identity_claims(self):
        with tempfile.TemporaryDirectory() as directory:
            binding = Path(directory) / "conversation"
            binding.write_text(ROOT_CONVERSATION)
            env = {ENV_MARKER: "1", CONVERSATION_FILE_ENV: str(binding)}
            for command in (
                'grep -rn BULLDOZER_SPIKE_PASS .',
                'NTG_BOBCAT=1 node --version',
                'NTG_ZEN_VERIFY=1 node --version',
                'NTG_EXCAVATOR=1 node --version',
                'NTG_BULLDOZER_NO_SHELL=0 node --version',
            ):
                with self.subTest(command=command):
                    payload = tool_payload("run_command", {
                        "CommandLine": command, "conversationId": CHILD_CONVERSATION,
                        "agent": "bobcat",
                    })
                    payload["conversationId"] = ROOT_CONVERSATION

                    result = run_payload(payload, env)

                    self.assertEqual(result["decision"], "deny")
                    self.assertEqual(result["reason"], DENIAL_REASON)

    def test_missing_or_invalid_binding_and_identity_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            binding = Path(directory) / "conversation"
            env = {ENV_MARKER: "1", CONVERSATION_FILE_ENV: str(binding)}
            payload = tool_payload("run_command", {"CommandLine": "node --version"})
            payload["conversationId"] = CHILD_CONVERSATION
            for contents in (None, "", "not-a-conversation", ROOT_CONVERSATION):
                for identity in (None, "", 42, CHILD_CONVERSATION):
                    if contents == ROOT_CONVERSATION and identity == CHILD_CONVERSATION:
                        continue
                    with self.subTest(contents=contents, identity=identity):
                        if contents is not None:
                            binding.write_text(contents)
                        payload["conversationId"] = identity

                        result = run_payload(payload, env)

                        self.assertEqual(result["decision"], "deny")

    def test_root_excavator_transport_remains_allowed_with_binding(self):
        with tempfile.TemporaryDirectory() as directory:
            binding = Path(directory) / "conversation"
            binding.write_text(ROOT_CONVERSATION)
            payload = tool_payload("run_command", {
                "CommandLine": "node /opt/native-gravity/scripts/excavator-agy.mjs --milestone m1 --blocker 'check failed'",
            })
            payload["conversationId"] = ROOT_CONVERSATION

            result = run_payload(payload, {
                ENV_MARKER: "1", CONVERSATION_FILE_ENV: str(binding),
            })

            self.assertEqual(result["decision"], "allow")

    def test_native_child_allow_does_not_override_zen_mutation_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            binding = Path(directory) / "conversation"
            binding.write_text(ROOT_CONVERSATION)
            env = {**os.environ, ENV_MARKER: "1", CONVERSATION_FILE_ENV: str(binding)}
            hooks = json.loads((ROOT / "hooks.json").read_text())
            for command, expected in (
                ("NTG_ZEN_VERIFY=1 node --version", "allow"),
                ("NTG_ZEN_VERIFY=1 rm important.txt", "deny"),
            ):
                with self.subTest(command=command):
                    payload = tool_payload("run_command", {"CommandLine": command})
                    payload["conversationId"] = CHILD_CONVERSATION

                    decisions = []
                    for group in hooks.values():
                        for event in group.get("PreToolUse", []):
                            if re.fullmatch(event["matcher"], "run_command"):
                                for hook in event["hooks"]:
                                    result = subprocess.run(
                                        hook["command"], shell=True, cwd=ROOT,
                                        input=json.dumps(payload), text=True,
                                        capture_output=True, check=True, timeout=5, env=env,
                                    )
                                    decisions.append(json.loads(result.stdout)["decision"])

                    self.assertEqual("deny" if "deny" in decisions else "allow", expected)

    def test_denies_run_command_under_marker_with_exact_message(self):
        payload = tool_payload("run_command", {"CommandLine": "ls -la"})
        res = run_payload(payload, env={ENV_MARKER: "1"})
        self.assertEqual(res.get("decision"), "deny")
        self.assertEqual(res.get("reason"), DENIAL_REASON)

    def test_allows_other_tools_under_marker(self):
        tools = ["view_file", "list_dir", "grep_search", "find_by_name", "write_file"]
        for tool in tools:
            with self.subTest(tool=tool):
                payload = tool_payload(tool, {"path": "/some/path"})
                res = run_payload(payload, env={ENV_MARKER: "1"})
                self.assertEqual(res.get("decision"), "allow")
                self.assertEqual(res.get("reason"), "Not a shell tool")

    def test_allows_run_command_when_marker_absent_or_not_1(self):
        payload = tool_payload("run_command", {"CommandLine": "ls -la"})
        # Absent marker
        res_absent = run_payload(payload, env={})
        self.assertEqual(res_absent.get("decision"), "allow")
        self.assertEqual(res_absent.get("reason"), "Outside the Bulldozer no-shell boundary")

        # Marker set to "0", "false", "", or other values
        for val in ["0", "false", "", "2"]:
            with self.subTest(marker_value=val):
                res = run_payload(payload, env={ENV_MARKER: val})
                self.assertEqual(res.get("decision"), "allow")
                self.assertEqual(res.get("reason"), "Outside the Bulldozer no-shell boundary")

    def test_allows_other_tools_when_marker_absent(self):
        tools = ["view_file", "list_dir", "grep_search"]
        for tool in tools:
            with self.subTest(tool=tool):
                payload = tool_payload(tool, {"path": "/some/path"})
                res = run_payload(payload, env={})
                self.assertEqual(res.get("decision"), "allow")
                self.assertEqual(res.get("reason"), "Outside the Bulldozer no-shell boundary")

    def test_malformed_input_fails_closed_under_marker(self):
        malformed_payloads = [
            "{",
            "[]",
            "not a json",
            "",
            {},
            {"toolCall": {}},
            {"toolCall": "not-a-dict"},
            {"otherField": 123},
        ]
        for payload in malformed_payloads:
            with self.subTest(payload=payload):
                res = run_payload(payload, env={ENV_MARKER: "1"})
                self.assertEqual(res.get("decision"), "deny")
                self.assertTrue(res.get("reason", "").startswith("Malformed hook input:"))

    def test_malformed_input_allowed_outside_marker(self):
        malformed_payloads = [
            "{",
            "[]",
            "not a json",
            "",
            {},
            {"toolCall": {}},
            {"toolCall": "not-a-dict"},
        ]
        for payload in malformed_payloads:
            with self.subTest(payload=payload):
                res = run_payload(payload, env={})
                self.assertEqual(res.get("decision"), "allow")
                self.assertEqual(res.get("reason"), "Outside the Bulldozer no-shell boundary")

    def test_hooks_json_registration(self):
        hooks_config = json.loads((ROOT / "hooks.json").read_text())
        self.assertIn("bulldozer-no-shell-boundary", hooks_config)
        boundary = hooks_config["bulldozer-no-shell-boundary"]
        self.assertEqual(boundary["SessionStart"], [{
            "type": "command",
            "command": "python3 ./hooks/bulldozer-shell-guard.py --session-start",
            "timeout": 10,
        }])
        pre_tool_use = boundary.get("PreToolUse", [])
        self.assertTrue(len(pre_tool_use) >= 1)

        matched_hooks = [
            hook
            for event in pre_tool_use
            if re.fullmatch(event["matcher"], "run_command")
            for hook in event.get("hooks", [])
        ]
        bulldozer_hooks = [
            h for h in matched_hooks if "bulldozer-shell-guard.py" in h.get("command", "")
        ]
        self.assertEqual(len(bulldozer_hooks), 1)
        hook_def = bulldozer_hooks[0]
        self.assertEqual(hook_def.get("type"), "command")
        self.assertEqual(hook_def.get("timeout"), 10)

        # Execute hook via command string from hooks.json
        cmd = hook_def["command"]
        payload = tool_payload("run_command", {"CommandLine": "echo test"})

        # Run under marker
        proc_marked = subprocess.run(
            cmd,
            shell=True,
            cwd=ROOT,
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            check=True,
            timeout=5,
            env={**os.environ, ENV_MARKER: "1"},
        )
        self.assertEqual(json.loads(proc_marked.stdout)["decision"], "deny")
        self.assertEqual(json.loads(proc_marked.stdout)["reason"], DENIAL_REASON)

        # Run without marker
        clean_env = os.environ.copy()
        clean_env.pop(ENV_MARKER, None)
        proc_unmarked = subprocess.run(
            cmd,
            shell=True,
            cwd=ROOT,
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            check=True,
            timeout=5,
            env=clean_env,
        )
        self.assertEqual(json.loads(proc_unmarked.stdout)["decision"], "allow")



class TestExcavatorTransportWhitelist(unittest.TestCase):
    def run_guard(self, payload):
        proc = subprocess.run([sys.executable, str(GUARD)], input=json.dumps(payload),
                              capture_output=True, text=True,
                              env={**os.environ, ENV_MARKER: "1"})
        return json.loads(proc.stdout)

    def test_allows_excavator_transport(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine":
            "node /home/u/.gemini/config/plugins/native-gravity/scripts/excavator-agy.mjs --milestone m1 --blocker b"}}}
        result = self.run_guard(payload)
        self.assertEqual(result["decision"], "allow")
        self.assertIn("Excavator transport", result["reason"])

    def test_denies_transport_path_without_node(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine":
            "cat scripts/excavator-agy.mjs"}}}
        result = self.run_guard(payload)
        self.assertEqual(result["decision"], "deny")

    def test_denies_chained_command_after_transport(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine":
            "node scripts/excavator-agy.mjs --milestone m1; rm -rf /tmp/x"}}}
        result = self.run_guard(payload)
        self.assertEqual(result["decision"], "deny")

    def test_denies_substitution_in_transport_command(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine":
            "node scripts/excavator-agy.mjs $(echo pwn)"}}}
        result = self.run_guard(payload)
        self.assertEqual(result["decision"], "deny")


    def test_denies_backgrounding_after_transport(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine":
            "node scripts/excavator-agy.mjs --milestone m1 & rm -rf /tmp/x"}}}
        result = self.run_guard(payload)
        self.assertEqual(result["decision"], "deny")

    def test_denies_redirection_after_transport(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine":
            "node scripts/excavator-agy.mjs --milestone m1 > /tmp/pwn"}}}
        result = self.run_guard(payload)
        self.assertEqual(result["decision"], "deny")

    def test_denies_newline_in_transport_command(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine":
            "node scripts/excavator-agy.mjs --milestone m1\nrm -rf /tmp/x"}}}
        result = self.run_guard(payload)
        self.assertEqual(result["decision"], "deny")

    def test_denies_quoted_argument_bypass(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine":
            'node scripts/excavator-agy.mjs --blocker "$(rm -rf /tmp/x)"'}}}
        result = self.run_guard(payload)
        self.assertEqual(result["decision"], "deny")

    def test_allows_single_quoted_blocker(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine":
            "node /home/u/p/scripts/excavator-agy.mjs --milestone m1 --blocker 'tests fail: x; y && z'"}}}
        self.assertEqual(self.run_guard(payload)["decision"], "allow")

    def test_denies_quote_breakout(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine":
            "node /home/u/p/scripts/excavator-agy.mjs --blocker 'a' ; rm -rf /tmp/x"}}}
        self.assertEqual(self.run_guard(payload)["decision"], "deny")

if __name__ == "__main__":
    unittest.main(verbosity=2)
