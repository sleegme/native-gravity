# Native Gravity installer (PowerShell)
#
# Versioned installation (pinned release):
#   irm https://raw.githubusercontent.com/sleegme/native-gravity/v1.1.0/scripts/install.ps1 | iex
#
# Latest main branch:
#   irm https://raw.githubusercontent.com/sleegme/native-gravity/main/scripts/install.ps1 | iex
#
# Forwarding arguments:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/sleegme/native-gravity/v1.1.0/scripts/install.ps1))) --help
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/sleegme/native-gravity/v1.1.0/scripts/install.ps1))) reinstall

$ErrorActionPreference = 'Stop'

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine("Native Gravity requires Node.js (npx) on PATH to run the installer.")
    [Console]::Error.WriteLine("Please install Node.js (>=18): https://nodejs.org/")
    exit 1
}

& npx --yes native-gravity @args
exit $LASTEXITCODE
