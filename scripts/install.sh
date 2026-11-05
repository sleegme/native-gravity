#!/bin/sh
# Native Gravity installer (curl | sh)
#
# Versioned installation (pinned release):
#   curl -fsSL https://raw.githubusercontent.com/sleegme/native-gravity/v1.1.0/scripts/install.sh | sh
#
# Latest main branch:
#   curl -fsSL https://raw.githubusercontent.com/sleegme/native-gravity/main/scripts/install.sh | sh
#
# Forwarding arguments:
#   curl -fsSL https://raw.githubusercontent.com/sleegme/native-gravity/v1.1.0/scripts/install.sh | sh -s -- --help
#   curl -fsSL https://raw.githubusercontent.com/sleegme/native-gravity/v1.1.0/scripts/install.sh | sh -s -- reinstall

set -e

if command -v npx >/dev/null 2>&1; then
  exec npx --yes native-gravity "$@"
elif command -v bunx >/dev/null 2>&1; then
  exec bunx native-gravity "$@"
else
  echo "Native Gravity requires Node.js (npx) or Bun (bunx) on PATH to run the installer." >&2
  echo "Please install Node.js (>=18): https://nodejs.org/ or Bun: https://bun.sh/" >&2
  exit 1
fi
