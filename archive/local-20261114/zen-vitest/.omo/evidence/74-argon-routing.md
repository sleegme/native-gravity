# Issue #74: corrected Argon routing evidence

Observed 2026-10-16, AGY 1.3.6. This receipt supersedes the native-Pro claims
at `a825e225`. Piledriver, Steamroller and Zen still use exact-model policies.
Excavator and Strix Halo remain native Flash. Strix's shipped definition is
identical to `origin/main` (the deliberate #148 assignment).

## Native Pro did not select Argon

The original sentinel probe child `19e9cab6-5c09-4228-ba03-ff70b1cb0cd9`
contains `gemini-3.8-flash-high` in `trajectory_metadata_blob.data` and
`gemini-3.8-flash-tiered` in `gen_metadata.data` and `executor_metadata.data`.
The independent gate reported the same result for
`eacfb7e5-bd51-43fe-8e97-0ed6362d520b`. The successful sentinel was not evidence
of Argon selection.

## Exact-frontmatter feasibility and controls

Created a temporary workspace plugin below `.omo/tmp/74-model-probe/.agents/`
without installing anything or touching the global plugin checkout. It held
copies of the worker bodies and tools, with unique names to avoid collisions:

| Temporary agent | Requested frontmatter |
|---|---|
| `ntg74-excavator-high` | `model: gemini-4-argon-high` |
| `ntg74-strix-low` | `model: gemini-4-argon-low` |

A Flash primary `ntg74-dispatch-probe` had only `invoke_subagent`. Requests
specified the exact custom `TypeName`, no `Model` override, no workflow,
no file changes, and no child tools. Excavator was asked for a read-only
worker result; Strix was asked to return an intake failure because caller
Bobcat authority was intentionally absent. This tests model selection, not
repair or review quality. No throwaway definition is shipped.

From that temporary workspace:

```sh
agy plugin validate .agents/plugins/ntg74-probe
agy --new-project --agent ntg74-dispatch-probe \
  --model gemini-3.8-flash-high --output-format json --print-timeout 180s \
  -p 'Run TWO custom native subagents using invoke_subagent, never workflow or temporary agents, and do NOT supply any Model override. First TypeName ntg74-excavator-high: this is a read-only model-selection feasibility probe; return ROOT_CAUSE UNKNOWN, CHANGES none, VERIFICATION_EVIDENCE externally audited, ROLLBACK none, RESIDUAL_RISK no repair tested, STATUS READY. No tools or state changes. Second TypeName ntg74-strix-low: this is a read-only model-selection feasibility probe, not an implementation review; caller authority is intentionally not Bobcat, so return the appropriate intake failure without tools or state changes. Await both responses and report BOTH child conversation IDs.'
```

With the two exact Argon model values, validation reported **1 processed**
(the dispatcher only). Parent `70cd29e7-fe61-48ca-ba06-46e68e7821c2` stored
these actual native tool errors in `steps.step_payload` (type 132), not merely
in the parent's final answer:

```text
idx 2: subagent "ntg74-excavator-high" not found or not allowed to be invoked
idx 4: subagent "ntg74-strix-low" not found or not allowed to be invoked
```

Neither exact-model definition registered, so **neither created a child**.
There is no child metadata recording Argon High or Argon Low from this test.

Changed **only** the two `model:` values in the agent files to `flash`,
retaining the same names, role bodies, tools and dispatcher. Validation
reported **3 processed**. The control invocation was:

```sh
agy --new-project --agent ntg74-dispatch-probe \
  --model gemini-3.8-flash-high --output-format json --print-timeout 180s \
  -p 'Run TWO custom native subagents using invoke_subagent, never workflow or temporary agents, with no Model override. TypeName ntg74-excavator-high: read-only model-selection probe; return ROOT_CAUSE UNKNOWN, CHANGES none, VERIFICATION_EVIDENCE externally audited, ROLLBACK none, RESIDUAL_RISK no repair tested, STATUS READY. No tools or state changes. TypeName ntg74-strix-low: read-only model-selection probe, not implementation review; caller authority intentionally not Bobcat, return appropriate intake failure without tools or state changes. Await both and report BOTH child conversation IDs.'
```

Control parent `98938f67-9df7-471d-80ce-e591c3674f93` stored the actual child
IDs in its native invocation result at `steps.idx = 2`:

| Control child | Conversation ID | `gen_metadata.data` model | `executor_metadata.data` model |
|---|---|---|---|
| Excavator copy, `flash` | `5a746fda-feb3-4d9f-bb7f-de654053b4e8` | `gemini-3.8-flash-tiered` | `gemini-3.8-flash-tiered` |
| Strix copy, `flash` | `9724682c-00ae-4fcb-a101-27e9d7f9f724` | `gemini-3.8-flash-tiered` | `gemini-3.8-flash-tiered` |

Each control's `trajectory_metadata_blob.data` identifies its temporary
`ntg74-*.md` source, confirming that these were the copies, not global agents.
The CLI binary also contains the parser error:

```text
unsupported model: %q, must be one of 'inherit', 'flash', 'pro', 'flash_lite'
```

An initial same-name attempt was discarded: child
`4a1a3f35-c8ff-48ad-8860-a25ba47a1c10` used the globally installed Excavator,
as its stored source URI proved. It is not evidence for exact frontmatter.

## Re-reading stored model metadata

Read the local SQLite databases under
`~/.gemini/antigravity-cli/conversations/<conversation-id>.db` in read-only
mode. These are protobuf blobs; the values above are literal model strings
in the stored bytes, not model self-reports. For example:

```python
from pathlib import Path
import re
import sqlite3

child = "5a746fda-feb3-4d9f-bb7f-de654053b4e8"
path = Path.home() / ".gemini/antigravity-cli/conversations" / f"{child}.db"
with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
    for table in ("gen_metadata", "executor_metadata"):
        models = set()
        for (blob,) in db.execute(f"SELECT data FROM {table}"):
            models.update(re.findall(rb"gemini-[a-z0-9._-]+", blob))
        print(table, sorted(model.decode() for model in models))
```

## Blocked pin and proposed alternative

The requested native Excavator Argon High pin is **not implemented**:
AGY 1.3.6 rejects an exact slug in native agent frontmatter. There is no honest
passing regression test asserting that the native worker resolves to Argon.
The previous selector/catalog assertions were removed; tests now preserve
the actual Flash native selectors and existing fail-closed runner boundaries.

Proposed alternative: a bounded host-dispatched Excavator invocation using
policy resolution, its shipped worker body and `agy --model`, mirroring the
existing Zen boundary. It needs real dispatch integration that preserves
caller, milestone, tools, shell marker and no-child authority. Adding only
`ROLE_POLICY_TABLE.excavator` or a spine test adapter would leave actual AGY
native delegation unchanged. That routing change is not shipped here.

Strix's Argon Low experiment is probe-only. The production definition stays
byte-identical to main on Flash. Current and scheduled Argon prices are in
[the model profile](../../docs/model-profiles/gemini-4-argon.md).

## Correction verification

| Command | Observed result |
|---|---|
| `node --test tests/*.mjs` | Exit 0; 166 tests, 165 passed, 0 failed, 1 existing persistent-watch skip. Includes 39 internal ledger assertions and 52 runner assertions. |
| `python -m compileall -q hooks tests` | Exit 0 |
| `python -m unittest discover -s tests -v` | Exit 0; 15 tests, OK |
| `node --check scripts/npm-install.mjs` | Exit 0 |
| `node --check scripts/runner.mjs` | Exit 0 |
| `node --check scripts/ntg-vnext.mjs` | Exit 0 |
| `npm pack --dry-run` | Exit 0 |
| `git diff --exit-code origin/main -- agents/strix-halo.md agents/excavator.md` | Exit 0; both definitions are byte-identical to main |
| `git diff --check` | Exit 0 |

The full suite queried real `agy models`, resolved Piledriver/Zen to Argon
High and Steamroller to Argon Medium, and passed actual Piledriver Argon High
and Bulldozer Flash High generation checks. These successful calls do not
establish a native worker model pin. The complete PR diff was also checked
for personal home paths: zero matches. LSP remained unavailable because the
TypeScript language server is not installed; syntax and runtime checks passed.
