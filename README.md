# Native Gravity (NTG)

[한국어](docs/ko/README.md)

## What is NTG?

Native Gravity (NTG) is a plugin for Google Antigravity (`agy`) that helps complete multi-step coding tasks accurately from start to finish.

Once you enter a task and approve the plan, NTG breaks the work into steps and runs them. Because it separately verifies whether each step is properly finished and records your progress, you do not need to worry about how it works under the hood—just run it, and it carefully keeps track of the work in the background.

## The problem NTG solves

When tasks grow larger, AI coding tools commonly run into the following problems:

- **Tedious process management:** For multi-step work, you normally have to break down the instructions yourself, check the results, and resume interrupted work. With NTG, you just describe what to do and confirm the plan. NTG handles the execution and checks from there.
- **Claiming "done" on unfinished work:** Even when the AI says it is finished, parts may be missing or differ from your requirements. NTG does not just take the coding AI's word for it—it runs a separate review. A step is marked complete only when its conditions are actually met, and stays incomplete if it fails to pass.
- **Scope creep:** Each step clearly limits which files to edit, what work to do, and which areas to leave alone, keeping focus on one goal at a time.
- **Task-specific context separation:** Roles keep separate contexts, so individual calls stay small: in one observed sample the supervisor's initial Flash call used 9,883 input tokens versus 14,302 for the AGY default agent (~31% fewer). Whole-task totals are a different matter: in a single-sample one-shot measurement on issue #191 (same task and base commit, every role, child role and cache read counted), the full NTG pipeline used 16,284,488 tokens while a matched single-session AGY baseline used 3,995,749 — about 4x more. NTG trades tokens for verified, resumable structure; it is not a net token saver.
- **Broken workflow when interrupted:** The overall plan, verified results, reasons for being blocked, and next steps are saved to a file. If you close a session and reopen it later, you can pick up right where you left off without giving instructions from scratch.
- **Stale results kept after plan changes:** If the plan changes midway through, even steps that were already finished are re-verified from the beginning to make sure they match the new plan.

## Installation

Node.js 18 or higher and the Antigravity CLI (`agy`) are required.

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin install .
```

## Usage

For simple edits or short tasks, a standard `agy` chat is enough. For tasks that require multiple steps, enter the following in an `agy` session:

```text
/ntg <task>
```

1. NTG analyzes your request and shows an easy-to-read work plan.
2. Once you review and approve the plan, step-by-step execution and verification proceed in order.
3. If you want to see the overall progress visually, you can open the progress graph with the command below:

```text
/ntg graph
```

See [docs/usage.md](docs/usage.md) for detailed usage instructions, and [docs/status.md](docs/status.md) for current working status and verification records.
