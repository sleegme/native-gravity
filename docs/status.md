# Status

## Current branch

`feat/v0.4-construction-primary-agents`

## State

**v0.4 alpha — architecture implemented, runtime validation pending.**

Implemented:

- peer primary modes: Bulldozer / Piledriver / Excavator
- internal renames: Worker -> Bobcat, Explorer -> Jaguar, Deep -> Steamroller, Reviewer -> Zen
- new Puma quick/writing path
- Bobcat -> gravity-advisor local gate retained
- v0.3.3 global Gemini 3.1 Pro mutation hook removed because Excavator must edit
- generic routing/docs updated for model-natural role allocation

Pending validation:

- custom-primary Bulldozer can actually invoke internal subagents on the current AGY build
- Piledriver remains planning-only in real runs
- Excavator can edit and verify end-to-end on Pro tier
- Puma handles quick/writing work without unnecessary Advisor ceremony
- Bobcat -> Advisor gate still converges correctly after rename
- Zen verdict is observed before completion claims

Naming still open:

- Advisor codename
