"""Workflow helpers to import from one Python script.

Add the installed plugin's tools directory to sys.path, then import wf.
ctx and git_snap return stdout plus stderr as text, including inline errors.
"""
import os
import subprocess

_DIR = os.path.dirname(os.path.abspath(__file__))


def _run(tool: str, *args: str) -> str:
    result = subprocess.run(
        [os.path.join(_DIR, tool), *args], capture_output=True, text=True,
    )
    return result.stdout + result.stderr


def ctx(*files: str) -> str:
    return _run("ctx", *files)


def git_snap() -> str:
    return _run("git-snap")
