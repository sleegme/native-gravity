#!/usr/bin/env bash
set -euo pipefail

live=false
if [[ "${1:-}" == "--live" ]]; then
  live=true
fi

fail=0

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "FAIL: missing command: $1" >&2
    fail=1
  else
    echo "OK: command $1"
  fi
}

need agy
if (( fail )); then
  exit 1
fi

models="$(agy models 2>&1)"
agents="$(agy agents 2>&1 || true)"

check_model() {
  local pattern="$1"
  if printf '%s\n' "$models" | grep -Eq "$pattern"; then
    echo "OK: model /$pattern/"
  else
    echo "FAIL: model /$pattern/ not found" >&2
    fail=1
  fi
}

check_agent() {
  local name="$1"
  if printf '%s\n' "$agents" | grep -Fq "$name"; then
    echo "OK: agent $name"
  else
    echo "FAIL: agent $name not found (plugin may not be installed/discovered)" >&2
    fail=1
  fi
}

check_model 'gemini-3\.7-flash-(low|medium|high)'
check_model 'gemini-3\.1-pro-(low|high)'
check_model 'claude-sonnet-4-6'
check_model 'claude-opus-4-6'

for agent in oma-main oma-implementation-flash oma-implementation-pro oma-review oma-explore oma-librarian; do
  check_agent "$agent"
done

if (( fail )); then
  exit 1
fi

if [[ "$live" == true ]]; then
  pro="$(printf '%s\n' "$models" | awk '{print $1}' | grep '^gemini-3\.1-pro-high$' | head -n1 || true)"
  echo "Running one small live Gemini 3.1 Pro/read-only probe; this consumes quota."
  agy -p 'Reply with exactly PONG. Do not call tools.' \
    --agent oma-review \
    --model "$pro" \
    --output-format text \
    --print-timeout 2m \
    --sandbox
fi

echo "Smoke test passed."
