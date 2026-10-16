"""Exercise the shipped helpers through their real shell and import surfaces."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class WorkflowToolsTests(unittest.TestCase):
    def test_source_helper_regressions(self):
        result = subprocess.run(
            ["bash", str(ROOT / "tests/workflow-tools.sh")],
            capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("ALL PASS:", result.stdout)

    def test_import_from_another_working_directory(self):
        with tempfile.TemporaryDirectory(prefix="ntg wf ") as directory:
            root = Path(directory)
            (root / "first file.txt").write_text("one\ntwo\n")
            (root / "second.txt").write_text("three\n")
            env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull,
                   "GIT_CONFIG_NOSYSTEM": "1"}
            subprocess.run(["git", "init", "-q", directory], env=env, check=True)
            result = subprocess.run(
                [sys.executable, "-B", "-c",
                 "import sys; sys.path.insert(0, sys.argv[1]); import wf; "
                 "print(wf.ctx('first file.txt', 'second.txt')); "
                 "print(wf.git_snap()); print(wf.ctx('missing.txt'))",
                 str(ROOT / "tools")],
                cwd=directory, env=env, capture_output=True, text=True, timeout=30,
            )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for expected in ("first file.txt (2 lines)", "     2\ttwo",
                         "second.txt (1 lines)", "## branch", "no commits yet",
                         '?? "first file.txt"', "## commits", "no such file"):
            self.assertIn(expected, result.stdout)


if __name__ == "__main__":
    unittest.main()
