---
name: ntg
description: Orchestrates multi-step development tasks with Native Gravity vNext. Drafts and confirms plans for new tasks, checks status and resumes existing progress, or visualizes the milestone dependency graph via the packaged runner.
---

# Native Gravity Task Entry Point (`/ntg`)

Use this skill when the user invokes `/ntg <task>`, `/ntg graph`, or asks Native Gravity to execute a multi-step task or view the progress graph.

## Responsibilities & Guardrails

- **Entry point only:** This skill coordinates user interaction in the conversation. It does not impersonate Steamroller or write or modify the authoritative ledger (`.ntg/ledger.json`) directly.
- **Plan confirmation before execution:** Always draft and show the complete plan to the user and obtain explicit confirmation before initializing or running any implementation.
- **Preserve existing progress:** When a ledger already exists, do not overwrite or re-initialize it. Display current status and resume execution.
- **Packaged resolution:** Execute scripts via the packaged helper (`scripts/ntg-command.mjs`) resolved relative to this plugin. Do not require `export NTG` or a checkout path.
- **Preserve role settings:** Keep `mainAgent: false` for all plugin roles.
- **Real runner adherence:** Execution and verification are handled by the real runner (`ntg-vnext.mjs`) and independent verifier. Never promise a different model or bypass the runner.

## Progress Graph Routing (`/ntg graph`)

When invoked with `/ntg graph` (or when the user asks to view or visualize the progress graph or milestone dependency DAG):
- **Do NOT** treat `graph` as a task or draft a plan.
- Instead, run the packaged helper's `graph` subcommand:
  ```bash
  node "<helper-path>" graph
  ```
  (Where `<helper-path>` is resolved to `scripts/ntg-command.mjs` as described in [Resolving the Packaged Helper](#resolving-the-packaged-helper)).
- Forward optional flags if specified by the user:
  - `--ledger <path>` to target a custom ledger path (defaults to `.ntg/ledger.json`)
  - `--watch` to monitor the ledger and redraw on updates

## Step 1: Check Project State

Check if `.ntg/ledger.json` already exists in the workspace.

### Case A: Ledger Exists (Resumption)

1. **Inspect status:**
   Run the packaged helper `status` command:
   ```bash
   node "<helper-path>" status
   ```
   (Where `<helper-path>` is resolved to `scripts/ntg-command.mjs` in this plugin's installation).
2. **Report status & Resume:**
   Summarize the current progress (completed milestones, active milestone, blockers) to the user.
   Resume execution using the real runner:
   ```bash
   node "<helper-path>" run --all
   ```

### Case B: No Ledger Exists (Fresh Task)

1. **Analyze the Request & Draft Plan:**
   Break down the user's request into discrete, bounded milestones. Construct a plan JSON object:
   ```json
   {
     "goal": "<concise statement of the overall goal>",
     "plan_version": "v1",
     "constraints": ["<project constraints>"],
     "milestones": [
       {
         "id": "m1",
         "title": "<milestone title>",
         "objective": "<concrete objective>",
         "acceptance_criteria": ["<testable criterion 1>", "<testable criterion 2>"],
         "non_goals": ["<explicit non-goals>"],
         "dependencies": [],
         "bounded_scope": ["<file or path>"]
       }
     ]
   }
   ```
2. **Present Plan & Request Confirmation:**
   **Never show the raw plan JSON to the user.** The JSON is for the runner; the user approves a plain-language summary. Write it in the user's language, short enough to read in a few seconds:
   - **What will happen:** one or two sentences stating the goal.
   - **Steps:** one line per milestone, in everyday words (no ids, field names, or file-path lists unless the user must recognize them).
   - **What changes / what stays untouched:** name anything deleted, overwritten, or installed, and anything explicitly protected. Call out irreversible actions (deletions, publishing) on their own line.
   - **How we will know it worked:** one line.
   End with a single plain question in the user's language asking whether to proceed (for Korean: "이대로 진행할까요?").
   Show the JSON only if the user explicitly asks for it.
   **DO NOT** run implementation or initialize the ledger before receiving explicit user confirmation.
3. **Execute upon Confirmation:**
   Once the user approves the plan:
   - Save the plan to `plan.json` in the workspace root.
   - Initialize the ledger:
     ```bash
     node "<helper-path>" init --plan plan.json
     ```
   - Run the plan with the real runner:
     ```bash
     node "<helper-path>" run --all
     ```

## Resolving the Packaged Helper

The helper script `scripts/ntg-command.mjs` is located within this plugin. To resolve its path:
1. Relative to this skill file: `../../scripts/ntg-command.mjs`
2. Or locate the plugin root via `agy plugin list --json` (entry with `name == "native-gravity"`, field `path`) and use `<path>/scripts/ntg-command.mjs`.
Always wrap script and ledger paths in quotes to handle paths containing spaces.
