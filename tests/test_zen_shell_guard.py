#!/usr/bin/env python3
"""Exercise the real hook process and documented AGY payload, not mocked parsing."""

import json
from pathlib import Path
import re
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "hooks" / "zen-shell-guard.py"


def run_payload(payload):
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    result = subprocess.run([sys.executable, str(GUARD)], input=raw, text=True,
                            capture_output=True, timeout=5, check=True)
    if result.stderr:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


def command_payload(command):
    return {"toolCall": {"name": "run_command", "args": {
        "CommandLine": command, "Cwd": str(ROOT), "WaitMsBeforeAsync": 0,
    }}, "stepIdx": 0, "conversationId": "synthetic-zen-verification"}


class ZenShellGuardTests(unittest.TestCase):
    def test_marked_read_only_commands(self):
        commands = [
            "NTG_ZEN_VERIFY=1 git status --short",
            "NTG_ZEN_VERIFY=1 git --no-optional-locks diff --stat",
            "NTG_ZEN_VERIFY=1 git log -3 --oneline",
            "NTG_ZEN_VERIFY=1 git show HEAD:README.md",
            "NTG_ZEN_VERIFY=1 cat README.md | head -n 10",
            "NTG_ZEN_VERIFY=1 rg --line-number TODO scripts",
            "NTG_ZEN_VERIFY=1 grep -n contract docs/specs/file.md",
            "env NTG_ZEN_VERIFY=1 sha256sum README.md",
            "NTG_ZEN_VERIFY=1 ls -la && wc -l README.md",
            "NTG_ZEN_VERIFY=1 test -f README.md || pwd",
            "NTG_ZEN_VERIFY=1 node --check scripts/spine.mjs",
            "NTG_ZEN_VERIFY=1 python3 --version",
            "NTG_ZEN_VERIFY=1 cat 'file with spaces.txt'",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(run_payload(command_payload(command))["decision"], "allow")

    def test_marked_mutations_and_bypasses_denied(self):
        commands = [
            "rm -rf project", "mv a b", "cp a b", "touch artifact", "mkdir output",
            "chmod +x script", "ln -s a b", "truncate -s 0 artifact",
            "sed -i s/a/b/ file", "sed --in-place s/a/b/ file",
            "echo changed > artifact", "cat a >> b", "cat a 2>errors",
            "cat a | tee b", "git commit -am changed", "git checkout other",
            "git push origin main", "git reset --hard", "git clean -fd",
            "git add .", "git apply patch", "git branch new", "git config x y",
            "git diff --output=artifact", "git log -oartifact", "git show --output artifact",
            "git diff --ext-diff", "git diff --textconv", "git -c alias.x=push x",
            "git diff --out=artifact", "git log --out artifact", "git cat-file --filters HEAD:a",
            "npm install", "npm test", "apt full-upgrade", "pacman -Syu",
            "dnf system-upgrade", "zypper dup", "pip install pkg",
            "prettier --write .", "ruff check --fix .", "cargo fmt",
            "python3 -c 'open(\"a\",\"w\").write(\"x\")'",
            "node -e 'require(\"fs\").writeFileSync(\"a\",\"x\")'",
            "python3 project_test.py", "node tests/test_spine.mjs",
            "bash -c 'rm a'", "sh -c 'touch a'", "eval 'rm a'",
            "env sh -c 'rm a'", "sudo rm a", "command rm a", "exec rm a",
            "find . -delete", "find . -exec rm a ;", "xargs rm",
            "rg --pre=touch pattern .", "rg --hostname-bin=touch pattern .",
            "awk 'BEGIN {system(\"touch a\")}'", "sort -o a b", "uniq a b",
            "git status; rm a", "git status && rm a", "git status || rm a",
            "git status\nrm a", "git status & rm a", "cat a | rm b",
            "git status # comment\nrm a",
            "cat $(touch a)", "cat `touch a`", "cat <(touch a)",
            "(touch a)", "{ touch a; }", "r\\m a", "./git status",
            "env PATH=/tmp/hostile git status", "NTG_ZEN_VERIFY=0 rm a",
            "node --check --import=mutator.mjs", "cat 'unterminated",
        ]
        for command in commands:
            marked = "NTG_ZEN_VERIFY=1 " + command
            with self.subTest(command=marked):
                self.assertEqual(run_payload(command_payload(marked))["decision"], "deny")

    def test_unmarked_commands_belong_to_other_roles(self):
        for command in ["git commit -m change", "NTG_EXCAVATOR=1 sudo systemctl status example"]:
            self.assertEqual(run_payload(command_payload(command))["decision"], "allow")

    def test_marker_cannot_be_hidden_in_wrapper_or_disabled(self):
        for command in ["env -u NTG_ZEN_VERIFY rm a", "NTG_ZEN_VERIFY=0 rm a",
                        "bash -c 'NTG_ZEN_VERIFY=1 rm a'", "echo NTG_ZEN_VERIFY=1; rm a"]:
            self.assertEqual(run_payload(command_payload(command))["decision"], "deny")

    def test_malformed_input_fails_closed(self):
        for payload in ["{", "[]", {}, {"toolCall": {}},
                        {"toolCall": {"name": "run_command", "args": {}}},
                        {"toolCall": {"name": "run_command", "args": {"CommandLine": 42}}}]:
            with self.subTest(payload=payload):
                # Unknown non-shell tools are outside the shell registration.
                expected = "allow" if payload == {"toolCall": {}} else "deny"
                self.assertEqual(run_payload(payload)["decision"], expected)

    def test_hook_registration_uses_real_guard(self):
        config = json.loads((ROOT / "hooks.json").read_text())
        handlers = [handler for definition in config.values()
                    for event in definition.get("PreToolUse", [])
                    if re.fullmatch(event["matcher"], "run_command")
                    for handler in event["hooks"]]
        zen = [h for h in handlers if "zen-shell-guard.py" in h["command"]]
        self.assertEqual(len(zen), 1)
        self.assertEqual(zen[0]["type"], "command")
        self.assertGreater(zen[0]["timeout"], 0)
        self.assertTrue(any("excavator-shell-guard.py" in h["command"] for h in handlers))
        # Execute the command actually registered, not a duplicate invocation.
        for command, expected in [("git status --short", "allow"), ("rm artifact", "deny")]:
            result = subprocess.run(zen[0]["command"], shell=True, cwd=ROOT,
                                    input=json.dumps(command_payload("NTG_ZEN_VERIFY=1 " + command)),
                                    text=True, capture_output=True, check=True, timeout=5)
            self.assertEqual(json.loads(result.stdout)["decision"], expected)

    def test_agent_identity_and_non_mutating_capabilities(self):
        # Parse machine-consumed metadata only; do not pin prompt prose.
        text = (ROOT / "agents" / "zen.md").read_text()
        frontmatter = text.split("---", 2)[1]
        scalar = dict(re.findall(r"^(\w+): ([^\n]+)$", frontmatter, re.MULTILINE))
        self.assertEqual(scalar["name"], "zen")
        self.assertTrue(scalar["description"].strip())
        self.assertEqual(scalar["mainAgent"], "false")
        self.assertEqual(scalar["subagent"], "true")
        self.assertEqual(scalar["model"], "pro")
        self.assertEqual(scalar["commandExecutionPolicy"], "sandbox")
        tools = re.findall(r"^  - (\w+)$", frontmatter, re.MULTILINE)
        self.assertIn("run_command", tools)
        self.assertTrue(set(tools) <= {"view_file", "list_dir", "find_by_name", "grep_search", "run_command"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
