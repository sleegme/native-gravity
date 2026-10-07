# AGY 1.3.1 side-probe (2026-10-07)

Probed a side-installed standalone `agy` 1.3.1 (`/tmp/agy-1-3-1/antigravity`, GitHub release `agy_cli_linux_x64.tar.gz`) against NTG's contract surface. System binary (`/usr/bin/agy`, pacman package `antigravity-cli 1.2.12`) was NOT modified.

## Surface probe (scripts/agy-compat-check.mjs)

| check | 1.2.12 | 1.3.1 | result |
|---|---|---|---|
| `--version` | `1.2.12` | `1.3.1` | expected diff |
| `models` | exit 0, full table | exit 0, identical head | SAME |
| `agents` | `bulldozer / excavator / piledriver` | identical | SAME |
| `plugins list` | `{"imports":[{"name":"native-gravity",...}]}` | identical | SAME |
| `--help` flag list | full | identical | SAME |

## Headless smoke on 1.3.1

- `--model gemini-3.8-flash-low --output-format json --print "Reply with exactly: PONG"` → `status: SUCCESS`, `PONG`, exit 0, 2.9s.
- `--dangerously-skip-permissions` (bulldozer path) → `SUCCESS`, `SKIP_OK`, exit 0, 2.8s.
- `--agent bulldozer --output-format json --print` → `SUCCESS`, `ROLE_OK`, exit 0 — installed plugin primary agent loads and answers on 1.3.1.

## Confirmed earlier (planning-time, still true)

- `model:` frontmatter accepts ONLY `inherit | flash | pro`; explicit slugs on subagents are not supported on any released line (changelog + https://antigravity.google/docs/subagents/).

## Not verified here (needs interactive/workspace context)

- Excavator/Zen hooks under a real task (`NTG_EXCAVATOR=1`, `NTG_ZEN_VERIFY=1` markers reaching run_command on 1.3.1) — compat checklist items 5-7, 10-11.
- Queued-message / stream-json semantics changes.
- 1.3.1 subagent `Error:` state visibility improvement is orthogonal to NTG gates.

## Post-approval upgrade + suite run (2026-10-07 ~23:2x KST)

- `agy update` self-update failed: `/usr/bin` not writable (pacman-owned). Non-destructive alternative taken: 1.3.1 binary installed to `~/.local/bin/agy`, which precedes `/usr/bin` in PATH — rollback is `rm ~/.local/bin/agy`.
- `which agy` → `/home/sleeg/.local/bin/agy`, `agy --version` → `1.3.1`.
- NTG suite under 1.3.1 PATH: python unittest discovery 90/90 OK; `node --test tests/*.mjs` 120/120 pass.
- Primary-review-gate direct smoke: `{"roleHint":"bulldozer","stopReason":"stop",...}` → `{"decision":"stop"}` (clean allow — synthetic, not a live Stop event).
