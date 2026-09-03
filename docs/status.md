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
- Piledriver now has only two planning children: Jaguar for bounded read-only discovery and Zen for final plan-readiness review
- Piledriver requires authoritative target grounding before task-graph closure and an observed current Zen `VERDICT: GO` before `PLAN READY`
- v0.3.3 global Gemini 3.1 Pro mutation hook removed because Excavator must edit
- generic routing/docs updated for model-natural role allocation
- Zen now has verification-only `run_command` plus a marker-scoped `PreToolUse` behavioral guard for common intentional shell mutation paths
- Excavator now has a marker-scoped shell guard that preserves ordinary sudo while rejecting stdin-password privilege acquisition, alternate local privilege paths, shell-history credential mining, and broad system upgrades
- deterministic Excavator guard regression coverage in `tests/test_excavator_shell_guard.py`

Validated on AGY 1.1.21:

- custom-primary Bulldozer can actually invoke internal subagents on the current AGY build
- Piledriver remains planning-only in real runs
- Excavator can edit and verify end-to-end on Pro tier
- Puma handles quick/writing work without unnecessary Advisor ceremony
- Bobcat -> Advisor gate still converges correctly after rename
- Bobcat attempts no subagent other than gravity-advisor (negative delegation case)
- Zen verdict is observed before completion claims

Pending live validation:

- Piledriver can invoke Jaguar and Zen from a clean/current plugin install
- Piledriver does not invoke implementation workers
- a target-identity mismatch remains UNKNOWN / NEEDS_DISCOVERY instead of being promoted from the local checkout
- Jaguar discovery remains read-only and returns unresolved evidence requirements rather than crossing into mutation
- Zen `VERDICT: NO-GO` causes plan-only revision and a fresh review
- a materially revised plan cannot reuse an older Zen GO
- `PLAN READY` is emitted only after the actual current Zen `VERDICT: GO` is observed
- Zen can run independent verification commands with the required `NTG_ZEN_VERIFY=1` marker
- Zen-marked common direct-mutation shell attempts are denied while ordinary verification commands still run
- Excavator-marked ordinary sudo diagnostics and bounded repairs still run
- Excavator-marked `sudo -S`, `sudo su`, `pkexec`, local root SSH, shell-history credential mining, and full-system upgrade paths are denied
- wrapper forms such as `env pkexec`, `command ssh root@localhost`, and `bash -c 'sudo apt upgrade'` are denied
- downstream command arguments such as `sudo somecmd -S value` do not produce a sudo-stdin false positive
- Bulldozer and other agents' unmarked shell calls are unaffected

The planning review change is prompt-level first. No Piledriver Stop hook or custom coordination runtime is added until repeated real runs show that prose-level plan readiness cannot hold the boundary.

The Zen and Excavator guards are behavioral backstops, not complete shell or privilege sandboxes. AGY 1.1.21 still does not expose a native agent-specific read-only shell policy or reliable custom-agent identity in `PreToolUse` payloads.

Naming still open:

- Advisor codename
