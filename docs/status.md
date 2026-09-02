# Status

## Release track

`v0.4 alpha`

## State

**v0.4 alpha — core runtime validation passed on AGY 1.1.21; ready for alpha use.**

Implemented:

- peer primary modes: Bulldozer / Piledriver / Excavator
- internal renames: Worker -> Bobcat, Explorer -> Jaguar, Deep -> Steamroller, Reviewer -> Zen
- new Puma quick/writing path
- Bobcat -> gravity-advisor local gate retained
- v0.3.3 global Gemini 3.1 Pro mutation hook removed because Excavator must edit
- generic routing/docs updated for model-natural role allocation
- Zen now has verification-only `run_command` plus a marker-scoped `PreToolUse` behavioral guard for common intentional shell mutation paths
- Excavator now has a marker-scoped shell guard that preserves ordinary sudo while rejecting stdin-password privilege acquisition, alternate local privilege paths, shell-history credential mining, and broad system upgrades
- Excavator can invoke Zen only as its independent final completion reviewer
- a plugin `Stop` hook now blocks normal Excavator completion when Zen review is missing, pending, NO-GO, or stale after a later direct write/marked Excavator shell call
- verified BLOCKED and abnormal runtime termination remain allowed so the review gate does not manufacture a completion loop
- deterministic shell-guard regression coverage in `tests/test_excavator_shell_guard.py`
- deterministic Excavator review-gate coverage in `tests/test_excavator_review_gate.py`

Validated on AGY 1.1.21 before the new Excavator review gate:

- custom-primary Bulldozer can actually invoke internal subagents on the current AGY build
- Piledriver remains planning-only in real runs
- Excavator can edit and verify end-to-end on Pro tier
- Puma handles quick/writing work without unnecessary Advisor ceremony
- Bobcat -> Advisor gate still converges correctly after rename
- Bobcat attempts no subagent other than gravity-advisor (negative delegation case)
- Bulldozer observes Zen verdicts before completion claims

Pending live revalidation after the shell-guard changes:

- Zen can run independent verification commands with the required `NTG_ZEN_VERIFY=1` marker
- Zen-marked common direct-mutation shell attempts are denied while ordinary verification commands still run
- Excavator-marked ordinary sudo diagnostics and bounded repairs still run
- Excavator-marked `sudo -S`, `sudo su`, `pkexec`, local root SSH, shell-history credential mining, and full-system upgrade paths are denied
- wrapper forms such as `env pkexec`, `command ssh root@localhost`, and `bash -c 'sudo apt upgrade'` are denied
- downstream command arguments such as `sudo somecmd -S value` do not produce a sudo-stdin false positive
- Bulldozer and other agents' unmarked shell calls are unaffected

Pending live validation for the Excavator completion review gate:

- Excavator can invoke Zen from a custom-primary session and observe the returned verdict
- a normal Excavator stop without Zen review is forced back into the execution loop
- `VERDICT: GO` for the current artifact permits completion
- `VERDICT: NO-GO`, a newer unfinished Zen invocation, or a post-GO direct write/marked Excavator shell call forces correction and a fresh review
- a verified BLOCKED result can terminate without Zen
- non-Excavator sessions remain unaffected by the Stop hook

The Zen and Excavator shell guards are behavioral backstops, not complete shell or privilege sandboxes. AGY 1.1.21 does not expose reliable custom-agent identity in `PreToolUse` payloads. The current Stop-hook contract likewise does not document an explicit custom-agent-name field, so the Excavator review gate scopes itself from structured transcript identity/system-prompt evidence when available and the existing `NTG_EXCAVATOR=1` shell marker. Live transcript-shape validation is therefore required before treating the new gate as a complete role-identity boundary.

Naming still open:

- Advisor codename
