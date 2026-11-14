# 44G live model/packet A/B diagnosis

Date: 2026-10-03. Repository: `/home/sleeg/work/native-gravity`, main,
`8ed89a7a66d41568d203ef6e44ac4813841ff171`.

## Conclusion

The observed strict-JSON failure is **not Gemini-specific**: all five models
failed on the same complex inputs, and all five also failed after reduction.
The strongest narrowed hypothesis is an **output-framing / prompt-and-transport
contract mismatch**, not demonstrated input-length sensitivity. A Claude swap
alone does not resolve 44G.

Of 20 matrix calls, 19 returned prose (including Markdown-fenced JSON) and one
returned an empty response. All exited 0 with a SUCCESS envelope; none passed
`parseResponsePacket(parseResponseEnvelope(stdout))`. Eighteen responses
contained at least one syntactically valid JSON object inside a code fence.
Six were just a fenced object; the others included narration or trailing text.
This means most failures are not inability to construct JSON content: the whole
`response` string is not the JSON object the parser requires.

Reduction did not confirm the previous length hypothesis. The Gemini Flash
empty response was explicitly a print timeout returning partial output, which
must be distinguished from a completed model declining the packet contract.

## Method and scope

New harness: `.omo/evidence/2026-10-03-44g-model-ab.mjs`.
The original `2026-10-02-44g-live.mjs` was not modified.

The original multi-milestone scenario does **not** invoke Piledriver: it starts
with a supplied two-milestone plan and calls Bulldozer for milestone `one`.
The diagnostic captures that actual first Bulldozer packet through
`MinimalSpine.runMilestone('one')` with a non-live intercept.
For Piledriver it uses the original harness's `requestPlan` task (inspect
package.json and advise on a v2 revision), against the same fresh initial plan.
This is a planner comparison, not a replay of a nonexistent multi-milestone
Piledriver call or the previous run's accumulated failure ledger.

Each role's composed prompt is byte-identical across the five model slugs.
Role bodies come from `docs/specs/vnext/agents`; native roles remain selected
through the existing `--agent` flag. No draft agent was activated.

Complex plan: two milestones, README.md name then package.json version.
Reduced plan: one milestone, shorter goal/objective/acceptance text. Planner
task and role bodies are unchanged. Bulldozer already receives only one
milestone, so removing the second plan milestone does not shorten its packet;
its reduction is the shorter objective and acceptance text.

| Role | Complex prompt characters | Reduced prompt characters | Reduction |
| --- | ---: | ---: | ---: |
| piledriver | 4321 | 3866 | 455 (10.5%) |
| bulldozer | 5279 | 5179 | 100 (1.9%) |

These are prompt characters, not the entire native AGY/model context. This
modest reduction cannot exclude a threshold elsewhere in the native context.

Calls used the original per-invocation permission flag without changing any
permission settings: `agy --dangerously-skip-permissions -p <prompt> --agent
<role> --model <slug> --output-format json --print-timeout 90s`. Inspection
requests were read-only. Capture ledgers and transcripts are in fresh temporary
directories. Each completed call records exit code, packet validity, class,
first 200 response characters, full stdout/stderr, parsed result, prompt hash,
and elapsed time. Start records and results are persisted incrementally.

Twenty matrix calls plus one optional schema call were made. Per model/shape
there were two role calls (three for complex Flash including schema), below the
10-call bound. No retries or model substitution were used.

## Response matrix

`prose` means the inner response is not directly parseable JSON; fenced JSON
therefore counts as prose. `JSON` is lexical classification, while
`validJsonPacket` additionally requires a successful envelope and JSON object.
Every entry below has exitCode 0 and validJsonPacket false.

| Model slug | Complex piledriver | Complex bulldozer | Reduced piledriver | Reduced bulldozer |
| --- | --- | --- | --- | --- |
| gemini-3.8-flash-high | prose | prose | empty | prose |
| gemini-3.1-pro-high | prose | prose | prose | prose |
| claude-sonnet-5-5-high | prose | prose | prose | prose |
| claude-opus-5-5-high | prose | prose | prose | prose |
| claude-sonnet-5-5-medium | prose | prose | prose | prose |

Notable distinctions:

- Complex Flash/Piledriver returned only waiting-for-Jaguar narration.
- Claude planners produced JSON objects in Markdown fences in all six
  complex/reduced calls; this is still `INVALID_RESPONSE_FORMAT`.
- Bulldozer responses across families contained fenced DONE packets, usually
  mixed with progress updates or summaries. Parseability is not evidence that
  their artifact binding or claimed observations satisfy the spine's gates.
- Gemini Pro's complex planner response ended with `PLAN READY`, in addition to
  a fenced JSON object. Claude planner responses generally retained advisory,
  non-completion language, but did not meet raw-JSON framing either.
- Reduced Flash/Piledriver returned `response: ""` with stderr
  `[agy] print timeout after 1m30s with turn in progress; returning partial output`.
  Exit 0 / SUCCESS is therefore not proof of a completed turn.

## Optional schema probe

Flash/Bulldozer used the **same complex prompt hash** with `--json-schema`.
The schema required the result-packet fields and constrained status to
DONE/BLOCKED/NEEDS_DEEP. It specified candidate_artifact_ref as a string.

Result: exit 0, SUCCESS envelope, prose, validJsonPacket false,
`INVALID_RESPONSE_FORMAT`. The envelope echoed the schema in `json_schema`
but provided no separate structured result. Its response contained progress
narration, two fenced JSON objects and summaries; candidate_artifact_ref was
an object rather than the schema's string type.

However, stderr explicitly reported a 90-second print timeout with the turn
still in progress and partial output returned. Thus **the flag did not fix this
bounded live probe**, but completed-turn schema enforcement remains unproven.
Do not infer from this partial-output sample that the flag can never enforce a
final schema.

AGY help writes to stderr here. The initial matrix run's stdout-only detection
missed the supported flag; the harness was corrected to inspect both streams,
then run once with `--schema-only`, without repeating the matrix.

## Mechanism and remaining uncertainty

OBSERVED:

1. `--output-format json` wraps responses in a JSON envelope. It does not make
   the observed inner response strings raw JSON packets.
2. `parseResponseEnvelope` accepts SUCCESS/string responses; the next parser
   uses `JSON.parse` on the **entire** inner response and rejects fences,
   prefatory progress text, trailing summaries and empty strings.
3. The spine asks for JSON advice/results, but does not explicitly require a
   single bare object with no code fences, progress updates or trailing text.
4. Native `--agent` roles and injected vNext bodies coexist. The checked-in
   native Piledriver requires `PLAN READY` after readiness review, whereas the
   injected advisory contract prohibits completion claims. Gemini Pro actually
   emitted that native terminal text. Other native/injected topology differences
   remain potential prompt conflicts, not resolved by swapping model family.
5. The returned response strings can include multiple progress statements and
   fenced packets. Whether AGY concatenates messages or models emit them in one
   final message was not independently established by this envelope-only probe.

INFERRED:

The immediate 44G ingress failure is predominantly incompatible response
framing across model families. Native role composition and intermediate-output
handling are plausible contributors. The isolated empty sample is associated
with timeout/lifecycle behavior. Model choice affects style and speed in this
sample, but no tested Claude model satisfies the existing strict contract.

UNKNOWN:

One observation per cell and fixed model order do not establish failure rates
or eliminate service/session effects. The reduced inputs preserve substantial
role and lifecycle instructions, so no general length threshold is proven or
excluded. A completed schema-enforced response and an explicit bare-JSON-only
prompt have not been tested. No Zen review, full scenario completion, provenance
closure or activation readiness is established by this diagnostic.

The next bounded experiment would isolate an explicit output-only instruction
and final-message handling on the unchanged complex packet, rather than
activate vNext or broadly change permission policy. This is a proposed follow-up,
not a change made here; it should preserve strict parsing and candidate gates
rather than treat arbitrary recovered fenced objects as accepted results.

## Artifacts and verification

- Matrix transcript (20 calls):
  `/tmp/ntg-44g-model-ab-JNmxf0/transcript.json`
- Schema-only transcript (1 call):
  `/tmp/ntg-44g-model-ab-AdVt5U/transcript.json`
- Dry-run transcript (no AGY calls):
  `/tmp/ntg-44g-model-ab-OP9sCK/transcript.json`
- Findings: `.omo/evidence/2026-10-03-44g-model-ab-findings.md`

The transcripts contain full commands/prompts and response excerpts, including
the schema-probe partial-output warning. Temporary paths are local evidence,
not committed repository artifacts.

`node --check` passed for the final harness. Dry-run packet capture passed;
both live processes exited 0 and produced complete transcript records.
LSP diagnostics were unavailable because typescript-language-server is not
installed; no dependency installation was performed. These are diagnostic
observations, not a passing 44G acceptance suite.

Tracked and staged diffs were empty after the matrix. No runtime activation,
AGENTS.md edit, permission-setting change or commit was performed. The two new
evidence files remain untracked. The pre-existing untracked
`.omo/evidence/pr-53-gate-review.md` was left untouched.
