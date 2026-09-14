#!/usr/bin/env bash
set -euo pipefail
C=/home/sleeg/work/ntg-vnext/.omo/evidence/ulw/01a0949f-7dc8-7494-b4b1-f137cebd5e3a/G001-root-work-ntg-vnext-parent-dir-is-no/a1/cleanroom-44e
export TMPDIR="$C/receipts/runtime"
export PYTHONDONTWRITEBYTECODE=1
export npm_config_cache="$C/receipts/npm-cache"
export PATH="/home/sleeg/.local/bin:$PATH"
cd /home/sleeg/work/ntg-vnext/native-gravity-44e
run() {
  printf '$'; printf ' %q' "$@"; printf '\n'
  local status=0
  "$@" || status=$?
  printf '[exit %s]\n' "$status"
  return "$status"
}
{
  printf 'cwd: %s\nTMPDIR: %s\nPYTHONDONTWRITEBYTECODE: %s\n' "$PWD" "$TMPDIR" "$PYTHONDONTWRITEBYTECODE"
  run node --version
  run python3 --version
  run bash -c 'node tests/test_spine.mjs && python3 tests/test_zen_shell_guard.py && node tests/test_runner_spike.mjs && node tests/test_ledger.mjs'
} 2>&1 | tee "$C/receipts/test-receipts.txt"
{
  printf 'No build script is declared in package.json. Run syntax checks and the CI package dry-run.\n'
  run node --check scripts/spine.mjs
  run node --check tests/test_spine.mjs
  run python3 -c 'import ast, pathlib; paths = ["hooks/zen-shell-guard.py", "tests/test_zen_shell_guard.py"]; [ast.parse(pathlib.Path(p).read_text(), filename=p) for p in paths]; print("Python AST syntax checks: PASS")'
  run python3 -c 'import json, pathlib; json.loads(pathlib.Path("hooks.json").read_text()); print("hooks.json parse: PASS")'
  run node --check scripts/npm-install.mjs
  run npm pack --dry-run
} 2>&1 | tee "$C/receipts/build-receipts.txt"
{
  run agy plugin validate .
} 2>&1 | tee "$C/receipts/plugin-validate.txt"
{
  printf '$ printf '\''%%s\\n'\'' '\''{"toolCall":{"name":"run_command","args":{"CommandLine":"NTG_ZEN_VERIFY=1 git status --short"}}}'\'' | python3 hooks/zen-shell-guard.py\n'
  printf '%s\n' '{"toolCall":{"name":"run_command","args":{"CommandLine":"NTG_ZEN_VERIFY=1 git status --short"}}}' | python3 hooks/zen-shell-guard.py | tee "$C/receipts/live-allow.json"
  printf '[exit 0]\n'
  printf '$ printf '\''%%s\\n'\'' '\''{"toolCall":{"name":"run_command","args":{"CommandLine":"NTG_ZEN_VERIFY=1 rm artifact"}}}'\'' | python3 hooks/zen-shell-guard.py\n'
  printf '%s\n' '{"toolCall":{"name":"run_command","args":{"CommandLine":"NTG_ZEN_VERIFY=1 rm artifact"}}}' | python3 hooks/zen-shell-guard.py | tee "$C/receipts/live-deny.json"
  printf '[exit 0]\n'
  run python3 -c 'import json, pathlib, sys; root = pathlib.Path(sys.argv[1]); assert json.loads((root / "live-allow.json").read_text())["decision"] == "allow"; assert json.loads((root / "live-deny.json").read_text())["decision"] == "deny"; print("Live synthetic hook decisions: PASS")' "$C/receipts"
} 2>&1 | tee "$C/receipts/live-hook.txt"
