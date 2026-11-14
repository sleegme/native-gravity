# Issue #59 — AGY 1.2.x host-surface revalidation

Date: 2026-09-30 (revised after gate review). Host: agy CLI 1.2.12
(`agy --version` → 1.2.12). Clean reinstall per README
(`agy plugin uninstall native-gravity` → `agy plugin install /tmp/ntg`)
on HEAD (main post-#62, commit 1c42bbb): uninstall succeeded, install
processed 9 agents + 4 hooks, `agy plugin list` shows native-gravity
imported at 2026-09-30T05:15:34Z. Prior report structure follows
docs/review/issue56-09preview-validation.md.

## Result matrix

| Path | Result |
|---|---|
| Bulldozer → Jaguar factual lookup | PASS — live `invoke_subagent` returned `model: flash` from agents/puma.md (session b2f64648; child be07ff46) |
| Bulldozer → Bobcat → Strix Halo nested gate | PASS with `--dangerously-skip-permissions` — Bobcat created /tmp/ntg-bobcat3.txt (`gate-ok`), invoked Strix Halo (bf2dde20), returned `VERDICT: ACCEPT` via parent 2821e232. **Earlier attempts without auto-approve ended at a host permission denial before the second hop — headless probes need the flag.** |
| Excavator → Zen completion gate | PASS — zen ran `NTG_ZEN_VERIFY=1` commands and returned `VERDICT: GO` (parent c15c0a7b, zen a8adf6d8) |
| Piledriver → Jaguar/Zen plan gate | PASS — session b9812ffa: Jaguar discovery report + Zen `VERDICT: GO`, parent ended `PLAN READY` |
| `run_command` shell guard | PASS — two `^run_command$` PreToolUse registrations loaded; Zen's `NTG_ZEN_VERIFY` commands executed inside the allowed marker scope |
| `agy --print` multi-tool sessions | PASS — multi-step tool use completes in 1.2.12 |

## 1.2.x transcript contract (actual observed records)

Live transcripts under
`~/.gemini/antigravity-cli/brain/<uuid>/.system_generated/logs/`
(two files per session, `transcript.jsonl` and `transcript_full.jsonl`):

- Top-level fields: `step_index`, `source`, `type`, `status`, `created_at`,
  `content`, `thinking`, `tool_calls` (error records add `error`;
  truncated records add `truncated_fields`).
- `source`/`type` combos observed: `USER_EXPLICIT`/`USER_INPUT`,
  `SYSTEM`/`SYSTEM_MESSAGE`, `MODEL`/`PLANNER_RESPONSE`, `MODEL`/`GENERIC`.
- `tool_calls[].args` for `invoke_subagent` carries `Subagents` (list),
  `toolAction`, `toolSummary`; created-child messages carry `conversationId`
  and `logAbsoluteUri`.
- **`transcript.jsonl` truncates `tool_calls` args** (`truncated_fields:
  ["tool_calls"]`) — `transcript_full.jsonl` preserves them. Replaying the
  Excavator Stop parser: `review_state(full)` → `(True,'GO',50,27)`;
  `review_state(shortened)` → `(False,None,-1,27)`. The shortened file is
  NOT a valid substitute when a session's Stop event points at it.
- `agentName` records: NOT observed in any inspected 1.2.12 session.
- Role signatures: NOT injected by `--agent` into the transcript on 1.2.12
  (role body no longer appears as USER_INPUT/SYSTEM text).
  `detect_primary_role` returns `None` on the validation probes; it resolves
  a role only when the signature happens to appear in model output or a file
  read (e.g. session 4e3f33e3 answering 'quote your first sentence').

## Findings

1. **Delegation and review paths all pass on 1.2.12** with auto-approved
   permissions; the named-issue 'multi-tool interrupted' symptom did not
   reproduce.
2. **Stop hook inert under headless print mode** — the host does not invoke
   `Stop` commands for `agy -p` sessions (spy-instrumented gate received no
   event). Combined with the missing role-body injection, the completion
   gates cannot be exercised end-to-end from `-p` probes.
   Tracked as issue #64.
3. **Host tool surface** — `list_dir`, `find_by_name`, and `grep_search`
   demonstrably execute on live 1.2.12 sessions (invoked with results by
   Excavator c15c0a7b). `multi_replace_file_content` appears in the session
   tool environment but was not directly invoked in these probes — its
   availability is listed, not demonstrated. The earlier 'absent tools'
   characterization was stale; corrected here.
4. **`--agent` role injection removed** — role attribution must now rely on
   model echo or the session directory name (brain/<uuid>), not transcript
   text. Tracked as issue #64.

## Evidence

- Brain sessions: b2f64648, be07ff46 (Bulldozer→Jaguar); 2821e232, 87a5061e,
  bf2dde20 (nested gate); c15c0a7b, a8adf6d8 (Excavator→Zen);
  b9812ffa, 025c6e9d (Piledriver→Jaguar/Zen); 4e3f33e3 (role echo);
  ff21e598 (run_command probe).
- Probe artifacts: /tmp/ntg-bobcat-probe.txt, /tmp/ntg-bobcat2.txt,
  /tmp/ntg-bobcat3.txt.
- Parser replay via hook subprocess on the cited transcripts.
