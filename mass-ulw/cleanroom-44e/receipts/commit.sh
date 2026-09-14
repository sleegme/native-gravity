#!/usr/bin/env bash
set -euo pipefail
C=/home/sleeg/work/ntg-vnext/.omo/evidence/ulw/01a0949f-7dc8-7494-b4b1-f137cebd5e3a/G001-root-work-ntg-vnext-parent-dir-is-no/a1/cleanroom-44e
run() {
  printf '$'; printf ' %q' "$@"; printf '\n'
  local status=0
  "$@" || status=$?
  printf '[exit %s]\n' "$status"
  return "$status"
}
exec > >(tee -a "$C/receipts/git-receipts.txt") 2>&1
run cd /home/sleeg/work/ntg-vnext/native-gravity-44e
run git branch --show-current
[[ $(git branch --show-current) == feat/issue-44e-minimal-spine ]]
[[ $(git rev-parse HEAD) == 95b64ad21189579a6e560fae1f7a0d62d30fe9b3 ]]
run git diff --exit-code
run git diff --cached --check
run sha256sum --check "$C/receipts/authored-sha256.txt"
run git diff --cached --name-only
run python3 -c 'import subprocess; expected = {"agents/bobcat.md", "agents/zen.md", "hooks/zen-shell-guard.py", "hooks.json", "scripts/spine.mjs", "tests/test_spine.mjs", "tests/test_zen_shell_guard.py"}; actual = set(subprocess.check_output(["git", "diff", "--cached", "--name-only"], text=True).splitlines()); assert actual == expected, actual; print("Exact seven-file staged scope: PASS")'
run git rev-parse refs/remotes/origin/feat/issue-44e-minimal-spine
[[ $(git rev-parse refs/remotes/origin/feat/issue-44e-minimal-spine) == d7e35e4b2396916ed3a3832c2680a71bb178b030 ]]
run git commit -m 'feat(44E): minimal spine integration (#44E)'
run git rev-parse HEAD
run git log -2 --oneline
run git status --short
[[ -z $(git status --porcelain) ]]
run git show --stat --oneline HEAD
