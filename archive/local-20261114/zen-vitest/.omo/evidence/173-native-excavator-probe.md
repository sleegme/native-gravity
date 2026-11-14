# PR #173: native Excavator exclusion and enabled-worker control

Observed 2026-10-25 on AGY **1.4.7**. Tested production head:
`e3a7c5ccea3b8d6a5568ceb4b57acda05372619a`.
This follow-up adds evidence only; the tested agent, rule, runner and test
sources are unchanged.

## Verdict

| Native request | Actual runtime result | Verdict |
| --- | --- | --- |
| Bulldozer -> Excavator | `invoke_subagent` ERROR: `subagent "excavator" not found or not allowed to be invoked`; no child ID/database | PASS: disabled before a child starts |
| Same Bulldozer -> Bobcat | Native child `b0b9b93f-cdee-4586-8d72-b071a42ef5d7` completed with `NTG173_BOBCAT_CONTROL_READY` | PASS: enabled worker loads and runs |

The rejection is not a spine callback, model refusal, or returned candidate
validation. It is the actual native tool error, stored in the parent database.
The Bobcat control rules out a missing/unloaded plugin as the explanation.
No production disable-mechanism change was necessary.

## Isolated setup and effective definitions

Created a fresh private HOME and empty workspace under
`<HOME>/.cache/ntg-pr173-native-probe/`. Installed the PR-head plugin with:

```sh
HOME="$PROBE/profile" AGY_CLI_DISABLE_AUTO_UPDATE=1 \
  agy plugin install "$PR_WORKTREE"
```

No shared plugin installation, shared conversation store or main checkout was
changed. The private profile exposed only the existing credential through a
symlink; bubblewrap read-only-bound its target during inference. No credential
content is included in these artifacts.

The installed worker files were compared byte-for-byte with the PR head using
`cmp`. Effective worker SHA-256 values:

```text
agents/excavator.md 12b2da3a1bd26ff1657e72dc4cb69e5f205bfa2a8967dd10ad6304822607b247
agents/bobcat.md    491135eb334c5572424d4f45d5eaa6e0552cb27d969598bdc0288d31430dda35
```

Excavator retained exactly `mainAgent: false`, `subagent: false`, `model: flash`.
Bobcat retained exactly `mainAgent: false`, `subagent: true`, `model: flash`.
Neither worker was renamed, overridden, modified or replaced.

Bulldozer is runner-only in production. To select that same role natively for
this probe, changed **only the private installed parent copy**:

```diff
-mainAgent: false
+mainAgent: true
 subagent: false
 model: inherit
```

Its full role body and tools were unchanged. `agy agents` in that profile
listed `bulldozer`. Parent source SHA-256 before this probe-only metadata
change: `21964a41c23daec90d2ae0a45764ac6d545d04ef2e8367a0d88793092fbd68e9`.
The owner-authorized prompt explicitly required one negative registration
attempt despite the production no-spawn instruction, then the enabled control.
This distinguishes runtime exclusion from merely following the prompt.

## Bounded invocation and recorded artifacts

Ran from the empty probe workspace, in one fresh native conversation:

```sh
HOME="$PROBE/profile" AGY_CLI_DISABLE_AUTO_UPDATE=1 \
  agy --new-project --agent bulldozer \
  --model gemini-3.8-flash-high --dangerously-skip-permissions \
  --output-format stream-json --print-timeout 150s \
  -p "$(cat "$PR_WORKTREE/.omo/evidence/173-native-excavator-prompt.txt")"
```

The actual command was wrapped in bubblewrap for read-only credential access
and a 170-second outer timeout with a 10-second termination grace. It exited
**0**; the AGY result reported **SUCCESS**, **39.177011262 seconds**.
No Model override was supplied to either native subagent.

Artifacts beside this receipt:

- `173-native-excavator-prompt.txt`: exact executed owner-authorized prompt.
- `173-native-excavator-stream.jsonl`: all 33 native stream events, including
  ERROR and successful child dispatch, with home-directory paths redacted.
- `173-native-bobcat-control.jsonl`: child's four transcript records, retaining
  actual content/status/timestamps and removing the model's `thinking` field.

Only home-directory prefixes were replaced with `<HOME>` in the native stream.
The redacted stream SHA-256 is
`90508441d041fd5d81ea8e64ba23cfa2380da8985085dc6e049d9d5a210da6cc`.
The child transcript SHA-256 is
`3e92fae25d582ebcc5ec89d5e8ce95c075eb9f03f620ddcda8bcf9bc24010e7e`.

## Actual native observations

Parent conversation: `7cad473a-ebc9-4bbf-bf1e-de6606a369bd`.
The init event identifies agent `bulldozer`, model `gemini-3.8-flash-high`,
and the isolated workspace.

1. **Parent step 2:** native `invoke_subagent`, TypeName `excavator`,
   role `Availability Sentinel`. The stream changed from ACTIVE to ERROR
   in 0.023810368 seconds and contained no child conversation ID.
2. Read the parent's SQLite database read-only, querying
   `steps.idx = 2`, rather than relying on the final model response:

   ```text
   idx: 2
   step_type: 132
   status: 7
   error_details: subagent "excavator" not found or not allowed to be invoked
   step_payload: same native error and TypeName "excavator"
   ```

   `error_details` and `step_payload` are protobuf blobs. The exact error
   string above was extracted from their bytes; the stream independently
   supplies the ERROR state.
3. **Parent step 4:** native `invoke_subagent`, TypeName `bobcat`, DONE;
   returned child ID `b0b9b93f-cdee-4586-8d72-b071a42ef5d7`.
   Parent steps 6 and 8 listed only this Bobcat child, first running and
   then idle.
4. **Bobcat child step 3:** stored MODEL / PLANNER_RESPONSE / DONE at
   `2026-10-25T03:41:45Z`, exact content:

   ```text
   NTG173_BOBCAT_CONTROL_READY
   ```

   Bobcat sent its completion message to the parent; no repair, file edit,
   review or child delegation occurred.
5. After the invocation exited, the fresh isolated conversation directory
   contained exactly these two database files:

   ```text
   7cad473a-ebc9-4bbf-bf1e-de6606a369bd.db
   b0b9b93f-cdee-4586-8d72-b071a42ef5d7.db
   ```

   There was no Excavator child database. Together with the native error and
   missing child ID, this establishes rejection before a child starts.

### Native definition and executed-model provenance

Read-only queries of `trajectory_metadata_blob.data` contained these source
URIs (home prefixes redacted):

```text
Parent:
file://<HOME>/.cache/ntg-pr173-native-probe/profile/.gemini/config/plugins/native-gravity/agents/bulldozer.md

Bobcat child:
file://<HOME>/.cache/ntg-pr173-native-probe/profile/.gemini/config/plugins/native-gravity/agents/bobcat.md
```

Thus the enabled control used this isolated PR plugin, not another installed
agent. Both `gen_metadata.data` and `executor_metadata.data` in the Bobcat
database contained `gemini-3.8-flash-tiered`. Parent metadata contained the
requested `gemini-3.8-flash-high` and resolved Flash-tier model strings.
These are stored runtime metadata, not model self-identification.

## Full test-suite completion receipt

Command on the tested production tree:

```sh
node --test --test-reporter=tap tests/*.mjs
```

Observed exit **0**. Exact final summary:

```text
1..290
# tests 290
# suites 0
# pass 269
# fail 0
# cancelled 0
# skipped 21
# todo 0
# duration_ms 107463.033592
```

The skips are 20 existing Windows-specific cases and one existing persistent
watch-mode case. This is the completed full-suite run already bound to the
unchanged production head, not a claim of another run for this evidence-only
follow-up. Retained shell guards also completed with exit 0:

```text
Ran 15 tests in 5.700s
OK
```

## Scope and remaining limits

This closes the native exclusion evidence gap for these unchanged definitions
on AGY 1.4.7. It does not prove native Argon availability, a real repair,
model quality, future AGY behavior, or that every live task chooses the
documented blocker fallback. Re-enablement still requires the separate native
Argon selection probe documented in `agents/excavator.md`. The temporary
disablement and existing fallback contracts remain unchanged.
