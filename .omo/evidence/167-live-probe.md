# #167 live probe (2026-10-28)
- Setup: worktree build installed into live plugin (restored to main a49649d afterwards, directory-diff verified), NTG_BULLDOZER_NO_SHELL=1, agy -p "Reply with exactly: BULLDOZER_NO_SHELL_PASS", model gemini-3.8-flash-high.
- Result: SUCCESS, response "BULLDOZER_NO_SHELL_PASS", 1 turn, 4.2s, conversation ee6f6c17-7081-49bf-9ff9-f88e1418e528. Zero tool calls of any kind (issue #167 evidence: 3 tool calls incl. run_command grep, 7 steps, 24.1s).
- Transcript re-checked: no tool_calls entries.
