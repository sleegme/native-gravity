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
exec > >(tee "$C/receipts/git-receipts.txt") 2>&1
run cd /home/sleeg/work/ntg-vnext/native-gravity-44e
run git status --short
run git branch --show-current
run git rev-parse HEAD
[[ $(git branch --show-current) == feat/issue-44e-minimal-spine ]]
[[ $(git rev-parse HEAD) == d7e35e4b2396916ed3a3832c2680a71bb178b030 ]]
[[ -z $(git status --porcelain) ]]
run git rev-parse HEAD^
# Soft reset changes only this branch/index, never restores legacy worktree files.
run git reset --soft d7e35e4b2396916ed3a3832c2680a71bb178b030^
for file in agents/bobcat.md agents/zen.md hooks/zen-shell-guard.py hooks.json scripts/spine.mjs tests/test_spine.mjs tests/test_zen_shell_guard.py; do
  run cp -- "$C/$file" "$file"
done
run sha256sum --check "$C/receipts/authored-sha256.txt"
run git add -- agents/bobcat.md agents/zen.md hooks/zen-shell-guard.py hooks.json scripts/spine.mjs tests/test_spine.mjs tests/test_zen_shell_guard.py
run git diff --cached --check
run git diff --cached --stat
run git status --short
