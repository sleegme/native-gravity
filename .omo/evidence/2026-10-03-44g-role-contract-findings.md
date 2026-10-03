# 44G role-contract conflict

## Invocation investigation and decision

Investigation preceded role edits, which preceded parser work.
The complete issue #44 diagnostic comment was read with:
`gh issue view 44 --json comments --jq '.comments[-1].body'`.

OBSERVED:

- `/usr/bin/agy` belongs to `antigravity-cli 1.2.12_5784551402897408-1`.
  It is a stripped ELF binary; `/usr/src/debug/antigravity-cli` contains no
  source. No claim is made to have inspected its compiled prompt assembler.
- `agy agents` lists bulldozer, excavator and piledriver. `agy plugin list`
  reports native-gravity imported on 2026-09-30, with agents and hooks.
  Installed definitions live in
  `/home/sleeg/.gemini/config/plugins/native-gravity/agents/`.
- Installed Piledriver requires a current Zen GO and says:
  "When READY, end with exactly `PLAN READY`." Live Bulldozer owns global
  completion and requires standalone `READY`. These are role instructions,
  not merely names.
- Official AGY documentation describes custom-agent Markdown bodies as system
  instructions and `--agent` as selecting that agent:
  <https://antigravity.google/docs/cli/commands/agents.md>,
  <https://antigravity.google/docs/cli/subagents.md>,
  <https://antigravity.google/docs/cli/headless.md>.
- The existing A/B and framing harnesses explicitly combine `--agent <role>`
  with `composeBoundedPrompt(..., { roleBodyDir:
  '../docs/specs/vnext/agents' })`. That supplies both contracts.
- `/tmp/ntg-44g-model-ab-JNmxf0/transcript.json`, call
  `complex:gemini-3.1-pro-high:piledriver`, ends in `PLAN READY`.
  `/tmp/ntg-44g-framing-6iUbIs/transcript.json`, call
  `piledriver:a:claude-sonnet-5-5-high`, reports a Zen GO and ends in
  `PLAN READY`. The vNext planner prohibits these completion semantics.
- Production `invokeTransport` already omits `--agent`; the prior probes did
  not mirror it. However, `loadRoleBody` defaulted to `../agents`, composing
  the legacy contract even without native agent selection.

Decision: keep `--agent` absent, default this isolated runner to the vNext
role bodies, and use the same no-agent path in the new live comparison.
The three draft role bodies now explicitly distinguish MACHINE-INVOCATION
MODE from interactive reporting. Existing role-body overrides remain
explicit caller choices; missing bodies still fail closed.

Rejected alternative: editing live role contracts. That would change released
interactive behavior and would not update the separately installed plugin
without deployment. No installed role, permission, allowlist, AGENTS.md,
model policy or activation switch is changed.

This fixes selected-role contract composition, not native customization
isolation. Omitting `--agent` does not prove AGY excludes workspace/global
instructions or enforce the draft frontmatter's tool policy. OQ-6 remains
an activation blocker; the compiled runtime's full model context is UNKNOWN.

## Verification

Bounded live comparison executed on 2026-10-03 with
`.omo/evidence/2026-10-03-44g-role-contract-live.mjs` (transcript:
`/tmp/ntg-44g-role-contract-r9RWNc/transcript.json`, copied to
`.omo/evidence/2026-10-03-44g-role-contract-transcript.json`). Eight agy
calls — `gemini-3.8-flash-high` and `claude-sonnet-5-5-high` on the
`piledriver` and `bulldozer` roles, `before` = `--agent <role>` + pre-edit
vNext body, `after` = no `--agent` + new MACHINE-INVOCATION MODE body. The
harness asserted the replayed packet byte-identical to the historical
`complex` packet (`assert.deepEqual(packet, historical.packet)`), so both
arms carried the unchanged complex packets. Pass/fail below is measured on
the strict parser (`parseResponsePacket`); `bare strict` shows the same
payload under the old bare-`JSON.parse` equivalent; `partial` flags an
`agy` print-timeout. This table measures the combined fix (body repoint +
machine-mode section + strict unwrap), not isolated attribution.

| model | role | arm | transport | bare strict | extracted strict | result |
|---|---|---|---|---|---|---|
| gemini-3.8-flash-high | piledriver | before | partial (90s print timeout) | fail | fail | EMPTY_RESPONSE |
| gemini-3.8-flash-high | piledriver | after | partial (90s print timeout) | fail | fail | EMPTY_RESPONSE |
| gemini-3.8-flash-high | bulldozer | before | ok | fail | fail | INVALID_RESPONSE_FORMAT |
| gemini-3.8-flash-high | bulldozer | after | ok | fail | pass | DONE-candidate-valid-not-reviewed |
| claude-sonnet-5-5-high | piledriver | before | ok | fail | pass | narration-wrapped JSON extracted |
| claude-sonnet-5-5-high | piledriver | after | ok | pass | pass | bare JSON object |
| claude-sonnet-5-5-high | bulldozer | before | ok | fail | fail | INVALID_RESPONSE_FORMAT |
| claude-sonnet-5-5-high | bulldozer | after | ok | fail | pass | DONE-candidate-valid-not-reviewed |

Strict-parser pass rates (transport-ok calls):

- before arm, old bare-strict equivalent: 0/4 (0%); both completed
  transports produced narration-wrapped or multi-block output.
- before arm, new strict-unwrap parser: 1/4 completed (25%) —
  `claude-sonnet-5-5-high:piledriver` emitted a single JSON object inside
  narration that the unwrap extracted; the `bulldozer` responses carried
  competing JSON-bearing fragments and correctly failed closed.
- after arm, new strict-unwrap parser: 3/4 completed (75%); excluding the
  gemini `piledriver` print-timeout, 3/3 of completed transports passed.
  Both `bulldozer` completions additionally validated as
  `DONE-candidate-valid-not-reviewed` (schema + expected milestone +
  candidate ref; Zen verdict still required downstream).
- gemini-3.8-flash-high `piledriver` timed out identically in both arms
  (agy `--print-timeout 90s` partial output): a transport-boundary event,
  not a contract regression; it is counted as not-completed in both arms.

Parser regression checks executed on 2026-10-03 in this working tree:

- `node tests/test_runner_spike.mjs`: 41/41 PASS, including the new
  unwrap classifications (narration-embedded object, competing objects,
  unclosed candidates, arrays/scalars, malformed payloads) and the
  denied-envelope pass-through.
- `node --test tests/test_spine.mjs`: 41/41 PASS, including the new
  guards that an unwrapped candidate still fails schema or authority
  mismatch and still requires an independent matching Zen GO.

No activation or issue-state transition is authorized by this diagnostic.
