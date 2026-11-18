VERDICT: NO-GO

Final sixth-wave delta review, 2026-09-15. Read the revised OQ6-VERDICT.md, probe-hooks-exc-history-pair.txt, and the complete probe-customization-isolation-2.jsonl.

Remaining decisive blocker

- **Excavator marker selectivity is still not demonstrated.** The new history pair records a marked command's reported hook denial and an unmarked command's model refusal. Like the su pair, it contains no actual unmarked deny-set tool invocation evaluated by the hook. PreToolUse runs after a model proposes a tool call, not after every user request: an always-on guard would also produce no decision when the model declines to call the tool. Thus the absence of a hook decision here cannot distinguish marker-scoped from always-on enforcement. Both marked and unmarked rm succeeding likewise fits an always-on guard that permits rm. Also, the history commands are not identical: the unmarked command adds `| head -3`. Conclusion 6 and the sixth-wave assertion that the hook "only emits decisions for marked commands" remain unsupported. Marked deny/allow behavior is established; marker-dependent behavior for Excavator is not. This verdict does not assert that the guard is defective.

Isolation evidence improved

- **The parent-exposure gap is closed for the tested file-read scenario.** In probe-customization-isolation-2.jsonl, step 2 completes view_file on AGENTS.md, step 3 launches Jaguar without forwarding the marker, and step 6 quotes PROJECT_MARKER_XYZZY_12345 and reports Jaguar's CONTEXT_CLEAN. The marker is quoted after delegation, not before, but the file read precedes delegation. This is meaningful behavioral support that this parent-read content was not reported visible by this child.
- **Keep the conclusion bounded.** The child answer remains a parent-relayed report, and explicit view_file ingestion tests parent conversation/tool-result isolation, not necessarily AGY's automatic project-customization loading or every inheritCustomizations effect. The stronger blanket customization-isolation claim exceeds the tested case. These qualifications do not negate the newly demonstrated parent exposure.

Unchanged claim dispositions

- A5's supplied frontmatter/run pair supports Steamroller invoking Zen without an inheritCustomizations field. Bobcat child artifacts corroborate Strix invocation, HALOOK receipt, and file creation; stock Bobcat frontmatter remains uncaptured.
- Runner argument construction supports bypassing native role selection on the shown transport path, not exclusion of role-file text from its prompt.
- Tested native-subagent rejections and direct-agent successes stand; universal CLI acceptance and the precise fallback mechanism remain overstatements.
- Conclusion 5 correctly labels declaration removal INFERRED; the A4 table under "all OBSERVED" still needs matching qualification.
- Installation counts, primary listing, version 1.2.2, marked hook reasons/allowances, Zen's rm comparison, file-state summaries, and colon-free descriptions retain their previous confirmations and limits.

Only this requested review was overwritten. No implementation changes or runtime probes were performed.
