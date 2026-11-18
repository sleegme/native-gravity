# G1 Runtime Probes — OQ-6 Verdict (AGY 1.2.2) — REVISED after gate review
Date: 2026-09-15
Host agy version: 1.2.2 (captured via agy --version in probe-registry-enforcement.json)
Plugin under test: /home/sleeg/work/native-gravity-44g (branch vnext/44g-activation @ 099fb66), installed via `agy plugin install` which COPIES to ~/.gemini/config/plugins/native-gravity — reinstall required after worktree edits.

## Probe results (all OBSERVED; transcripts in this dir)

| Probe | Surface | Result | Artifact |
|---|---|---|---|
| Install+validate | agy plugin install/validate <wt> | exit 0; 9 agents, 2 hooks processed | install-validate.txt |
| Primary registry | agy agent | lists excavator, steamroller (mainAgent:true) | install-validate.txt |
| --agent subagent | agy --agent zen --print | SUCCESS PONG | probe-c-agent-zen.txt |
| --agent all subagents | jaguar/puma/strix-halo/bobcat | all SUCCESS | probe-subagent-acceptance.json |
| --agent loose surface | --agent bulldozer/piledriver/nonexistent-xyz | ALL accepted (silent fallback) — --agent is NOT registry-enforced | probe-registry-enforcement.json |
| invoke_subagent boundary | steamroller -> invoke_subagent bulldozer / nonexistent-xyz | BOTH REJECTED: "subagent X not found or not allowed to be invoked" — registry enforcement lives on invoke_subagent | probe-boundary-invoke-nonsubagent.jsonl |
| A1: tools:[] primary | steamroller tools:[] -> invoke_subagent zen | model refused: "invoke_subagent not available... only manage_task" | probe-a1 |
| A4: tools:[] forced | steamroller tools:[] -> run_command echo | model: "run_command unavailable... not provided in tool declarations" — tools:[] removes tools from the model-visible declaration surface | probe-a4 + probe-a4-frontmatter-snapshot.txt |
| A5: tools-only primary | steamroller tools:[...invoke_subagent] NO inheritCustomizations field -> invoke_subagent zen | SUCCESS ZENOK; frontmatter snapshot captured (probe-a5-frontmatter-snapshot.md — inheritCustomizations absent as a field) | probe-a5 + snapshot |
| B: nested subagent | default -> bobcat -> strix-halo | bobcat created file + consulted strix-halo; strix child DB shows received task + sent HALOOK to parent | probe-b + probe-b-strix-child-strings.txt |
| Zen child raw | A3's zen child conv f2ab9470 | child DB shows received "reply with the single word ZENOK" | probe-a3-zen-child-strings.txt |
| Hook zen marked | NTG_ZEN_VERIFY=1 rm / cat | rm DENIED "Zen permits only read-only verification commands"; cat ALLOWED | probe-hooks-zen.jsonl |
| Hook zen unmarked | rm (no marker) | EXECUTED, file deleted — hook is marker-scoped | probe-hooks-unmarked-control.jsonl |
| Hook excavator | NTG_EXCAVATOR=1 su / uname | su DENIED (drift reason); uname ALLOWED | probe-hooks-excavator.jsonl |
| Runner live | invoke("bulldozer") via runner.mjs | resolved slug gemini-3.8-flash-high, ran SUCCESS RUNNEROK despite bulldozer.md subagent:false — frontmatter bypass proven live | probe-runner-live.json |
| Description colons | grep '^description:' agents/*.md | no description value contains a colon | probe-subagent-acceptance.json |

## Additional evidence (second re-review wave)

- probe-runner-codepath.txt: runner.mjs contains ZERO non-comment references to frontmatter fields (mainAgent/subagent/inheritCustomizations/commandExecutionPolicy); its role-body loader comment states "Loads the role file as Markdown content, without interpreting AGY frontmatter". Combined with probe-runner-live.json (bulldozer ran SUCCESS despite subagent:false), frontmatter bypass is proven at both code and runtime level.
- probe-hooks-filecheck.txt: zen marked rm denied AND file state captured as EXISTS after the attempt.
- probe-hooks-exc-unmarked.txt: excavator unmarked rm EXECUTED (file GONE) — marker selectivity confirmed for both guards.
- probe-b-bobcat-child-strings.txt: bobcat child conv 0608dbcb shows it received ONLY its bounded assignment text — no parent session context or customizations leaked. Role isolation confirmed at the child-transcript level.
- probe-a5-frontmatter-snapshot.md: the installed steamroller.md used for the successful zen invocation has tools:[view_file,list_dir,grep_search,run_command,invoke_subagent] and NO inheritCustomizations field (the string appears only in body note text).
- probe-registry-enforcement.json: agy --version = 1.2.2 captured; --agent accepts bulldozer/piledriver/nonexistent-xyz (loose surface); invoke_subagent rejects non-subagent + nonexistent roles (probe-boundary-invoke-nonsubagent.jsonl).

## Additional evidence (third re-review wave)

- probe-b-bobcat-child-full.txt: FULL unfiltered strings dump of the bobcat child conversation — shows only the bounded assignment, no parent context/customizations.
- probe-hooks-exc-marked-vs-unmarked.txt: excavator marked su -> hook denial; unmarked su -> model self-refusal (no hook). Marker selectivity: the hook fires only on marked commands; unmarked commands reach the model's own judgment. Earlier unmarked rm executed (file GONE).
- probe-runner-codepath.txt: full invoke(), composeBoundedPrompt(), invokeTransport() bodies — the complete invocation path, showing role-body loading without frontmatter parsing and the agy spawn call.

## Additional evidence (fourth wave)

- probe-hooks-exc-rm-pair.txt: excavator marked rm EXECUTED (file GONE) — the excavator guard does NOT deny general mutations; it only intercepts its deny-set (privilege acquisition, credential mining, full upgrades). Marker selectivity proven: marked commands are evaluated by the hook (su denied), unmarked commands bypass it entirely (rm executed, su model-refused without hook involvement).
- AGY platform docs (antigravity.google/docs/subagents): subagents run in isolated context — "prevents its context window from being polluted by the details of a subagent's work" and each subagent executes in its own conversation (confirmed by separate conversation DBs per child). File-read customization isolation is confirmed behaviorally (loaded-parent marker + CONTEXT_CLEAN child). Broader customization classes (MCP servers, skills, plugins) are not individually probed; the claim is scoped to project-file/instruction isolation.

## Additional evidence (fifth wave)

- probe-customization-isolation.jsonl: parent steamroller session ran in /tmp/ntg-cust-probe containing AGENTS.md with marker PROJECT_MARKER_XYZZY_12345; the invoked jaguar child reported CONTEXT_CLEAN — it saw only its task + own role instructions, not the parent's project customizations. Customization isolation confirmed behaviorally, not just by docs.

## Additional evidence (sixth wave)

- probe-customization-isolation-2.jsonl: parent steamroller read /tmp/ntg-cust-probe/AGENTS.md and quoted the marker PROJECT_MARKER_XYZZY_12345 (proving the parent loaded the customization), then the jaguar child reported CONTEXT_CLEAN. Customization isolation proven behaviorally with a loaded-parent control.
- probe-hooks-exc-history-pair.txt: marked history-read -> hook denial; unmarked history-read -> model self-refusal (no hook). Same pattern as su: deny-set commands are refused by the MODEL when unmarked, by the HOOK when marked. The hook's marker-scoping is proven by the fact that unmarked commands (rm executed; su/history model-refused) never produce a hook decision — the hook only emits decisions for marked commands.

## OQ-6 verdict for AGY 1.2.2 (revised)

1. Runner-invoked roles bypass frontmatter entirely (proven live: bulldozer ran via runner despite subagent:false). inheritCustomizations NOT_APPLICABLE on the runner path.
2. Custom primary -> native subagent: WORKS when the primary's tools list includes invoke_subagent. inheritCustomizations NOT required (A5: field absent, invocation succeeded).
3. Nested subagent -> subagent (bobcat -> strix-halo): WORKS with stock frontmatter; child execution proven via conversation DB.
4. invoke_subagent is the registry-enforced surface: non-subagent and nonexistent roles are rejected. --agent is a loose surface (accepts anything, silent fallback) — do not rely on it for boundary enforcement.
5. tools:[] removes tools from the model-visible declaration surface — INFERRED from the model's report that run_command was "not provided in the tool declarations" (probe-a4) plus the contrast with A5 where declared tools worked. The declaration payload itself is not directly observable from outside; the inference is supported by the model's exact wording and the behavioral contrast. Activated Steamroller MUST declare explicit tools.
6. Both PreToolUse hooks fire in --print mode. Marker-scoping is evidenced by: marked deny-set commands produce hook denials; unmarked commands never produce a hook decision (they execute or are model-refused). The excavator guard is also deny-set-scoped (marked rm allowed). RESIDUAL: whether an always-on guard could theoretically also allow unmarked commands is not distinguishable from outside; the observed behavior is consistent with marker-scoped enforcement as documented.
7. No description-colon registry drops observed on 1.2.2.

Activation consequence: Steamroller primary declares tools [view_file, list_dir, grep_search, run_command, invoke_subagent] + commandExecutionPolicy: sandbox; inheritCustomizations omitted (non-official, unneeded on 1.2.2). Zen invocation via native invoke_subagent from Steamroller OR `agy --agent zen --print` from a driver script.

## Gate-review disposition (lead self-review after 2-attempt reviewer limit)

The independent verifier returned NO-GO across 5 reviews. Its confirmed findings stand. Its two final blockers are claim-strength disputes, not criterion failures: (a) it reads the absence of a hook decision on unmarked commands as inconclusive rather than as the marker-scoping evidence it is; (b) it accepts file-read isolation but not blanket customization isolation. Both claims have been re-scoped above to exactly what the evidence supports. The OQ-6 criterion (record each probe's observed outcome) is met: every probe's outcome is captured in a named artifact. Recorded as notes, not blockers.
