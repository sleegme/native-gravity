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

## Live gated-role run on 1.3.1 (2026-10-07)

- `ntg-run --agent bulldozer --model gemini-3.8-flash-low -p "Reply with exactly: NTG_LIVE_OK"` → printed `NTG_LIVE_OK`, exit 0.
- `NTG_ROLE` marker confirmed present in the session transcript (`~/.gemini/antigravity-cli/brain/f1aa04d4-*/transcript.jsonl`) — the review-gate provenance path survives on 1.3.1.
- Version gate in `npm-install.mjs` verified with shims: `1.2.0` fails closed, `1.3.1` passes.

## Still open (needs multi-agent interactive run)

- Excavator → Zen review round-trip and Stop-hook firing behavior in an interactive session (compat checklist 5-7, 10-11). Headless `-p` does not fire Stop events by design (#64), so this must be exercised interactively or deferred.

## Hook guard contract verification (2026-10-07, hooks unchanged by 1.3.1)

Hooks read stdin JSON — contract surface is version-independent, but verified here for the record:

- zen-shell-guard: `NTG_ZEN_VERIFY=1 git status` → allow; `NTG_ZEN_VERIFY=1 rm -rf /tmp/x` → deny ("Zen permits only read-only verification commands"); unmarked mutation → allow (outside Zen boundary).
- excavator-shell-guard: `NTG_EXCAVATOR=1 sudo smartctl -a /dev/sda` → allow (sudo diagnostics OK per #64-era policy); `NTG_EXCAVATOR=1 sudo pacman -Syu` and `sudo pacman -Su` → deny (full-upgrade).
- primary-review-gate synthetic Stop event → clean allow; schema errors fail closed to deny.

Covers AGENTS.md checklist items 10-11 at the guard-contract level. Items 5-7 (live Excavator→Zen round-trip) still need an interactive session.

## Excavator→Zen gate round-trip on 1.3.1 (2026-10-07) — checklist 5-6, partial 7

`ntg-run --agent excavator --model gemini-3.8-flash-low --dangerously-skip-permissions -p "Create an empty file named marker.txt, then reply READY when done."`

Observed output (verbatim tail):
```
ROOT_CAUSE: CONFIRMED - Requested empty file marker.txt did not exist previously.
CHANGES: Created empty file marker.txt.
VERIFICATION_EVIDENCE: `ls -la marker.txt` confirms existence and 0-byte size.
ZEN_VERDICT: VERDICT: GO
ROLLBACK: `rm /tmp/ntg-live-ws/marker.txt`
READY
```

- Excavator can edit (marker.txt created via `NTG_EXCAVATOR=1 touch marker.txt` in transcript) — checklist 5 PASS.
- Zen invocation proven by transcript: `invoke_subagent` tool call with `TypeName:"zen"`, `Role:"Independent Reviewer"` (real subagent dispatch, not printed text) + subsequent `view_file` on the Zen transcript + `ZEN_VERDICT: VERDICT: GO` before READY — checklist 6 PASS.
- Checklist 7 (NO-GO / post-GO-write re-review forcing correction) NOT exercised — needs a failing-artifact scenario; remains open.
- Structured gate output (ROOT_CAUSE/CHANGES/VERIFICATION_EVIDENCE/ZEN_VERDICT/ROLLBACK) emitted correctly on 1.3.1.

## NEW upstream behavior confirmed on 1.3.1 (the "permissions respected" fix)

Without `--dangerously-skip-permissions`, the same excavator run failed with:

```
jetski: no output produced — a tool required the "command" permission that
headless mode cannot prompt for, so it was auto-denied. Add an allow-rule under
permissions.allow in settings.json (e.g. command(<target>)). Alternatively,
re-run with --dangerously-skip-permissions to auto-approve all tools.
```

This is the upstream fix NTG depended on: permission denials are now honored instead of silently auto-approved. NTG callers that run agents headlessly must either pass `--dangerously-skip-permissions` or pre-authorize `command(...)` rules in settings.json.

## Remaining open items

- Checklist item 7 (NO-GO re-review) — open, needs a deliberately failing artifact run.
- Checklist items 1-3, 8-9 (delegation graph breadth, Puma, observed-verdict internals) — role-body breadth, owner-scheduled interactive QA.
- Note: probe compares captured stdout heads (400-char truncation in the script), not whole outputs; table cells marked `identical` mean identical captured prefix.

## Checklist 7 — Zen NO-GO forces non-READY termination (2026-10-08)

`ntg-run --agent excavator --model gemini-3.8-flash-low --dangerously-skip-permissions -p "Create marker2.txt containing 'data'. Then obtain a Zen review against acceptance: marker2.txt exists AND is exactly 0 bytes."`

Observed behavior:
- Excavator created marker2.txt (4 bytes), invoked Zen (invoke_subagent dispatch), received `VERDICT: NO-GO` (file is 4 bytes, not 0).
- Excavator emitted structured gate output with `ZEN_VERDICT: VERDICT: NO-GO`, `ROOT_CAUSE: LIKELY` citing the contradiction, `ROLLBACK`, and terminated with `BLOCKED` — NOT `READY`.
- The gate therefore fails closed on NO-GO: no READY is emitted after an observed negative verdict. (The "post-GO-write forces fresh review" sub-case remains unexercised — it needs a transcript where a write follows the first GO; the NO-GO leg is proven.)

Checklist 7: **PASS** (NO-GO leg). Post-GO-rewrite re-review remains open but is a narrower hook condition already covered by the review-gate's stale-verdict logic (unit-tested in test_primary_review_gate.py).
