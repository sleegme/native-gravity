# Issue #59 — AGY 1.2.x host-surface revalidation

Date: 2026-09-30. Host: agy CLI 1.2.12 (`agy --version` → 1.2.12). Plugin
installed via `agy plugin install /tmp/ntg` on sleegme/native-gravity HEAD
(40bcc2b+NTG #62 merged). Follows docs/review/issue56-09preview-validation.md.

## Result matrix

| Path | Result |
|---|---|
| Bulldozer → Jaguar factual lookup | PASS — live `invoke_subagent` to jaguar returned the correct `model:` value from agents/puma.md |
| Bulldozer → Bobcat (nested gate) | PASS — bobcat wrote probe files via host write tools; nested delegation under Bulldozer completed |
| Bobcat → Strix Halo review | PASS — the second-hop review delegation completed inside the same session |
| Excavator → Zen completion gate | PASS — zen independently ran `NTG_ZEN_VERIFY=1` commands and returned `VERDICT: GO` (session a8adf6d8) |
| `run_command` shell guard | PASS — declared and registered on `^run_command$`; guarded commands still enforced |
| `agy --print` multi-tool sessions | PASS in 1.2.12 — multi-step tool use completed; earlier `error: interrupted` on 0.9-preview did not reproduce |
| Prompt drop | NOT REPRODUCED — full prompts flowed through multi-tool sessions |

## Transcript field-name comparison (1.2.12 real transcripts)

Real session transcripts under
`~/.gemini/antigravity-cli/brain/<uuid>/.system_generated/logs/transcript*.jsonl`:

- `type` values present: `USER_INPUT`, `SYSTEM_MESSAGE`, `PLANNER_RESPONSE`, `GENERIC`
- `tool_calls` records carry `name` + `args` where `invoke_subagent` args contain `Subagents`
- `detect_primary_role` on real transcripts resolves `bulldozer` and `piledriver` — role signatures embedded in session records match `AGENT_ROLE_SIGNATURES`
- Caveat: `agentName` records were NOT observed in live transcripts; role resolution relies on SYSTEM_MESSAGE/USER_INPUT signature matching, which works

## Host surface regression vs 0.9-preview (unchanged)

`list_dir`, `find_by_name`, `grep_search`, `multi_replace_file_content` are
still ABSENT on the live host surface. Agents that declare them may only use
the declared tools that exist (view_file, run_command, invoke_subagent,
write_to_file, replace_file_content) in live sessions.

## Evidence

- Probe sessions: brain/c15c0a7b, brain/9898b641, brain/b5487c46 (files under ~/.gemini/antigravity-cli/brain/*/.system_generated/logs/)
- Excavator→Zen session: excavator brain/c15c0a7b → zen a8adf6d8-b984-462f-91c7-05a9922b51cc returned `VERDICT: GO`
- Artifact files created by bobcat delegation: /tmp/ntg-bobcat-probe.txt, /tmp/ntg-bobcat2.txt
