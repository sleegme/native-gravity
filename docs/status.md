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

Validated on AGY 1.1.21:

- custom-primary Bulldozer can actually invoke internal subagents on the current AGY build
- Piledriver remains planning-only in real runs
- Excavator can edit and verify end-to-end on Pro tier
- Puma handles quick/writing work without unnecessary Advisor ceremony
- Bobcat -> Advisor gate still converges correctly after rename
- Bobcat attempts no subagent other than gravity-advisor (negative delegation case)
- Zen verdict is observed before completion claims

Pending revalidation after the Zen shell change:

- Zen can run independent verification commands with the required `NTG_ZEN_VERIFY=1` marker
- marked common direct-mutation shell attempts are denied while ordinary verification commands still run
- Bulldozer, Excavator, and other agents' unmarked shell calls are unaffected

The Zen guard is a behavioral backstop, not a complete read-only shell sandbox. AGY 1.1.21 still does not expose a native agent-specific read-only shell policy.

Naming still open:

- Advisor codename
