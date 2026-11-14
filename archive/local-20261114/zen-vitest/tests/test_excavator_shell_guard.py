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

    def test_denies_baseline_command_forms(self) -> None:
        commands = [
            "bash -c true; sudo apt upgrade",
            "sudo bash -c true && su -",
            "bash -ec -c 'su -'",
            "bash -ec -c 'sudo apt upgrade'",
            "sh -xc -c 'pkexec id'",
            "bash -ce -c 'su'",
            "bash -lc -c 'su -'",
            "bash -o pipefail -c 'su -'",
            "bash -oe pipefail -c 'su -'",
            "bash -oec pipefail -c 'su -'",
            "bash -Oe extglob -c 'pkexec id'",
            "bash --rcfile /dev/null -c 'su -'",
            "bash --init-file /dev/null -c 'su -'",
            "bash -oO pipefail extglob -ec 'su -'",
            "/usr/bin/sudo -S id",
            "FOO=bar sudo -S id",
            "env -u FOO sudo -S id",
            "sudo pacman -S -u",
            'fish -c "sudo apt upgrade"',
            "ssh root@[::1]",
            "/usr/bin/env --unset FOO /usr/bin/sudo -S id",
            "env --unset=FOO sudo -S id",
            "env -uFOO sudo -S id",
            "env -C /tmp sudo -S id",
            "env --chdir /tmp sudo -S id",
            "env --chdir=/tmp sudo -S id",
            "env -C/tmp sudo -S id",
            "env -i -0 FOO=bar -- sudo -S id",
            "/usr/bin/command FOO=bar /usr/bin/pkexec id",
            "sudo -u root /usr/bin/apt upgrade",
            "sudo --user=root /usr/bin/pacman -s -u",
            "pacman -sU",
            "yay -S -u",
            "paru --sysupgrade",
            "/usr/bin/apt UPGRADE",
            "ssh ROOT@LOCALHOST",
            "rg password ~/.bash_history.backup",
            "sudo head /tmp/.zsh_history-copy",
            'bash -c "true"; fish -c "su -"',
            "for p in a b; do /usr/bin/sudo -S id; done",
            "for f in a; do echo su; done",
            "for f in a; do sudo pacman -S vim; done",
            "sudo -pS id",
            "",
            "   ",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decision(MARKER + command), "deny")

    def test_denies_forbidden_effects_through_deeper_forms(self) -> None:
        commands = [
            "sudo sudo sudo su",
            "sudo bash -c 'sudo apt upgrade'",
            "sudo -nu root su",
            "exec su -",
            "eval sudo apt upgrade",
            "bash -lc 'su -'",
            "ksh -c 'su -'",
            "env -v sudo -S id",
            "while true; do su -; done",
            "bash -c 'unterminated",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decision(MARKER + command), "deny")

    def test_allows_baseline_diagnostics_and_prompt_values(self) -> None:
        commands = [
            "sudo -pAUTH id",
            "sudo -npAUTH id",
            "sudo --prompt=AUTH id",
            "echo ~/.bash_history",
            "printf '%s' ~/.zsh_history",
            "env -u FOO sudo cat /sys/class/backlight/intel_backlight/brightness",
            "/usr/bin/sudo somecmd -S value",
            "sudo -u root somecmd -S value",
            "sudo -- somecmd -S value",
            "bash -c true; echo ok",
            "sudo bash -c true && echo ok",
            "bash -ec -c 'echo ok'",
            "bash -oe pipefail -c 'echo ok'",
            "bash --rcfile /dev/null -c 'echo ok'",
            "bash -oO pipefail extglob -ec 'echo ok'",
            "bash -c 'echo \"$1\"' ignored su",
            "bash -ec 'echo \"$1\"' ignored pkexec",
            "bash script.sh",
            "ssh user@[::1]",
            "pacman -S -y vim",
            "sudo -p S id",
            "sudo -A id",
            "echo ok # comment\nsudo apt upgrade",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decision(MARKER + command), "allow")


if __name__ == "__main__":
    unittest.main()
