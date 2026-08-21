#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v agy >/dev/null 2>&1; then
  echo "agy not found on PATH" >&2
  exit 127
fi

"$SCRIPT_DIR/build-review-packet.sh" >/dev/null

models="$(agy models 2>&1)"
if [[ -n "${OMA_REVIEW_MODEL:-}" ]]; then
  model="$OMA_REVIEW_MODEL"
else
  model="$(printf '%s\n' "$models" | awk '{print $1}' | grep '^claude-opus-4-6' | head -n1 || true)"
fi

if [[ -z "$model" ]]; then
  echo "No Claude Opus 4.6 model slug found in 'agy models'." >&2
  echo "Set OMA_REVIEW_MODEL explicitly to override." >&2
  exit 2
fi

prompt='Act as the oh-my-agy final review gate. Read .oma/review-packet.md first, then inspect any relevant current source files needed to verify the change. Stay read-only. Check acceptance criteria, correctness, regressions, scope, risky deletion, public contracts, and verification adequacy. Ignore non-blocking nits. End with exactly VERDICT: GO or VERDICT: NO-GO.'

agy -p "$prompt" \
  --agent oma-review \
  --model "$model" \
  --effort high \
  --output-format text \
  --print-timeout 15m \
  --sandbox
