#!/usr/bin/env python3
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "hooks" / "excavator-shell-guard.py"
MARKER = "NTG_EXCAVATOR=1 "


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


class ExcavatorShellGuardTests(unittest.TestCase):
    def test_allows_task_relevant_sudo_and_downstream_dash_s(self) -> None:
        commands = [
            "sudo brightnessctl -d intel_backlight set 50%",
            "sudo cat /sys/class/backlight/intel_backlight/brightness",
            "sudo somecmd -S value",
            "grep 'sudo -S' README.md",
            "pacman -S vim",
            "apt install foo",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decision(MARKER + command), "allow")

    def test_denies_privilege_acquisition_drift(self) -> None:
        commands = [
            "echo candidate | sudo -S id",
            "cat pwfile | sudo -S id",
            "sudo -S id < pwfile",
            "sudo -nS id",
            "su -",
            "sudo su -",
            "pkexec bash",
            "env pkexec bash",
            "command ssh root@localhost",
            "command cat ~/.zsh_history",
            "sudo cat ~/.bash_history",
            "bash -c 'sudo su -'",
            "for p in a b; do echo $p | sudo -S id; done",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decision(MARKER + command), "deny")

    def test_denies_full_system_upgrades(self) -> None:
        commands = [
            "sudo pacman -Syu",
            "yay -Syu",
            "paru -Syu",
            "sudo apt upgrade",
            "sudo apt-get upgrade",
            "sudo apt full-upgrade",
            "sudo apt-get dist-upgrade",
            "sudo dnf upgrade",
            "sudo dnf system-upgrade",
            "sudo yum update",
            "sudo zypper dup",
            "bash -c 'sudo apt upgrade'",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decision(MARKER + command), "deny")

    def test_unmarked_commands_are_unaffected(self) -> None:
        self.assertEqual(decision("sudo apt upgrade"), "allow")
        self.assertEqual(decision("sudo su -"), "allow")


if __name__ == "__main__":
    unittest.main()
