# Excavator inheritance decision and live completion verification

Base: `bd1c6c8`, AGY `1.3.3`, 2026-10-12.
Owner delegated both the configuration decision and the remaining live
verification in Discord message `1559085851810463787`.

## Decision: keep explicit `inheritCustomizations: true`

Keep native Excavator's existing setting. In a controlled fresh-project
probe, true and omission propagated the workspace's required response
sentinel; false suppressed it. Retaining explicit true preserves workspace
instructions, including the user's local constraints. This is an instruction
inheritance decision, not authorization to widen Excavator's tool boundary.

Evidence: `137-inheritance-results.json`. All three runs used the same
prompt, model `gemini-3.8-flash-low`, installed native `excavator`, and
workspace. Only the installed Excavator frontmatter flag varied.
Each response used one turn and zero tool calls; the sentinel was absent
from the supplied prompt and appeared only in workspace `AGENTS.md`.

| Variant | Workspace sentinel in response | Session |
| --- | --- | --- |
| true | yes | `8dbc4275-59db-4da4-a170-7325f9e4f260` |
| false | no | `0119dde0-e413-4872-9a1a-4bddb61e1bb0` |
| omitted | yes | `23b31ffa-99c2-41f7-b70a-7e3a38ee8cf2` |

Scope of the inference: workspace-rule propagation on this CLI/runtime
and this probe. It does not prove every customization category, tool
permission behavior, or future AGY versions.

The official CLI frontmatter table fetched through Context7 and the current
subagent page does not document this field:
https://antigravity.google/docs/subagents?tab=cli
The live comparison is the basis for the decision, not a claim that the
documentation specifies its semantics. A preliminary local-agent discovery
attempt using the documented directory layout did not expose the variants;
the successful experiment therefore used controlled plugin reinstallations.
Main was restored after each changed-flag run. No global model settings,
credentials or unrelated user work were changed.

## Actual interactive completion verification

Parent: `463cad25-b7e6-4770-a86e-f56c8c30f6de`.
Primary model: `gemini-3.1-pro-high`.
Workspace: `<HOME>/.cache/ntg137-excavator-live`.
Only the disposable `fixture.txt` may be repaired.

The CLI runs interactively (`--prompt-interactive`), not print mode.
A temporary plugin observer records actual `PreToolUse` and `Stop`
payloads. The Stop observer delegates unchanged input to the existing
`excavator-review-gate.py` and forwards its exact output and exit code.
This is runtime evidence, not synthetic hook records.

For the NO-GO scenario, the first actual `invoke_subagent` hook changes
the already-verified fixture to `tampered\n` before Zen starts. Injection
is once-only, event-triggered, and restricted to the disposable fixture.
The second review is not injected.

- First real Zen child: `b0140a28-70b3-4dc4-b1bb-3f811e6784a8`.
- Observed independent verdict: `VERDICT: NO-GO`; tool inspection found
  `tampered\n`, nine bytes, instead of the required `alpha\n`, six bytes.
- Parent repaired the artifact and invoked a second independent review
  at actual invocation hook step 26 (parent transcript call step 25).
- Fresh Zen child: `6c9ce9d8-4989-4fe4-98d6-15d620da1ef8`; its returned
  `VERDICT: GO` independently verifies the six exact bytes `alpha\n`.
- The parent observes that provider message at transcript step 28 and
  reports READY at step 29. The actual terminal Stop event has
  `fullyIdle: true`, empty error, `terminationReason: NO_TOOL_CALL`;
  the unmodified gate returns `{"decision":"stop"}`, exit 0.
- The lead inspected the actual fixture: `alpha\n`.

The NO-GO -> repair -> fresh GO scenario passed.

## Post-GO mutation and re-review

In the same interactive parent session, the lead requested a bounded
follow-up: change the fixture to exactly `beta\n` using a direct edit,
treat the preceding alpha GO as stale and obtain fresh independent review.

- Prior alpha GO is received at transcript step 28; first READY at 29.
- Follow-up direct `replace_file_content` is at step 33, after that GO.
- Parent verifies the new five-byte artifact and invokes fresh Zen at
  step 41 (actual invocation hook step 42).
- Fresh child `9445714d-c211-4fc2-9fb1-15a1235c0954` independently inspects
  `beta\n` and returns GO; the parent receives it at step 44.
- Parent READY is at step 45, after the new verdict. The actual terminal
  Stop event is fully idle and the unmodified gate returns stop, exit 0.
- Lead inspected the final fixture: exactly `beta\n`.

An additional **replay**, not a live premature-completion attempt, feeds
the existing gate an actual transcript prefix through step 34: old GO,
old READY, then the later direct write. With a terminal Stop-shaped event,
the gate returns continue with the stale-verdict reason. No transcript
records or verdicts were fabricated. This proves parsing of this real
transcript shape, but does not claim the CLI attempted an early READY
or was forced to retry by the hook in the live run.

## QA matrix and artifacts

| Scenario | Action | Observed | Verdict | Artifact |
| --- | --- | --- | --- | --- |
| Workspace inheritance | same one-turn/no-tool native prompt under true, false, omitted | true/omitted include rule; false excludes it | PASS | `137-inheritance-results.json` |
| NO-GO correction | actual interactive repair with once-only pre-Zen fixture injection | child NO-GO, direct repair, different child GO, READY, terminal Stop allowed | PASS | `137-live/parent.jsonl`, `zen-nogo.jsonl`, `zen-repair-go.jsonl`, `hook-events.jsonl` |
| Post-GO direct write | same-session follow-up from alpha to beta | actual direct write after first GO, new child GO before READY, terminal Stop allowed | PASS | `137-live/parent.jsonl`, `zen-postwrite-go.jsonl`, `hook-events.jsonl` |
| Stale old GO parsing | replay actual prefix through step 34 | continue with stale-verdict reason | PASS (REPLAY) | `137-live/post-write-prefix.jsonl`, `stale-replay.json` |
| Restore original plugin | supported uninstall/install from main; recursive comparison | agents/hooks/rules/hooks.json match main; three hooks restored | PASS | lead command output `NTG137_MAIN_RESTORED` |

`137-live/excavator-review-observer.mjs` archives the temporary observer;
it ran from `hooks/` during the experiment, next to the original gate.
`137-live/probe-hooks.json` records the temporary routing configuration.
The observer and routing were removed from the shipped directories after
the two live scenarios; Excavator frontmatter and original hooks have no
product diff. Main installation was restored before documentation edits.
Intermediate Stop events while a child is active are not terminal completion.

Live command shape (paths are placeholders for the local probe directory):

```bash
NTG137_HOOK_LOG=<probe>/hook-events.jsonl \
NTG137_CASE=nogo \
NTG137_INJECTED=<probe>/first-zen-injected \
NTG137_FIXTURE=<probe>/fixture.txt \
agy --new-project --agent excavator --model gemini-3.1-pro-high \
  --dangerously-skip-permissions --log-file <probe>/cli.log \
  --prompt-interactive "<bounded repair acceptance>"
```

The initial and follow-up prompts are preserved verbatim in the parent
transcript. All published local paths are redacted. Raw session IDs remain.
The owned interactive process was terminated only after the final READY
and fully-idle Stop had been observed; it was not killed during a review.

No new tests pin documentation prose. Related deterministic hook checks
and the independent final gate remain to be recorded before merge.
LSP tools for JavaScript/JSON were unavailable because their servers are
not installed; no dependency or global configuration was installed for them.
