# Native Gravity (NTG)

[![XERJ Corpus Hub contributor](https://hub.xerj.org/contributors/sleegme/badge.svg)](https://hub.xerj.org/contributors/sleegme)

[한국어](docs/ko/README.md)

## What is NTG?

Native Gravity 2.0 (NTG 2.0) is an Antigravity-native (`agy`) hybrid orchestration plugin centered on interactive **Steamroller** + **`LedgerKernel`** (`src/core/ledger-kernel.mjs`) and **`LightweightLog`** (`src/core/lightweight-log.mjs`).

Simply describe a task with `/ntg <task>`. Steamroller automatically classifies complexity across **Track L (`HALO_LIGHTWEIGHT`)**, **Track S (`ZEN_DURABLE`)**, and **Track M (`ZEN_DURABLE`)**, selects Direct/Lightweight specialists or **Bulldozer** (`Gemini 4 Neon High` / `XHigh`), runs quality review (**Strix Halo**) and independent verification (**Zen**), and persists durable progress outside conversation memory.

## Key Capabilities

- **Autonomous Track L / S / M routing:** Small, bounded low-risk edits run cleanly through **Track L (`HALO_LIGHTWEIGHT`)** with mandatory bound Strix Halo review; substantive single-milestone (**Track S**) and multi-milestone (**Track M**) tasks run with one plain-language approval and independent Zen verification.
- **Independent summative verification:** Zen runs as a non-mutating summative gate (`NTG_ACTIVE_ROLE=zen`) separated cleanly from Strix Halo formative quality reviews (`ACCEPT | REVISE | ESCALATE`) and stale/invalidated diffs.
- **Capability vs. authority separation:** Dynamic model routing (`ModelRouter` in `src/core/model-router.mjs`) optimizes model capability without ever granting extra shell, write, delegation, or verification permissions. Tasks unsuitable for `3.8 Flash Low` (`Jaguar`/`Puma`) reroute cleanly to `Bobcat` or `Bulldozer`.
- **Universal safety guard & observation-first telemetry:** `hooks/shell-safety-guard.py` enforces mutation and privilege boundaries across both `run_command` and file tools, while `hooks/telemetry-guard.py` replaces hard per-turn count blocks with observation-first loop detection.
- **Durable crash recovery & tactical/material replanning:** `LedgerKernel` tracks owner-token locks, re-validates stale verdicts whenever `plan_version` advances (both Tactical and Material replans), and preserves full 1.x `.ntg/ledger.json`, `plan.json`, and `plugin.json` compatibility (`src/core/v1-compat.mjs`).

## Installation

Requires Node.js 18+ and Antigravity CLI (`agy`) >= 1.3.0.

### Global install (auto-registers the `agy` plugin via `postinstall`)

- **npm (<= 11):**

  ```bash
  npm i -g native-gravity
  # or: npm i -g @sleeg/ntg
  ```

- **npm 12+** (blocks dependency `postinstall` scripts by default via `allowScripts`):

  ```bash
  # Allow postinstall once during install
  npm i -g --allow-scripts=native-gravity native-gravity
  # or with @sleeg/ntg
  npm i -g --allow-scripts=native-gravity,@sleeg/ntg @sleeg/ntg

  # Optional: persist global allow-scripts for future updates
  npm config set allow-scripts=native-gravity --location=user
  ```

- **Bun** (blocks dependency `postinstall` scripts unless `--trust` is passed):

  ```bash
  bun add -g --trust native-gravity
  # or: bun add -g --trust @sleeg/ntg
  ```

> **If install scripts were skipped** (for example, `npm i -g` on npm 12+ without `--allow-scripts`, or `bun add -g` without `--trust`), run `ntg` once (or `native-gravity` / `ntg-vnext`) to register the `agy` plugin automatically and add `native-gravity` and `@sleeg/ntg` to Bun's global `trustedDependencies` for future updates.

### One-shot or direct GitHub script install

You can also run the installer directly (`npx` / `bunx`) or use the `curl` and `irm` scripts, which download directly from GitHub and do not require `npm` or `npx` on PATH (only Node.js or Bun).

```bash
npx --yes native-gravity
```

```bash
bunx native-gravity
```

```bash
curl -fsSL https://raw.githubusercontent.com/sleegme/native-gravity/v2.0.0/scripts/install.sh | sh
```

```powershell
irm https://raw.githubusercontent.com/sleegme/native-gravity/v2.0.0/scripts/install.ps1 | iex
```

`ntg update` upgrades any existing install (npm, Bun, curl, or irm) to the latest release and prints the old -> new version.

## Usage

Enter `/ntg` in an `agy` session:

```text
/ntg <task>
```

1. NTG classifies your task (Track L/S/M) and, for Track S/M, shows one concise plain-language plan for confirmation.
2. Execution, Strix Halo review, recovery (Bulldozer + on-demand Instinct), and independent Zen verification proceed automatically.
3. Visualize live milestone progress at any time:

```text
/ntg graph
```

See [docs/usage.md](docs/usage.md) for detailed usage instructions, [docs/architecture.md](docs/architecture.md) for the Season 2 architecture overview, and [docs/status.md](docs/status.md) for current verification records.
