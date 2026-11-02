# Issue 184: native-worker shell isolation

Date: 2026-11-02. Base: `98fcedd`. Runtime: AGY `1.4.12`.

## Direct reproduction, not a model-only report

A throwaway workspace registered an observer for SessionStart, PreInvocation,
PreToolUse and PostToolUse. It captured payloads, environment key names, the
two NTG boundary values and runtime conversation IDs; no credential values.
The production plugin guard was unchanged during these two runs.

| Probe | Root conversation | Native Bobcat conversation | Observed result |
| --- | --- | --- | --- |
| Marker set | `28cef410-65b7-4009-858a-3dc9fe05c53a` | `bf1327b8-1285-4ddd-a6c5-36633861e359` | Both `printf` calls denied |
| Marker absent | `67d82b34-8f24-45b5-886e-2d321d2f242a` | `f7ef89be-663a-4139-9855-52594629e53d` | Both `printf` calls exit 0 |

The first Bobcat PreToolUse contains:

```json
{
  "conversationId": "bf1327b8-1285-4ddd-a6c5-36633861e359",
  "toolCall": {
    "name": "run_command",
    "args": {
      "CommandLine": "printf NTG184_BOBCAT",
      "WaitMsBeforeAsync": 5000,
      "toolSummary": "Printf NTG184 marker"
    }
  }
}
```

The observer's environment contains `NTG_BULLDOZER_NO_SHELL=1`, exactly as
the root's does. Both hooks have the same AGY parent PID. Bobcat's persisted
`transcript_full.jsonl`, step 2, records `status: ERROR` with:

```text
tool call denied by pre-tool hook: Bulldozer has no shell authority; discovery routes to Jaguar.
```

In the marker-off control, Bobcat's PostToolUse records an empty error and its
tool transcript reports `NTG184_BOBCAT_CONTROL`, exit 0. This toggles the
reported cause without changing role instructions or the command's effects.

## Identity and lifecycle evidence

The observed common fields are `artifactDirectoryPath`, `conversationId`,
`lastUserInput`, `modelName`, `transcriptPath`, and `workspacePaths`.
PreToolUse adds `stepIdx` and `toolCall`. None identifies a custom-agent role
or parent. `ANTIGRAVITY_CONVERSATION_ID` changes to the current child ID; it is
not an inherited root pointer. Model names and prompt text are not identity.

Root SessionStart completed before root PreInvocation, delegation, and child
SessionStart. The runner starts fresh sessions, not resumed conversations.
This gives a runtime-owned root binding point before any child can run tools.

## Decision and limits

Use a runner-created temporary binding file and exclusive SessionStart
creation; compare the runtime PreToolUse conversation ID to the bound root.
Native workers are exempted from this one root guard, not auto-approved and
not exempted from their own permissions or other guards. The binding is
per invocation and removed on return, including transport failure.

Rejected:

- Remove the process marker: restores workers but loses the #167 backstop.
- Worker command prefix: Bulldozer can type it too; not an identity boundary.
- Role/model/prompt inference: no reliable role metadata in captured hooks.
- Bind on the first shell call: Bobcat can legitimately make that first call.
- Compare payload ID with `ANTIGRAVITY_CONVERSATION_ID`: both identify the
  current child, not the root.

This preserves direct root-shell denial without a forgeable shell marker.
It is not OS/process isolation. Agents run as the same user and could tamper
with the binding or installed hooks through other authorized file access.
The existing Excavator transport grammar remains an exception, not executable
authentication. Revalidate lifecycle ordering on AGY upgrades. Missing state
or malformed identity fails closed; legacy marker-only invocations still deny
the whole process tree.

## Regression evidence

Before the fix:

```text
python3 -m unittest discover -s tests -p test_bulldozer_shell_guard.py -k native_bobcat -v
AssertionError: 'deny' != 'allow'
Ran 1 test in 0.019s
FAILED (failures=1)
```

The regression uses the captured distinct root/child IDs and inherited marker.
Additional coverage checks root denial (including worker-marker forgery),
child-first shell after lifecycle binding, immutable root binding, missing
state/invalid identity, Excavator dispatch, Zen guard composition, independent
Zen environment cleanup, and runner context cleanup on success/spawn failure.
