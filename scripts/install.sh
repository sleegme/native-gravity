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

# Prerequisites
RUNNER=""
if command -v node >/dev/null 2>&1; then
  RUNNER="node"
elif command -v bun >/dev/null 2>&1; then
  RUNNER="bun"
else
  echo "Native Gravity requires Node.js (>=18) or Bun on PATH to run the installer." >&2
  echo "Please install Node.js: https://nodejs.org/ or Bun: https://bun.sh/" >&2
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "Native Gravity installer requires 'tar' on PATH to extract the release archive." >&2
  exit 1
fi

DOWNLOADER=""
if command -v curl >/dev/null 2>&1; then
  DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
  DOWNLOADER="wget"
else
  echo "Native Gravity installer requires 'curl' or 'wget' on PATH to download the release archive." >&2
  exit 1
fi

# Target & Release configuration
REF="${NATIVE_GRAVITY_REF:-v1.1.0}"
DEFAULT_URL="https://codeload.github.com/sleegme/native-gravity/tar.gz/${REF}"
ARCHIVE_URL="${NATIVE_GRAVITY_ARCHIVE_URL:-$DEFAULT_URL}"

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
TARGET_PARENT="${DATA_HOME}/native-gravity"
TARGET_DIR="${TARGET_PARENT}/${REF}"

mkdir -p "$TARGET_PARENT"

TMP_ARCHIVE="${TARGET_PARENT}/.download.${REF}.$$.tar.gz"
TMP_EXTRACT="${TARGET_PARENT}/.${REF}.tmp.$$"
BACKUP_DIR="${TARGET_PARENT}/.${REF}.old.$$"

cleanup() {
  rm -f "$TMP_ARCHIVE" 2>/dev/null || true
  rm -rf "$TMP_EXTRACT" 2>/dev/null || true
  if [ -d "$BACKUP_DIR" ] && [ ! -d "$TARGET_DIR" ]; then
    mv "$BACKUP_DIR" "$TARGET_DIR" 2>/dev/null || true
  else
    rm -rf "$BACKUP_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM HUP

# Download
if [ "$DOWNLOADER" = "curl" ]; then
  if ! curl -fsSL "$ARCHIVE_URL" -o "$TMP_ARCHIVE"; then
    echo "Failed to download Native Gravity archive from ${ARCHIVE_URL}" >&2
    exit 1
  fi
elif [ "$DOWNLOADER" = "wget" ]; then
  case "$ARCHIVE_URL" in
    file://*)
      FILE_PATH="${ARCHIVE_URL#file://}"
      if ! cp "$FILE_PATH" "$TMP_ARCHIVE" 2>/dev/null; then
        echo "Failed to download Native Gravity archive from ${ARCHIVE_URL}" >&2
        exit 1
      fi
      ;;
    *)
      if ! wget -qO "$TMP_ARCHIVE" "$ARCHIVE_URL"; then
        echo "Failed to download Native Gravity archive from ${ARCHIVE_URL}" >&2
        exit 1
      fi
      ;;
  esac
fi

# Extract
mkdir -p "$TMP_EXTRACT"
if ! tar -xzf "$TMP_ARCHIVE" -C "$TMP_EXTRACT" --strip-components=1; then
  echo "Failed to extract Native Gravity archive from ${ARCHIVE_URL}" >&2
  exit 1
fi

if [ ! -f "${TMP_EXTRACT}/scripts/npm-install.mjs" ]; then
  echo "Corrupt archive: scripts/npm-install.mjs not found in extracted archive from ${ARCHIVE_URL}" >&2
  exit 1
fi

# Atomic swap
if [ -d "$TARGET_DIR" ]; then
  mv "$TARGET_DIR" "$BACKUP_DIR"
fi
mv "$TMP_EXTRACT" "$TARGET_DIR"
rm -rf "$BACKUP_DIR" 2>/dev/null || true
rm -f "$TMP_ARCHIVE" 2>/dev/null || true

# Hand off
trap - EXIT INT TERM HUP
exec "$RUNNER" "${TARGET_DIR}/scripts/npm-install.mjs" "$@"
