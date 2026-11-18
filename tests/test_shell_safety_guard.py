#!/usr/bin/env python3
"""Unit tests for NTG 2.0 universal mutation safety guard (hooks/shell-safety-guard.py)."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "hooks" / "shell-safety-guard.py"


def run_guard(payload, env=None):
    merged_env = dict(os.environ)
    merged_env.pop("NTG_ACTIVE_ROLE", None)
    if env:
        merged_env.update(env)
    proc = subprocess.run(
        [sys.executable, str(GUARD)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        timeout=5,
        check=True,
        env=merged_env,
    )
    if proc.stderr:
        raise AssertionError(f"Unexpected stderr: {proc.stderr}")
    return json.loads(proc.stdout)


def cmd_call(command):
    return {
        "toolCall": {
            "name": "run_command",
            "args": {"CommandLine": command, "Cwd": str(ROOT), "WaitMsBeforeAsync": 5000},
        },
        "conversationId": "11111111-1111-1111-1111-111111111111",
    }


def file_call(tool_name, path_key, path_value):
    return {
        "toolCall": {
            "name": tool_name,
            "args": {path_key: path_value},
        },
        "conversationId": "11111111-1111-1111-1111-111111111111",
    }


class UniversalSafetyGuardTests(unittest.TestCase):
    def test_allows_ordinary_bulldozer_and_bobcat_commands_and_source_edits(self):
        for role in ("", "bulldozer", "bobcat"):
            env = {"NTG_ACTIVE_ROLE": role} if role else {}
            for command in [
                "SKIP_LIVE_TESTS=1 node --test tests/test_ledger.mjs",
                "git status --short",
                "cat plugin.json",
                "sudo systemctl status example-service",
                "npm test",
            ]:
                with self.subTest(role=role, command=command):
                    self.assertEqual(run_guard(cmd_call(command), env=env)["decision"], "allow")

            for tool_name, key in [
                ("write_to_file", "TargetFile"),
                ("replace_file_content", "TargetFile"),
                ("multi_replace_file_content", "TargetFile"),
                ("write_file", "Path"),
                ("edit_file", "Path"),
            ]:
                with self.subTest(role=role, tool=tool_name):
                    self.assertEqual(
                        run_guard(file_call(tool_name, key, "src/core/example.mjs"), env=env)["decision"],
                        "allow",
                    )

    def test_protected_paths_blocked_across_file_mutation_tools(self):
        protected_targets = [
            ".ntg/ledger.json",
            "./.ntg/ledger.json",
            "/tmp/repo/.ntg/ledger.json",
            ".ntg/ledger.json.lock",
            ".ntg/lightweight-runs.jsonl",
            "hooks.json",
            "./hooks.json",
            "hooks/shell-safety-guard.py",
            "hooks/zen-shell-guard.py",
            "hooks/telemetry-guard.py",
            "plugin.json",
            "/workspace/plugin.json",
        ]
        tools = [
            ("write_to_file", "TargetFile"),
            ("replace_file_content", "TargetFile"),
            ("multi_replace_file_content", "TargetFile"),
            ("write_file", "Path"),
            ("edit_file", "Path"),
        ]
        for target in protected_targets:
            for tool_name, key in tools:
                with self.subTest(target=target, tool=tool_name):
                    res = run_guard(file_call(tool_name, key, target), env={"NTG_ACTIVE_ROLE": "bulldozer"})
                    self.assertEqual(res["decision"], "deny")

    def test_protected_paths_blocked_across_shell_commands_and_bypasses_with_zero_markers(self):
        # Zero model-controlled bypass markers or shell exceptions work
        shell_mutations = [
            "echo '{}' > .ntg/ledger.json",
            "cat x >> .ntg/lightweight-runs.jsonl",
            "rm -f .ntg/ledger.json.lock",
            "mv evil.json hooks.json",
            "cp evil.json plugin.json",
            "touch hooks/new.py",
            "sed -i 's/allow/deny/' hooks/shell-safety-guard.py",
            "echo '{}' | tee .ntg/ledger.json",
            "bash -c 'echo x > plugin.json'",
            "python3 -c 'open(\".ntg/ledger.json\", \"w\").write(\"{}\")'",
            "node -e 'require(\"fs\").writeFileSync(\"hooks.json\", \"{}\")'",
            "NTG_EXCAVATOR=1 rm .ntg/ledger.json",
            "NTG_LEDGER_INTERNAL=1 echo '{}' > .ntg/ledger.json",
            "git checkout -- hooks.json",
        ]
        for command in shell_mutations:
            with self.subTest(command=command):
                res = run_guard(cmd_call(command), env={"NTG_ACTIVE_ROLE": "bulldozer"})
                self.assertEqual(res["decision"], "deny")

    def test_read_only_roles_blocked_from_file_mutations_and_shell(self):
        for role in ("strix-halo", "jaguar", "piledriver", "instinct"):
            for tool_name, key in [("write_to_file", "TargetFile"), ("write_file", "Path"), ("edit_file", "Path")]:
                res = run_guard(file_call(tool_name, key, "src/app.mjs"), env={"NTG_ACTIVE_ROLE": role})
                self.assertEqual(res["decision"], "deny", f"{role} must be denied {tool_name}")
            res_cmd = run_guard(cmd_call("ls -la"), env={"NTG_ACTIVE_ROLE": role})
            self.assertEqual(res_cmd["decision"], "deny", f"{role} must be denied run_command")

        # Zen: denied file-mutation tools and mutating shell commands; allowed read-only verification
        res_zen_file = run_guard(file_call("write_file", "Path", "src/app.mjs"), env={"NTG_ACTIVE_ROLE": "zen"})
        self.assertEqual(res_zen_file["decision"], "deny")
        res_zen_mut = run_guard(cmd_call("rm -rf tmp"), env={"NTG_ACTIVE_ROLE": "zen"})
        self.assertEqual(res_zen_mut["decision"], "deny")
        res_zen_ok = run_guard(cmd_call("git status --short"), env={"NTG_ACTIVE_ROLE": "zen"})
        self.assertEqual(res_zen_ok["decision"], "allow")

    def test_privilege_escalation_upgrades_destructive_and_anti_spoofing(self):
        denied_commands = [
            "echo secret | sudo -S id",
            "sudo --stdin systemctl restart foo",
            "for p in a b; do su root; done",
            "su - root",
            "pkexec cat /etc/shadow",
            "ssh root@localhost id",
            "ssh root@127.0.0.1 whoami",
            "cat ~/.bash_history",
            "grep pass ~/.zsh_history",
            "apt-get full-upgrade -y",
            "pacman -Syu",
            "dnf system-upgrade",
            "zypper dup",
            "rm -rf /",
            "rm -rf .git",
            "git reset --hard",
            "git clean -fd",
            "NTG_ACTIVE_ROLE=bulldozer rm src/a.mjs",
            "export NTG_ACTIVE_ROLE=bobcat",
            "unset NTG_ACTIVE_ROLE",
            "env -u NTG_SUPERVISOR_PID node test.mjs",
            "NTG_SUPERVISOR_PID=1 node test.mjs",
            "SKIP_LIVE_TESTS=0 node --test tests/test_ledger.mjs",
            "unset SKIP_LIVE_TESTS",
        ]
        for command in denied_commands:
            with self.subTest(command=command):
                res = run_guard(cmd_call(command), env={"NTG_ACTIVE_ROLE": "bulldozer"})
                self.assertEqual(res["decision"], "deny")

    def test_hooks_json_registers_universal_safety_guard_across_shell_and_file_tools(self):
        config = json.loads((ROOT / "hooks.json").read_text())
        self.assertIn("universal-mutation-safety-boundary", config)
        pre = config["universal-mutation-safety-boundary"]["PreToolUse"]
        matchers = [entry["matcher"] for entry in pre]
        self.assertTrue(any(re.fullmatch(m, "run_command") for m in matchers))
        for file_tool in ("write_to_file", "replace_file_content", "multi_replace_file_content", "write_file", "edit_file"):
            self.assertTrue(any(re.fullmatch(m, file_tool) for m in matchers), f"Missing matcher for {file_tool}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
