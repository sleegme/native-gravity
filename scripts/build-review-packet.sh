#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "oma packet must run inside a git worktree" >&2
  exit 1
fi

mkdir -p .oma
packet=.oma/review-packet.md

{
  echo "# OMA Review Packet"
  echo
  echo "## Task contract"
  echo
  if [[ -f .oma/task-contract.md ]]; then
    cat .oma/task-contract.md
  else
    echo "(missing .oma/task-contract.md)"
  fi
  echo
  echo "## Implementation evidence"
  echo
  if [[ -f .oma/implementation-evidence.md ]]; then
    cat .oma/implementation-evidence.md
  else
    echo "(missing .oma/implementation-evidence.md)"
  fi
  echo
  echo "## Git status"
  echo
  echo '```text'
  git status --short
  echo '```'
  echo
  echo "## Untracked paths"
  echo
  echo '```text'
  git ls-files --others --exclude-standard
  echo '```'
  echo
  echo "## Diff stat"
  echo
  echo '```text'
  git diff --stat
  git diff --cached --stat
  echo '```'
  echo
  echo "## Working tree diff"
  echo
  echo '```diff'
  git diff --no-ext-diff
  echo '```'
  echo
  echo "## Staged diff"
  echo
  echo '```diff'
  git diff --cached --no-ext-diff
  echo '```'
} > "$packet"

echo "$packet"
