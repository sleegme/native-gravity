# Usage

[한국어](ko/usage.md) · [Product and installation](../README.md#installation) · [Current status](status.md)

Run NTG from any project directory — even a clean directory with no existing `AGENTS.md` or git history. You provide a task (or a `plan.json` file); Steamroller automatically selects the right track (**Track L**, **Track S**, or **Track M**) and internal specialists without requiring environment configuration.

## Running with /ntg

Enter directly in an `agy` session:

```text
/ntg <task>
```

- **Fresh task (Track L vs. Track S/M):**
  - Small, bounded low-risk work (`Track L`) executes through lightweight specialists and a fresh bound **Strix Halo** review (`HALO_LIGHTWEIGHT`), logged in `.ntg/lightweight-runs.jsonl`. High-risk tasks automatically escalate to independent Zen verification.
  - Substantive single-milestone (`Track S`) or multi-milestone (`Track M`) work presents a concise plain-language summary and waits for **one initial confirmation** before initializing `.ntg/ledger.json` and executing (`run --all`).
- **Resuming existing progress:** When `.ntg/ledger.json` already exists, `/ntg` checks current status and resumes execution (`run --all`) without discarding verified work.
- **Progress graph (`/ntg graph`):** Visualizes milestone dependencies and statuses side-by-side via `ntg-dag` without modifying progress.
- **Zero manual path env setup:** `skills/ntg/SKILL.md` resolves `scripts/ntg-command.mjs` relative to the installed plugin automatically.
- **Real verification boundaries:** Strix Halo quality review (`ACCEPT | REVISE | ESCALATE`) and independent Zen verification (`GO | NO-GO`) remain separate authorities; changed diffs or criteria invalidate prior Halo reviews automatically.

## CLI Usage (`ntg-vnext` & `ntg-command`)

You can also invoke the CLI directly (or via `node scripts/ntg-command.mjs`):

```json
{
  "goal": "Add a health-check endpoint to the example service",
  "constraints": ["No new dependencies"],
  "plan_version": "v1",
  "milestones": [
    {
      "id": "m1",
      "title": "Implement the endpoint",
      "objective": "Serve GET /health with {\"status\": \"ok\"}",
      "acceptance_criteria": ["GET /health returns 200 and a status field"],
      "non_goals": ["Metrics or readiness probes"],
      "dependencies": [],
      "bounded_scope": ["src/server.js"]
    },
    {
      "id": "m2",
      "title": "Cover it with a test",
      "objective": "Add one automated test for GET /health",
      "acceptance_criteria": ["A test asserts the 200 response and status field"],
      "non_goals": ["Full coverage of other routes"],
      "dependencies": ["m1"],
      "bounded_scope": ["tests/server.test.js"]
    }
  ]
}
```

Initialize and inspect status:

```bash
ntg-vnext init --ledger .ntg/ledger.json --plan plan.json
ntg-vnext status --ledger .ntg/ledger.json
```

Run milestones in dependency order (`--track L|S|M` optional):

```bash
ntg-vnext run --ledger .ntg/ledger.json --all
```

Run only the next ready milestone or target a specific one:

```bash
ntg-vnext run --ledger .ntg/ledger.json
ntg-vnext run --ledger .ntg/ledger.json --milestone m1
```

Revise a plan:

- **Tactical Replan** (updates remaining steps/milestones while preserving the user goal and invariants; increments `plan_version` and marks prior Zen `GO` / Halo verdicts `STALE`):

```bash
ntg-vnext tactical-replan --ledger .ntg/ledger.json --plan plan-v2.json
```

- **Material Replan** (changes goal, acceptance criteria, invariants, or destructive scope; requires explicit user re-approval):

```bash
ntg-vnext replan --ledger .ntg/ledger.json --plan plan-v2.json
```

Ask for planning advice (`plan`) or alternate causal framing (`alt`):

```bash
ntg-vnext plan --ledger .ntg/ledger.json --task "How should we structure verification for the health endpoint?"
ntg-vnext alt --ledger .ntg/ledger.json --milestone m1 --task "Challenge our current diagnosis of the failing endpoint"
```

## Crash recovery & snapshots

If a previous process crashed on Linux (leaving `.ntg/ledger.json.lock` with a dead PID/token), run owner-verified recovery before resuming:

```bash
ntg-vnext recover --ledger .ntg/ledger.json --evidence "Observed the previous supervisor exit during milestone execution"
```

Read-only progress views (`ntg-dag` and `ntg-state-snap`):

```bash
ntg-dag --ledger .ntg/ledger.json --width 80 --no-color
ntg-state-snap --ledger .ntg/ledger.json
node scripts/ntg-command.mjs graph
```

To inspect a shipped fixture:

```bash
ntg-dag --ledger tests/fixtures/dag-view/all-states.ledger.json --width 80 --no-color
```

Internal architecture and hook guards are covered in [Internals](internals.md).

## Install details

You need **Node.js 18+**, **Antigravity CLI (`agy`) >= 1.3.0** on your `PATH`, and working model access. Install or upgrade Native Gravity with a single command:

```bash
npx --yes native-gravity
```

You can also use `bunx native-gravity`, the curl installer (`curl -fsSL https://raw.githubusercontent.com/sleegme/native-gravity/v1.2.0/scripts/install.sh | sh`), or PowerShell (`irm https://raw.githubusercontent.com/sleegme/native-gravity/v1.2.0/scripts/install.ps1 | iex`).

Running the installer handles clean upgrades automatically (uninstalling the previous version before installing the new package).

Current release: version 1.2.0, alpha, validated across offline deterministic JS + Python test suites and host `agy models` policy surface checks.

Current limits: Crash lock PID+token termination recovery uses Linux `/proc` and Python `os.pidfd_open`; only one session owns `.ntg/ledger.json.lock` at a time.

## Reporting issues

```bash
ntg-report-issue --ledger .ntg/ledger.json
```

Previews a redacted diagnostic report locally (`issue-preview.md`) without mutating ledger progress.

## More documentation

- [Usage](usage.md): everyday workflows, examples and troubleshooting.
- [Architecture](architecture.md): NTG 2.0 hybrid design choices and track routing.
- [Internals](internals.md): implementation details for maintainers.
- [Navi](navi/README.md): isolated, bounded Linux desktop tasks through Steamroller.
- [NTG 2.0 Contract](specs/ntg-2.0-architecture-contract.md): canonical Season 2 technical contract.
- [Status](status.md): verified capabilities, known limits, and validation history.
- [Versioning](versioning.md): release policy and compatibility history.
