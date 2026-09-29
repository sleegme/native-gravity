#!/usr/bin/env python3
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "hooks" / "zen-shell-guard.py"
MARKER = "NTG_ZEN_VERIFY=1 "


def decision(command: str) -> str:
    event = {
        "toolCall": {
            "name": "run_command",
            "args": {"CommandLine": command},
        }
    }
    result = subprocess.run(
        [sys.executable, str(GUARD)],
        input=json.dumps(event),
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)["decision"]


class ZenShellGuardTests(unittest.TestCase):
    def test_denies_output_redirection(self) -> None:
        commands = [
            "echo x > src/app.py",
            "echo x >> src/app.py",
            "cat > src/app.py",
            "pytest 2> err.log",
            "pytest &> out.log",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decision(MARKER + command), "deny")

    def test_denies_tee_writes(self) -> None:
        commands = [
            "cat patch.txt | tee src/app.py",
            "cat patch.txt | tee -a src/app.py",
            "echo x | sudo tee /etc/hosts",
            "tee src/app.py",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decision(MARKER + command), "deny")

    def test_denies_git_stash(self) -> None:
        commands = [
            "git stash",
            "git stash push",
            "git stash pop",
            "git -C /repo stash",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decision(MARKER + command), "deny")

    def test_denies_git_push(self) -> None:
        commands = [
            "git push",
            "git push origin main",
            "git push --force",
            "git -C /repo push",
            "git -c push.default=simple push",
            "git --git-dir=/repo/.git push",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decision(MARKER + command), "deny")

    def test_denies_representative_existing_mutation_paths(self) -> None:
        commands = [
            "sed -i 's/a/b/' src/app.py",
            "rm -rf build",
            "mv src/a.py src/b.py",
            "git add .",
            "git commit -m wip",
            "git reset --hard",
            "npm install left-pad",
            "pip install requests",
            "prettier --write src",
            "gofmt -w .",
            "python3 -c \"open('a.py','w')\"",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decision(MARKER + command), "deny")

    def test_allows_read_only_verification(self) -> None:
        commands = [
            "git status",
            "git diff",
            "git diff --stat origin/main",
            "git log --oneline -5",
            "git log --grep=push",
            "git show HEAD:rules/harness.md",
            "cat rules/harness.md",
            "grep -rn TODO hooks",
            "ls -la hooks",
            "pytest -q",
            "python3 -m unittest discover -s tests -v",
            "npm test",
            "npm run build",
            "sed 's/a/b/' src/app.py",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decision(MARKER + command), "allow")

    def test_unmarked_commands_are_unaffected(self) -> None:
        commands = [
            "git push origin main",
            "git stash",
            "cat patch.txt | tee src/app.py",
            "rm -rf build",
            "sed -i 's/a/b/' src/app.py",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decision(command), "allow")

    def test_empty_marked_command_is_denied(self) -> None:
        self.assertEqual(decision(MARKER), "deny")

    def test_marker_without_trailing_space_is_treated_as_unmarked(self) -> None:
        self.assertEqual(decision(MARKER.strip()), "allow")

    def test_non_shell_tool_calls_are_unaffected(self) -> None:
        event = {
            "toolCall": {
                "name": "write_to_file",
                "args": {"CommandLine": MARKER + "git push"},
            }
        }
        result = subprocess.run(
            [sys.executable, str(GUARD)],
            input=json.dumps(event),
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertEqual(json.loads(result.stdout)["decision"], "allow")


if __name__ == "__main__":
    unittest.main()
