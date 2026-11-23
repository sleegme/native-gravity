---
name: ntg
description: Orchestrates single- and multi-step development tasks with Native Gravity 2.0 (NTG 2.0). Routes across Track L (HALO_LIGHTWEIGHT), Track S, and Track M (ZEN_DURABLE) via interactive Steamroller + LedgerKernel, checks status/resumes progress, or visualizes the milestone dependency graph.
---

# Native Gravity Task Entry Point (`/ntg`)

Use this skill when the user invokes `/ntg <task>`, `/ntg graph`, `/ntg version`, or asks Native Gravity to execute a task, view the progress graph, or check the installed version.

## Responsibilities & Guardrails

- **Simple user entry point (#200):** Handle technical setup (plan initialization, Track L/S/M routing, runner invocation) seamlessly behind plain-language summaries. Never expose raw internal orchestration jargon (`result_ref`, internal ledger schemas, JSON scaffolding) or require `$NTG` environment variables unless explicitly requested.
- **Track L / S / M routing:**
  - **Track L (`HALO_LIGHTWEIGHT`):** Small, bounded low-risk changes. Execute cleanly through `Direct` workers (`Jaguar`/`Puma`/`Bobcat`), verify with fresh bound Strix Halo (`ACCEPT`), and record lightweight history without forcing heavy ceremony. Escalate to Zen only when Steamroller judges high risk.
  - **Track S / M (`ZEN_DURABLE`):** Substantive single-milestone (Track S) or multi-milestone / cross-cutting work (Track M). Present one concise plain-language plan and obtain **one initial confirmation** before running. Material Replans and confirmation gates require explicit user re-approval.
- **Preserve existing progress:** When `.ntg/ledger.json` already exists, never overwrite it. Summarize progress and resume safely.
- **Packaged resolution:** Execute scripts via the packaged helper (`scripts/ntg-command.mjs`) resolved relative to this plugin.
- **Authority & role boundaries:** Preserve `mainAgent: false` on subagent definitions, keep dynamic model capability routing decoupled from role permissions, and let the real runner / LedgerKernel / independent Zen verifier govern durable verification (`GO` / `NO-GO`).

## Progress Graph Routing (`/ntg graph`)

When invoked with `/ntg graph` (or when the user asks to view or visualize the progress graph or milestone dependency DAG):
- **Do NOT** treat `graph` as a task or draft a plan.
- Run the packaged helper's `graph` subcommand:
  ```bash
  node "<helper-path>" graph --pane
  ```
- Forward optional flags if specified by the user:
  - `--ledger <path>` to target a custom ledger path (defaults to `.ntg/ledger.json`).
  - `--once` to print the graph once without opening a side pane or terminal.

## Version Routing (`/ntg version`)

When invoked with `/ntg version` (or when the user asks to view or check the installed Native Gravity version):
- **Do NOT** treat `version` as a task or draft a plan.
- Run:
  ```bash
  node "<helper-path>" version
  ```

## Step 1: Check Project State

Check if `.ntg/ledger.json` already exists in the workspace (including clean/empty project directories without `AGENTS.md`, git history, or `$NTG`).

### Case A: Ledger Exists (Resumption)

1. **Inspect status:**
   ```bash
   node "<helper-path>" status
   ```
2. **Summarize & Resume:**
   Summarize completed steps, active work, and any blockers in plain language, then resume:
   ```bash
   node "<helper-path>" run --all
   ```

### Case B: No Ledger Exists (Fresh Task)

1. **Classify Track & Prepare Plan:**
   Assess task scope and risk cleanly:
   - Small, low-risk bounded work (`Track L`): run directly via lightweight workers + fresh bound Strix Halo (`HALO_LIGHTWEIGHT`), escalating to Zen only if high risk is identified.
   - Substantive single-step or multi-step work (`Track S` or `Track M`): prepare a milestone plan JSON internally (`goal`, `plan_version`, `constraints`, `milestones` with `id`, `title`, `objective`, `acceptance_criteria`, `non_goals`, `dependencies`, `bounded_scope`).
2. **Present Plain-Language Summary & Request Single Confirmation:**
   **Never show raw plan JSON unless explicitly asked.** Present a concise summary in the user's language:
   - **What will happen:** 1–2 sentences on the goal.
   - **Steps:** plain-language bullet points (no internal IDs, field names, or raw file-path noise unless essential).
   - **Impact / safety:** note any deletions, overwrites, installs, or protected items. Call out irreversible changes separately.
   - **Verification:** one line stating independent review / check criteria.
   End with a single question asking to proceed (Korean: `"이대로 진행할까요?"`).
   Wait for user confirmation before initializing `.ntg/ledger.json` or running edits.
3. **Execute upon Confirmation:**
   - Save the internal plan to `plan.json` (or initialize directly into `.ntg/ledger.json`):
     ```bash
     node "<helper-path>" init --plan plan.json
     ```
   - Run through the real runner:
     ```bash
     node "<helper-path>" run --all
     ```
   - **Mandatory Initial Piledriver Advisory Review:** On the first `run` for a new task or `plan_version` (Track L/S/M), the runner runs one bounded Piledriver advisory pass (`adopted: false`) and returns `AWAITING_PLANNING_DECISION` with `planning_pass.advice` and `advisory_digest` before executing any worker. Inspect `planning_pass.advice` as Steamroller (do not rely on static heuristics), then re-run with an explicit digest-bound decision token:
     ```bash
     node "<helper-path>" run --all --planning-decision PROCEED --planning-decision-digest "<advisory_digest>" --planning-decision-note "<brief rationale>"
     ```
     If you judge the advisory reveals a plan defect or unacceptable risk, pass `--planning-decision REPLAN_REQUIRED` (or adopt a Tactical/Material Replan). Once recorded for that `advisory_digest`, subsequent milestones and retries of the same `plan_version` proceed without re-prompting.
   - On subsequent Tactical Replans (same user goal and criteria), adapt remaining steps seamlessly; ask again only on Material Replans or confirmation gates.

## Resolving the Packaged Helper

Resolve `scripts/ntg-command.mjs` inside this plugin:
1. Relative to this skill file: `../../scripts/ntg-command.mjs`
2. Or locate the plugin root via `agy plugin list --json` (entry `name == "native-gravity"`, field `path`) and use `<path>/scripts/ntg-command.mjs`.
Always wrap script and ledger paths in quotes to handle paths containing spaces.
