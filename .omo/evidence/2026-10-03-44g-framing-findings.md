# 44G explicit-output framing experiment

Date: 2026-10-03. Repository: `/home/sleeg/work/native-gravity`, main,
`8ed89a7a66d41568d203ef6e44ac4813841ff171`.

## Verdict

**Explicit bare-JSON instructions can produce parser-accepted responses, but
are not sufficient across both models and roles in this experiment.**
Control passed 0/4 calls; variant b passed 1/4; variant c passed 2/4.
Claude/Piledriver passed b and c; Gemini Flash/Bulldozer passed c.
No variant passed both models for either role, so all 12 allowed calls ran.

The completed malformed responses support the output-framing mismatch:
progress text, fences, trailing commentary, and in one call two successive
packets prevent parsing the whole response. Three Gemini/Piledriver calls
instead timed out with empty partial output; those do not demonstrate that a
completed Gemini planner rejects the framing instruction.

Evidence supports retaining explicit prompt instructions **and investigating
strict, ambiguity-rejecting unwrapping at the transport/packet boundary**.
Prompt-hardening alone is not a demonstrated fix. Outermost-object extraction
passes the existing strict parser for 8/12 responses, versus 3/12 raw; this
recovers five additional framing failures. It does not solve empty timeouts
or the two-object response. Envelope inspection provides **no available
final-message field**, so switching to a final-only envelope field is not
a supported fix on this observed surface. Preserving message boundaries in
AGY could be a better future transport change, but was not implemented or
proven here. Do not equate substring recovery with authoritative final-message
extraction.

Any eventual unwrapping must parse the entire extracted candidate strictly,
require a single unambiguous object, and preserve envelope/tool-denial checks,
role packet validation, artifact binding and downstream gates. It must not
accept arbitrary fenced blobs or silently select one of multiple packets.
`parseResponsePacket` itself only checks JSON object syntax/type, not role
schema or milestone acceptance. These results prove ingress parseability,
not 44G acceptance or activation readiness.

## Method

New harness: `.omo/evidence/2026-10-03-44g-framing.mjs`.
The prior harness and all existing files were left unchanged.
The same complex plan and spine intercept generate both role packets;
`composeBoundedPrompt` loads role bodies from `docs/specs/vnext/agents`.
No draft native agent was installed or activated.

Dry-run comparison against the A/B dry-run transcript confirmed byte-identical
base prompts:

| Role | Characters | Base prompt SHA-256 |
| --- | ---: | --- |
| piledriver | 4321 | `40fa1073aa6c5d2c2a7ab1a6e2cd7005137bd3ababded253b95a9771ce02528a` |
| bulldozer | 5279 | `ad9031a4a3f421a5747cc2916fce922159732aeaf19d4425922054e0e275cc3b` |

Variants:

- a: unchanged control.
- b: append exactly: "Your entire response must be exactly one bare JSON object — no markdown fences, no progress updates, no commentary before or after. Response format contract: the final message must start with '{' and end with '}'."
- c: b plus: `The parser rejects any text outside the object. Intermediate progress belongs in a single "progress" field inside the JSON.`

Calls were sequential, role then variant then model, with one observation per
cell and no retries. The early-stop rule skips later variants for a role if
both models strictly pass a variant without partial-output warnings.
The global maximum is 12 AGY invocations. Native roles are still selected
with `--agent`; existing native/injected role conflicts remain possible.

The command retains the prior run's per-invocation permission flag:
`agy --dangerously-skip-permissions -p <prompt> --agent <role> --model <slug>
--output-format json --print-timeout 90s`. No permission or allowlist setting
was changed. Outer process deadline is 100 seconds.

Raw acceptance is exitCode 0 plus
`parseResponsePacket(parseResponseEnvelope(stdout)).ok`. Classes are lexical:
bare-json is a parseable JSON object; fenced-json contains Markdown code
fences but fails raw parsing; prose is other nonempty output; empty is blank.
Recovery probes separately remove only boundary code fences, or take the
substring from the first `{` through the last `}`. Each candidate goes through
the same strict object parser while retaining the original envelope validity.
No recovery changes production parsing or counts as raw acceptance.

## Variant matrix

Exact model slugs: Flash = `gemini-3.8-flash-high`;
Sonnet = `claude-sonnet-5-5-high`. Every call exited 0 with a SUCCESS envelope.
Elapsed is measured process wall time, rounded to 0.1 seconds.
Recovery columns include unchanged already-valid responses.

| Role | Variant | Model | Exit | Raw strict | Class | Strip fences | Outermost object | Elapsed s | Partial timeout |
| --- | --- | --- | ---: | --- | --- | --- | --- | ---: | --- |
| piledriver | a | Flash | 0 | FAIL | empty | FAIL | FAIL | 96.5 | yes |
| piledriver | a | Sonnet | 0 | FAIL | fenced-json | FAIL | PASS | 44.3 | no |
| piledriver | b | Flash | 0 | FAIL | empty | FAIL | FAIL | 96.2 | yes |
| piledriver | b | Sonnet | 0 | PASS | bare-json | PASS | PASS | 21.6 | no |
| piledriver | c | Flash | 0 | FAIL | empty | FAIL | FAIL | 97.7 | yes |
| piledriver | c | Sonnet | 0 | PASS | bare-json | PASS | PASS | 16.9 | no |
| bulldozer | a | Flash | 0 | FAIL | fenced-json | FAIL | PASS | 71.1 | no |
| bulldozer | a | Sonnet | 0 | FAIL | fenced-json | FAIL | PASS | 25.6 | no |
| bulldozer | b | Flash | 0 | FAIL | prose | FAIL | PASS | 74.1 | no |
| bulldozer | b | Sonnet | 0 | FAIL | prose | FAIL | FAIL | 27.6 | no |
| bulldozer | c | Flash | 0 | PASS | bare-json | PASS | PASS | 73.4 | no |
| bulldozer | c | Sonnet | 0 | FAIL | prose | FAIL | PASS | 25.1 | no |

Total measured call time: 670.175 seconds (11 minutes 10.175 seconds).
Completed non-partial calls: 9; raw strict acceptance: 3/9.

Notable observations:

- All three Flash/Piledriver stderr streams report a 90-second print timeout
  with the turn still in progress and partial output returned. All inner
  responses are empty and fail `EMPTY_RESPONSE`. No outer timeout occurred.
- Sonnet/Piledriver control contains waiting-for-Zen narration, fenced JSON,
  trailing summary and `PLAN READY`. This reproduces both framing failure
  and the previously observed native/injected planning-role conflict.
- Sonnet/Piledriver c puts progress inside a `progress` field and returns
  one bare object. Variant b also returns one bare object.
- Both Bulldozer controls contain progress plus fenced JSON; removing only
  boundary fences is insufficient. Extracting their sole object parses.
- Flash/Bulldozer b removes fences but retains "Currently waiting for Jaguar
  subagent to complete factual discovery." before the object.
- Sonnet/Bulldozer b emits "Waiting for Jaguar's report." followed by two
  distinct DONE objects, the second updating the evidence after Jaguar
  arrives. First-to-last-brace extraction correctly fails strict parsing.
  Silently accepting the first or last packet would change the contract.
- Sonnet/Bulldozer c still starts with "Waiting for Jaguar's result." before
  its single object, despite both appended instructions.
- Flash/Bulldozer c returns one bare object, but omits the requested progress
  field. Its candidate_artifact_ref is an object and escalation_needs is null;
  parser acceptance does not establish downstream schema/gate acceptance.

## Envelope / final-message inspection

All 12 parsed envelopes expose the same top-level keys:

```text
conversation_id
status
response
duration_seconds
num_turns
usage
```

`usage` contains only numeric token counters (`input_tokens`, `output_tokens`,
`thinking_tokens`, `cache_read_tokens`, `total_tokens`). `num_turns` is 1 in
all calls. No `final_message`, assistant-message list, structured-result
field, or other final-only response field appears at any nested path.
Full recursive key/type inspection is captured for every call.

The only response-bearing field is `response`. It demonstrably holds progress
plus packet(s) in failed Bulldozer calls; `num_turns: 1` does not establish a
single final assistant message. Whether AGY concatenates separate assistant
messages or the model places everything in one message remains UNKNOWN from
these envelopes. There is no exposed field to test final-only extraction
without inventing a message-selection heuristic.

## Artifacts and checks

- Harness: `.omo/evidence/2026-10-03-44g-framing.mjs`
- Findings: `.omo/evidence/2026-10-03-44g-framing-findings.md`
- Full 12-call transcript:
  `/tmp/ntg-44g-framing-6iUbIs/transcript.json`
- Framing dry run: `/tmp/ntg-44g-framing-0u1QYI/transcript.json`
- Comparison A/B dry run: `/tmp/ntg-44g-model-ab-OP9sCK/transcript.json`

Each live call records full stdout/stderr, raw response, exit code, elapsed
milliseconds, prompt hash, strict result, recovery results and recursive
envelope inspection. Start records also preserve each full prompt.
Capture ledgers live only in the fresh temporary evidence directory.

`node --check` and dry-run capture passed. The live harness exited 0, recorded
12 calls and a completion record. LSP diagnostics were unavailable because
`typescript-language-server` is not installed; no installation was performed.
Production code was not changed, so no production test suite was run.
One sample per cell cannot establish a reliability rate; print timeouts
leave completed Flash/Piledriver behavior unresolved.

Final workspace verification found empty tracked and staged diffs and the
same HEAD. Both new evidence files remain untracked. The three pre-existing
untracked evidence files were preserved. No commit, vNext activation,
AGENTS.md edit, permission change or allowlist change was made.
