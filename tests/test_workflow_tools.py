"""Exercise the shipped helpers through their real shell and import surfaces."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import wf


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

    def test_wf_ctx_capping(self):
        with tempfile.TemporaryDirectory(prefix="ntg ctx cap ") as directory:
            root = Path(directory)
            f1 = root / "large.txt"
            f1.write_text("\n".join(f"line {i}" for i in range(1, 100)) + "\n")
            f2 = root / "small.txt"
            f2.write_text("hello\nworld\n")

            # Uncapped produces full output
            uncapped = wf.ctx(str(f1), str(f2))
            self.assertIn("line 99", uncapped)
            self.assertIn("hello", uncapped)
            self.assertNotIn("... omitted:", uncapped)

            # Capped with max_bytes
            capped = wf.ctx(str(f1), str(f2), max_bytes=150)
            capped_bytes = len(capped.encode("utf-8"))
            self.assertLessEqual(capped_bytes, 150)
            self.assertIn("... omitted:", capped)
            for line in capped.splitlines():
                self.assertFalse(line.startswith("\t"))

            # Capped with max_bytes=True uses default cap (24576 bytes)
            capped_default = wf.ctx(str(f1), max_bytes=True)
            self.assertLessEqual(len(capped_default.encode("utf-8")), 24576)
            self.assertIn("line 1", capped_default)

    def test_wf_search_exact_match_and_ranking(self):
        with tempfile.TemporaryDirectory(prefix="ntg bm25 ") as directory:
            root = Path(directory)
            src = root / "src.py"
            src.write_text(
                "def parseURL(url: str):\n"
                "    return url.split('/')\n"
                "\n"
                "def other_function():\n"
                "    pass\n"
            )
            util = root / "util.py"
            util.write_text(
                "def parse_string(s: str):\n"
                "    return s.strip()\n"
                "\n"
                "def get_url():\n"
                "    return 'http://example.com'\n"
            )

            # Search exact function name
            results = wf.search("parseURL", [str(root)])
            self.assertGreater(len(results), 0)
            top = results[0]

            # Exact match should rank at top
            self.assertIn("src.py:1-", top.range)
            self.assertGreater(top.score, 0.0)

            # Support tuple unpacking and attribute access
            r, s = top
            self.assertEqual(r, top.range)
            self.assertEqual(s, top.score)

            # Usable directly by ctx
            ctx_out = wf.ctx(top.range)
            self.assertIn("def parseURL", ctx_out)

    def test_wf_search_camel_and_snake_case_tokens(self):
        with tempfile.TemporaryDirectory(prefix="ntg bm25 case ") as directory:
            root = Path(directory)
            (root / "mod.py").write_text(
                "def my_func():\n"
                "    parseURL('http://test')\n"
            )

            # camelCase part search: "url"
            results_url = wf.search("url", [str(root)])
            self.assertGreater(len(results_url), 0)
            self.assertIn("mod.py:1-", results_url[0].range)

            # snake_case part search: "func"
            results_func = wf.search("func", [str(root)])
            self.assertGreater(len(results_func), 0)
            self.assertIn("mod.py:1-", results_func[0].range)

    def test_wf_search_ignores_binary_files(self):
        with tempfile.TemporaryDirectory(prefix="ntg bm25 bin ") as directory:
            root = Path(directory)
            bin_file = root / "data.bin"
            bin_file.write_bytes(b"some text\x00with secret_token_xyz inside\n")
            txt_file = root / "code.py"
            txt_file.write_text("def regular_code():\n    pass\n")

            results = wf.search("secret_token_xyz", [str(root)])
            self.assertEqual(len(results), 0)

            results_reg = wf.search("regular_code", [str(root)])
            self.assertEqual(len(results_reg), 1)
            self.assertIn("code.py:1-", results_reg[0].range)
            self.assertNotIn("data.bin", [r.range for r in results_reg])


    def test_wf_search_cli(self):
        with tempfile.TemporaryDirectory(prefix="ntg bm25 cli ") as directory:
            root = Path(directory)
            (root / "app.py").write_text("def runServer():\n    pass\n")

            # Valid CLI invocation
            res = subprocess.run(
                [sys.executable, str(ROOT / "tools/wf.py"), "search", "runServer", str(root)],
                capture_output=True, text=True,
            )
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertIn("app.py:1-", res.stdout)

            # Usage error on missing arguments
            res_bad = subprocess.run(
                [sys.executable, str(ROOT / "tools/wf.py"), "search"],
                capture_output=True, text=True,
            )
            self.assertEqual(res_bad.returncode, 2)


if __name__ == "__main__":
    unittest.main()
