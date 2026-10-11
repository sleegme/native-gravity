# NTG ledger DAG viewer: implementation design

- **Status:** design only. Nothing is implemented.
- **Date and base:** 2026-10-11, `native-gravity` at `f72c9ab` (`feat/113-live-probe`).
- **Observed runtime:** AGY 1.3.3 (`~/.local/bin/agy`), herdr 0.9.3, Node 26.8.1. The package floor is Node >= 18 and CI uses Node 20.
- **Owner ask:** "AGY내에 적용이 가능한지". Show the ledger milestone DAG "in the TUI", the way [jc01rho/omo-herdr-dag](https://github.com/jc01rho/omo-herdr-dag) shows an OmO workflow DAG in a right-hand herdr pane.

> **Owner answer (ko):** 가능합니다. 다만 omo-herdr-dag처럼 확장 + 이벤트로 붙는 방식은 AGY에 확장 API가 없어서 그대로 옮길 수 없습니다. 대신 원장(ledger) 파일을 읽기만 하는 스크립트를 agy 옆 herdr pane에서 `--watch`로 띄워 같은 화면을 만듭니다. 지금은 원장 파일이 vNext spine 실행에서만 생깁니다.

## 0. Decision

- **Recommended path: option (b).** One read-only, dependency-free script, `scripts/dag-view.mjs` (npm bin `ntg-dag`), prints the ledger's milestone DAG as Unicode boxes. `--watch` keeps it live. Inside AGY it runs in a herdr or tmux pane beside `agy`, or one-shot in the conversation through AGY's bash mode.
- **Not in v1:** no AGY skill, hook, agent, rule or plugin-manifest change, no pane management, and no interactive keys.
- **Why omo-herdr-dag's mechanism doesn't port:** that extension runs inside OmO, listens for `omo.dag.updated` on Senpi's in-process event bus, and opens a herdr pane itself. AGY has no extension runtime and no event bus.
- **Why it works anyway:** `AuthoritativeLedger.save()` replaces the ledger file atomically (temp file plus `renameSync`), so the file itself can be the event source for a passive watcher.
- **Caveat for the owner:** today the only ledger writers are the vNext spine (`scripts/spine.mjs`, `MinimalSpine`, which describes itself as "not a default runtime entry") and tests. Ordinary v0.4 Bulldozer and Piledriver sessions write no ledger. Until vNext activation, the viewer has real data only for spine-driven runs. Piledriver's `TASK_GRAPH` is prose and out of scope.
- **Headline acceptance:** `node scripts/dag-view.mjs --ledger tests/fixtures/dag-view/all-states.ledger.json --width 80 --no-color` prints the frame in section 3.3 and exits 0. Every check is listed in section 8.

## 1. Approach

### 1.1 Constraints found

Everything here was observed in this session unless marked otherwise.

| Fact | Source | Consequence |
|---|---|---|
| AGY's extension points are all plugin components: skills, agents, rules, hooks, MCP servers and commands, plus a `bin/` folder of tools the agent can run by name. There is no event subscription API. | `agy --help`, `agy plugin validate .`, built-in `agy-customizations/docs/plugins.md`, changelog 1.3.2 | Nothing like `omo.dag.updated` exists, so "update on change" has to come from the file |
| The hook events are `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation` and `Stop`. Hook output is a `reason` "shown to the user/agent". | built-in `agy-customizations/docs/hooks.md` | A hook can't host a pane, and it never sees ledger writes because the spine writes them, not an AGY tool |
| Plugin skills appear as `/<plugin>:<skill>` and run through the agent | AGY changelog | A `/native-gravity:...` command only works when the active agent has `run_command` |
| Bulldozer and Piledriver have no `run_command`. Excavator and Bobcat have it, and Zen has a verification-only version. | `agents/*.md` frontmatter, `docs/status.md` | In the two orchestration modes, a skill can't render without a Bobcat hop |
| `agy plugin validate .` reports: skills skipped (not found), agents 9, commands skipped, mcpServers skipped, hooks 4 | run 2026-10-11 | NTG ships no AGY skill. `skills/qa-*.md` are QA docs under the `skills/README.md` contract, not AGY skills |
| AGY's artifact viewer renders Mermaid as a Kitty image or a Unicode fallback, with left/right panning | AGY changelog | It is the only native diagram renderer, but the agent has to author the artifact |
| AGY has a user "bash mode" | the string `activated bash mode` in the 1.3.3 binary; changelog 1.0.10, "Fixed bash mode argument escaping (preventing swallowed stdout)" | A user-run command can print into the conversation with no agent tool. The trigger key is unknown (P1) |
| The ledger is written only by `save()`: a temp file `.ledger-<ts>-<rand>.tmp` in the same directory, then `renameSync`. `MinimalSpine` calls `save()` at creation and after every transition (9 call sites). | `scripts/ledger.mjs`, `scripts/spine.mjs` | A reader sees either the old or the new complete file, so reading needs no lock |
| Writers hold an exclusive `<ledger>.lock` (`openSync(..., 'wx')`) for the whole session | `scripts/ledger-lock.mjs`, `spine.mjs`, `ntg-run --ledger` | The viewer must never call `acquireLedgerLock` |
| The caller chooses the ledger path (`MinimalSpine({ ledgerPath })`, `ntg-run --ledger`). There is no default location. | `spine.mjs`, `ntg-run.mjs`, architecture contract OQ-5 | The viewer takes the path explicitly |
| herdr offers `pane split --current --direction right --ratio F --no-focus`, which returns `.result.pane.pane_id`, and `pane run <PANE_ID> <COMMAND>...` | `herdr pane split --help`, `herdr pane run --help`, `herdr --skill` | omo-herdr-dag's pane recipe can be reproduced from a shell without NTG code |

### 1.2 Options

| | Option | Result inside AGY | Cost and coupling | Verdict |
|---|---|---|---|---|
| (a) | Port omo-herdr-dag: an AGY-side trigger, herdr pane lifecycle and an interactive TUI | A live pane that opens itself | The trigger would be a hook that never sees ledger writes. Needs a pane registry, duplicate suppression, manual-close memory, a view-state file, key handling and a hard herdr dependency. The reference implementation needs Node 24+ | Reject; keep only its visual model |
| (a') | Convert the ledger into omo-herdr-dag snapshots and reuse its viewer | Its full TUI | Binds NTG to a third party's internal snapshot format and install layout, and still needs a converter and a pane opener | Reject |
| (b) | Read-only renderer script, one-shot plus `--watch` | A live pane beside agy (any multiplexer), or one-shot in the conversation via bash mode | About 300-350 lines, no dependencies, Node >= 18, and no AGY surface touched | **Recommend** |
| (c) | AGY skill wrapping (b): `skills/ntg-dag/SKILL.md`, invoked as `/native-gravity:ntg-dag` | One-shot, run by the agent | Works only where the agent has `run_command`, which excludes Bulldozer and Piledriver. Spends a model turn copying deterministic text. Makes `skills/` an AGY-loaded folder, which conflicts with the QA-only `skills/README.md` contract | Defer (F4) |
| (d) | Mermaid artifact for AGY's artifact viewer | A rendered diagram, one-shot | The agent has to author the artifact, so it has the same tool gating as (c). Not live. Unverified whether a script can create artifacts. Unreadable in a plain terminal | Defer (F1) |
| (e) | Hook auto-print: `PostToolUse` or `Stop` runs the renderer | Text arrives as a hook `reason` | Adds harness weight to every tool call, and ledger writes don't pass through AGY tools | Reject |
| (f) | Plugin MCP server as an extension host that opens the pane and exposes a `dag_view` tool | Auto-open, and maybe a tool Bulldozer can call | A sidecar process in every NTG session, a hand-rolled MCP protocol and pane side effects at session start. Unknown whether agents with a `tools:` list can call it | Reject |

### 1.3 Why (b)

- **Rule 1, native-first.** (b) leaves AGY's agent lifecycle, delegation and completion exactly as they are. It changes no hook, skill, agent, rule or manifest, and `agy plugin validate .` output stays identical (A4). It is not runtime machinery: it takes no part in orchestration and only displays a file the authority already writes. Where AGY offers an in-TUI surface that needs no agent tool (bash mode), (b) uses it as it is.
- **Rule 3, shallow graph.** (b) adds no agent, no delegation edge and no tool to any agent's list. Option (c) would cost a Bulldozer-to-Bobcat hop for every view, and options (a), (e) and (f) add harness weight to every session.
- **AGENTS.md model-adaptive policy.** It rules out "custom coordination runtimes, or persistent state". Options (a) and (f) need both; (b) needs neither.
- **Testability.** The output is deterministic text from a file, tested by subprocess in the same style as `tests/test_ntg_run.mjs`.

Compared with omo-herdr-dag, the owner gives up auto-open, keyboard navigation and folding, and switching between runs. A two-line pane recipe (section 4) takes the place of auto-open.

## 2. Data source

The script reads the file with `JSON.parse(readFileSync(path, "utf8"))`, not with `AuthoritativeLedger.load()`, for two reasons:

- `load()` runs the full `fromJSON` integrity checks (recomputing `result_ref`, checking candidate integrity). A viewer must still render a ledger that the authority would reject.
- `scripts/ledger.mjs` is not in the `package.json` `files` list, so importing it would break the npm-installed `ntg-dag`.

### 2.1 Fields read (shape from `toJSON()`)

| Field | Type | Used for |
|---|---|---|
| `plan_version` | string or number | header `plan v2` |
| `milestones[].id` | string | node key and edge endpoints |
| `milestones[].dependencies` | string[] | edges `dep -> id`, layers, READY |
| `milestones[].title` | string (the writer defaults it to `id`) | box title line, skipped when it equals `id` |
| `completed_milestones` | string[] | DONE, READY and the header count |
| `current_milestone` | string or null | ACTIVE and the header |
| `verification[id].verdict` | `"GO"` or `"NO-GO"` | NO-GO and the STALE note |
| `verification[id].is_stale` | boolean | STALE versus a current NO-GO |
| `verification[id].plan_version` | string or number | STALE note `was GO@v1` |
| `blockers[].affects_milestone`, `blockers[].description` | string | BLOCKED and the footer |
| `next_action` | string | footer `next:` line, which says "Awaiting Zen review ..." while the ACTIVE milestone is under review |
| `goal` | string | header line 2 |

Five of these go beyond the six requested fields: `title`, `verification[id].plan_version`, `blockers`, `next_action` and `goal`. They are the cheapest way to show why a node is stuck without reading internals.

Not read: `evidence`, `constraints`, `decision_invariants`, every `_`-prefixed internal (`_active_candidates`, `_known_candidates_by_ref`, `_verification_history`, `_initialized`), and `verification` entries for ids that a replan removed.

### 2.2 Structural checks

Before layout, the script checks four things in its own code (about 25 lines):

- `milestones` is a non-empty array.
- Ids are unique, non-empty strings.
- Every dependency exists and is not the node itself.
- The graph is acyclic.

These are the rules that `validatePlan()` in `scripts/ledger.mjs` enforces. A parity test (A2.4) feeds the same bad graphs to both, so they can't drift on these cases. Authority invariants, such as "DONE implies a fresh GO", are not re-checked; the viewer trusts the writer.

### 2.3 Read-only guarantees

- It never calls `acquireLedgerLock` and never opens `<ledger>.lock`, so it works while a spine or `ntg-run --ledger` holds the lock.
- It writes nothing: no snapshot copy, no view-state file, no cache.

## 3. Output

### 3.1 Node states

States are evaluated per milestone, top to bottom; the first match wins.

| Tag | Condition | Colour on a TTY |
|---|---|---|
| `ACTIVE` | `id === current_milestone`, whether executing or under Zen review (the `next:` line says which) | cyan, bold |
| `DONE` | `id` is in `completed_milestones`; the writer guarantees a fresh GO at the current `plan_version` | green |
| `BLOCKED` | some `blockers[].affects_milestone === id` | yellow |
| `NO-GO` | `verification[id].verdict === "NO-GO"` and the verdict is not stale | red |
| `STALE` | `verification[id].is_stale`: the verdict came from an older plan and the milestone must pass again. The box shows the note `was <verdict>@<plan_version>` | magenta |
| `READY` | every dependency is in `completed_milestones` | bold |
| `PENDING` | anything else | dim |

The tag is text inside the box border, so the state survives `--no-color`, pipes, logs and copy-paste. Colour on the border, id and tag is only an enhancement. The colours follow omo-herdr-dag (running cyan, completed green, failed red, blocked yellow); STALE gets magenta so it can't be confused with BLOCKED.

### 3.2 Layout rules

1. **Layers.** A node's layer is its longest path from a root: roots are `L0`, and every other node is `1 + max(layer(dep))`. Within a layer, nodes keep plan order.
2. **Edges.** Each milestone gets one box and no edges are drawn. Instead, each box lists its incoming dependencies as `← a, b`, the way omo-herdr-dag shows incoming ids for edges that skip a frontier. If the list overflows, it ends with a count, as in `← a, b +3`.
3. **Box contents.** Each content line appears only when present: the title (if it differs from the id), the dependencies, and a note (STALE: `was GO@v1`; BLOCKED: the first matching blocker description). Boxes in one visual row are padded to the same height.
4. **Box width.** All boxes share one width: inner width = clamp(max over nodes of `width(id) + width(tag) + 6`, 20, 32). Longer text is clipped with `…`.
5. **Display widths.** All widths are terminal display widths. Hangul, CJK and fullwidth characters count 2 and combining marks count 0, so Korean titles keep the borders aligned. Clipping never splits a wide character, and any one-column gap left over is padded. Newlines inside text become spaces.
6. **Header and footer.** The header reads `NTG ledger · plan <pv> · <done>/<total> done · active: <id or none> · <n> blocker(s)`, followed by `goal: ...`. The footer is `next: ...`, then one `blocker <milestone>: <description>` line per blocker, up to 5, then `+N more`. Every line is clipped to the width.

### 3.3 Sketch: the `all-states` fixture with `--width 80 --no-color`

```text
NTG ledger · plan v2 · 2/9 done · active: api · 1 blocker
goal: Ship the ledger-backed CLI

L0  ┌ schema ────── DONE ┐
    │ Ledger schema      │
    └────────────────────┘

L1  ┌ store ─────── DONE ┐  ┌ cli ──────── STALE ┐  ┌ docs ─────── NO-GO ┐
    │ Persist store      │  │ CLI entry point    │  │ Usage docs         │
    │ ← schema           │  │ ← schema           │  │ ← schema           │
    │                    │  │ was GO@v1          │  │                    │
    └────────────────────┘  └────────────────────┘  └────────────────────┘

L2  ┌ api ─────── ACTIVE ┐  ┌ auth ───── BLOCKED ┐  ┌ metrics ──── READY ┐
    │ HTTP API           │  │ Auth flow          │  │ Metrics export     │
    │ ← store            │  │ ← store            │  │ ← store            │
    │                    │  │ OAuth sandbox cre… │  │                    │
    └────────────────────┘  └────────────────────┘  └────────────────────┘

L3  ┌ e2e ────── PENDING ┐
    │ End-to-end tests   │
    │ ← api, auth, cli   │
    └────────────────────┘

L4  ┌ release ── PENDING ┐
    │ Release 0.5        │
    │ ← e2e, docs        │
    └────────────────────┘

next: Awaiting Zen review for milestone 'api' (result_ref: ref-sha256-3f9a1c0d7…
blocker auth: OAuth sandbox credentials missing
```

### 3.4 Wide and tall graphs

- **Width source:** `--width`, else `process.stdout.columns`, else `$COLUMNS`, else 80.
- **Wrapping wide layers:** boxes per row = `max(1, floor((width - 2) / (boxWidth + 2)))`. A wider layer continues on the following rows under the same `Lk` label. A 35% pane on a 160-column screen (about 56 columns) holds 2 boxes per row:

```text
L1  ┌ store ─────── DONE ┐  ┌ cli ──────── STALE ┐
    │ Persist store      │  │ CLI entry point    │
    │ ← schema           │  │ ← schema           │
    │                    │  │ was GO@v1          │
    └────────────────────┘  └────────────────────┘
    ┌ docs ─────── NO-GO ┐
    │ Usage docs         │
    │ ← schema           │
    └────────────────────┘
```

- **List layout:** when even one box doesn't fit (`width < boxWidth + 4`), the output switches to one line per node. In `--watch` on a TTY, a box frame taller than `process.stdout.rows` uses the list layout too. One-shot output is never truncated; the terminal's scrollback holds it.

```text
L0 DONE    schema
L1 DONE    store ← schema
L1 STALE   cli ← schema (was GO@v1)
L1 NO-GO   docs ← schema
L2 ACTIVE  api ← store
L2 BLOCKED auth ← store
L2 READY   metrics ← store
L3 PENDING e2e ← api, auth, cli
L4 PENDING release ← e2e, docs
```

### 3.5 Watch mode

- **Polling.** The script renders once, then polls with `fs.watchFile(path, { interval: 500 })`. It does not use `fs.watch`, because the writer replaces the file by rename: an inotify watch on the old inode goes silent after the first save. Polling by path follows the replacement, and it also covers a file that doesn't exist yet. A 500 ms interval is invisible at milestone granularity.
- **Redraw.** Each frame is drawn in place: cursor home, every line followed by clear-to-end-of-line, then clear below. There is no alternate screen, no key handling and no signal handler. Ctrl+C ends the process through Node's default SIGINT handling and leaves the last frame on screen, like omo-herdr-dag's disconnected view.
- **Resize.** On a `process.stdout` `resize` event, the last good state is re-rendered.
- **Errors.** On a read, parse or graph error, the last good frame stays on screen with an added line, `! <error> (showing last good frame)`. Before the first good frame, the screen shows `waiting for <path>: <error>`. Watch mode never exits because of ledger errors.
- **Third header line.** Watch mode adds `watching <path> · updated HH:MM:SS`, giving the time of the last successful read.
- **Non-TTY output.** When stdout is not a TTY (`--watch | tee`, tests), no escape codes are written, and each full frame is separated from the next by a blank line.

## 4. Interface

```text
ntg-dag --ledger <ledger.json> [--watch] [--width <cols>] [--no-color]
node scripts/dag-view.mjs ...      # the same, from a checkout or the installed plugin copy
```

- **`--ledger <path>` or `--ledger=<path>`:** the path the supervisor uses, from `MinimalSpine({ ledgerPath })` or `ntg-run --ledger`. Without it the script uses `$NTG_LEDGER`; without either it is a usage error. There is no filesystem discovery.
- **`--watch`:** live mode (section 3.5). One-shot is the default.
- **`--width <cols>`:** a positive integer.
- **`--no-color`:** also implied when stdout isn't a TTY, or when `NO_COLOR` is set and non-empty.
- **`-h`, `--help`.**
- **Exit codes:** `0` when a one-shot render succeeds, `1` when the ledger is missing, unreadable or invalid in one-shot mode, and `2` for usage errors. Watch mode runs until it is interrupted.
- **Argument parsing** is hand-rolled, the same way as `scripts/ntg-run.mjs`.

There is no `agy` flag: `agy` is a closed binary, and `ntg-run` doesn't need to change. There is no slash command in v1; see (c) in section 1.2.

How the owner uses it with AGY:

| Surface | Live | Depends on |
|---|---|---|
| A side pane beside agy, the equivalent of `/dag-pane` (recipe below) | yes | `ntg-dag` on PATH (npm global install) or `node <repo>/scripts/dag-view.mjs`; P2 |
| The AGY conversation, run by the user: in bash mode, `ntg-dag --ledger <path>` | no | P1 |
| The AGY conversation, run by an agent: in an Excavator session (it has `run_command`), ask it to run `node scripts/dag-view.mjs --ledger <path> --no-color` | no | Bulldozer and Piledriver can't do this, and they get no extra delegation hop for it |

The side-pane recipe can run from AGY bash mode, where `--current` targets the agy pane (P3). From another shell, replace `--current` with agy's pane id.

```sh
# herdr (needs jq): a ~35% right pane, with focus staying on agy
p=$(herdr pane split --current --direction right --ratio 0.65 --no-focus | jq -r .result.pane.pane_id)
herdr pane run "$p" "ntg-dag --watch --ledger $NTG_LEDGER"

# tmux
tmux split-window -h -l 35% "ntg-dag --watch --ledger $NTG_LEDGER"
```

Any second terminal running `ntg-dag --watch --ledger <path>` works too.

## 5. Compatibility

- **Node >= 18**, matching `package.json` `engines` (CI runs Node 20). The script uses only Node 18 APIs: `fs.readFileSync`, `fs.watchFile` and `fs.unwatchFile`, `process.stdout` `isTTY`, `columns`, `rows` and its `'resize'` event, and `node:path`. ANSI codes are written by hand; it does not use `util.styleText` (Node 20.12+) or `fs.watch`. omo-herdr-dag's Node 24 floor does not apply.
- **No npm dependencies and no network.**
- **Standalone.** It needs no agy, herdr, tmux or plugin install to run, and it doesn't have to run inside an agy pane. Inside AGY's own window, only bash mode (P1) or an agent with `run_command` can show its output.
- **AGY-specific hooks:** none are needed and none are added. `hooks.json`, `plugin.json`, `agents/`, `rules/` and `skills/` stay unchanged.
- **Distribution:**
  - The installed plugin copy at `~/.gemini/config/plugins/native-gravity` is a full checkout (it contains `.git/` and `scripts/`), and it is stale. `agy plugin list` shows it was imported on 2026-09-30, and it lacks `scripts/ntg-run.mjs` and `scripts/ledger-lock.mjs`. Reinstall it as `docs/usage.md` describes to get `scripts/dag-view.mjs` there.
  - The npm package ships only what `files` lists, and `native-gravity install` installs the AGY plugin from that package. So `scripts/dag-view.mjs` must be added to `files`, and the `ntg-dag` bin must be added too.
- **Terminal:** UTF-8 with box-drawing glyphs, the same requirement as herdr and omo-herdr-dag. Terminals that draw East Asian ambiguous-width characters as wide will misalign the boxes (R2).

## 6. Scope limits (do not build)

- **No writes of any kind:** no ledger edits, no transitions (`delegate`, `recordZenGo`, `materialReplan` and so on), no lock, no snapshot file and no view-state file.
- **No task control:** no re-running, retrying or cancelling milestones or tasks, no import of `spine.mjs` or `runner.mjs`, and no `agy` invocation.
- **No network, telemetry or npm dependencies.**
- **No AGY surface changes:** no skill, command, hook, rule, manifest edit or new entry in any agent's `tools` list.
- **No pane lifecycle:** no auto-open, pane registry, duplicate suppression or herdr/tmux calls from the script. The pane recipe lives in the docs.
- **No interactive TUI:** no keys, scrolling, selection, folding or run switching.
- **No Mermaid, SVG or HTML output in v1.**
- **No other inputs:** no rendering of Piledriver `TASK_GRAPH` prose, AGY transcripts or the #113 probe JSONL.
- **No ledger discovery:** the path is always explicit.
- **No re-validation of authority invariants**, such as `result_ref` integrity or "DONE implies a fresh GO".
- **Not an evidence source:** Zen and Bulldozer keep reading the ledger and verdicts, and the rendered view is never cited as verification.
- **No changes** to `scripts/ledger.mjs`, `scripts/spine.mjs`, `scripts/ntg-run.mjs` or `AGENTS.md`.

## 7. Files

| Path | Change |
|---|---|
| `scripts/dag-view.mjs` | New. A CLI with a `#!/usr/bin/env node` shebang, about 300-350 lines. Like `ntg-run.mjs`, it always runs `main()`: parse arguments, read, check, derive states, assign layers, render, then exit or watch |
| `tests/test_dag_view.mjs` | New. Uses `node:test` and runs the script as a subprocess, in the style of `tests/test_ntg_run.mjs` |
| `tests/fixtures/dag-view/all-states.ledger.json` | New. Built with the real `AuthoritativeLedger` API (sequence below) and shows every state at once |
| `tests/fixtures/dag-view/wide-cjk.ledger.json` | New. A root `base` that has passed (DONE) and 10 dependents `w01`-`w10` (READY) with Korean titles, at least one of them wider than a box |
| `package.json` | Add `"ntg-dag": "scripts/dag-view.mjs"` to `bin` and `"scripts/dag-view.mjs"` to `files` |
| `docs/usage.md`, `docs/ko/usage.md` | A new "DAG view" section: synopsis, `--watch`, the pane recipe, bash mode, the states table, and the caveat that only ledger-backed runs have data |

To build the `all-states` fixture, write a throwaway script, run it once, commit the JSON and delete the script. The same steps regenerate the fixture if `ledger.mjs` changes.

1. Create `new AuthoritativeLedger({ goal: "Ship the ledger-backed CLI", plan_version: "v1", milestones: [schema, cli <- schema] })`.
2. Run `pass("schema")` and `pass("cli")`. Here `pass(id)` means three calls:
   - `delegate(id)`
   - `receiveCandidate({ milestone_id, plan_version, status: "DONE", changes_made, verification_evidence, unresolved_unknowns: [], scope_deviations: [] })`
   - `recordZenGo({ milestone_id, plan_version, result_ref, verdict: "GO", verification_evidence })`
3. Run `materialReplan({ milestones: v2 })`, where v2 is: `schema`; `store <- schema`; `cli <- schema`; `docs <- schema`; `api <- store`; `auth <- store`; `metrics <- store`; `e2e <- api, auth, cli`; `release <- e2e, docs`. The plan becomes `v2` and both v1 verdicts go stale.
4. Run `pass("schema")` and `pass("store")`.
5. Run `delegate("docs")`, `receiveCandidate(...)` and `recordZenNoGo(...)`.
6. Run `delegate("auth")` and `recordBlockedOrFailure({ blockers: ["OAuth sandbox credentials missing"] })`.
7. Run `delegate("api")` and `receiveCandidate(...)`, and leave it awaiting Zen review.
8. Run `save("tests/fixtures/dag-view/all-states.ledger.json")`.

Titles: schema "Ledger schema", store "Persist store", cli "CLI entry point", docs "Usage docs", api "HTTP API", auth "Auth flow", metrics "Metrics export", e2e "End-to-end tests", release "Release 0.5".

Resulting states: schema DONE, store DONE, cli STALE (was GO@v1), docs NO-GO, api ACTIVE, auth BLOCKED, metrics READY, e2e PENDING and release PENDING. That is 2/9 done with 1 blocker.

Build order:
1. Fixtures.
2. One-shot rendering and its tests.
3. Watch mode and its test.
4. `package.json` and docs.
5. Live probes (section 9).

## 8. Acceptance

- **A1, the visible check.** `node scripts/dag-view.mjs --ledger tests/fixtures/dag-view/all-states.ledger.json --width 80 --no-color` exits 0 and prints the frame in section 3.3. Only the hash on the `next:` line differs.
- **A2.** `node --test tests/test_dag_view.mjs` passes and covers:
  1. **Fixtures are valid.** Both fixtures load with `AuthoritativeLedger.load()`, so they are valid ledgers, and a change to the ledger schema fails here instead of silently rendering wrong.
  2. **The all-states frame.** At width 80:
     - Every id appears in exactly one box top border, with its expected tag.
     - Layers `L0`-`L4` hold the expected members.
     - The header reads `plan v2 · 2/9 done · active: api · 1 blocker`.
     - The footer has `next:` and `blocker auth:`.
     - No line is wider than 80, and piped output contains no `\x1b[`.
  3. **Wrapping and Korean text.** For `wide-cjk`:
     - Width 80 gives `L1` rows of 3, 3, 3 and 1, width 56 gives rows of 2, and width 20 gives the list layout.
     - In every box row, all lines have the same display width, Korean titles included.
     - The long Korean title ends with `…`.
  4. **Bad graphs.** A ledger with a cycle and one with a dangling dependency (both written inline to a temp dir) exit 1 and name the milestone. `validatePlan()` from `scripts/ledger.mjs` also throws on the same input (parity).
  5. **Input errors.**
     - A missing file exits 1, and malformed JSON exits 1.
     - With no `--ledger` and no `NTG_LEDGER`, it exits 2 and prints usage. `NTG_LEDGER` is honoured when set.
     - An unknown flag, `--width 0` or `--width abc` exits 2.
  6. **Read-only.** The fixture's sha256 and its directory listing are unchanged after both a one-shot and a watch run. Rendering also succeeds while the test process holds `acquireLedgerLock()` on a copy.
  7. **Watch mode, event-driven.**
     - Copy `all-states` to a temp dir, spawn `--watch` with piped stdout, and wait (at most 5 s) for the first header line.
     - Load the copy with `AuthoritativeLedger.load()`, call `recordZenGo` for `api` with its active candidate's `result_ref`, and `save()` it. This is the real temp-file-plus-rename path.
     - Wait (at most 5 s) for a header containing `3/9 done`, then kill the process. No sleeps.
- **A3.** `node --test tests/*.mjs` and `python -m unittest discover -s tests` still pass.
- **A4.** `agy plugin validate .` output is unchanged: skills skipped, agents 9 processed, commands skipped, mcpServers skipped, hooks 4 processed.
- **A5.** `npm pack --dry-run` lists `scripts/dag-view.mjs`, and `node --check scripts/dag-view.mjs` passes.
- **A6, the live check the owner sees.** With agy in a herdr pane and `ntg-dag --watch --ledger <spine ledger>` in a right pane at about 35%, a spine transition appears within about a second, and Ctrl+C leaves the last frame on screen.

## 9. Live probes after implementation

The probes only adjust `docs/usage.md`; none of them blocks the code.

| # | Question | How | If it fails |
|---|---|---|---|
| P1 | What triggers AGY bash mode, and does the frame arrive intact? | In interactive agy 1.3.3, try `!` at an empty prompt (inferred), then run `ntg-dag --ledger <fixture>` | Drop bash mode from the docs and keep the side pane |
| P2 | Does `herdr pane split` print JSON with `.result.pane.pane_id`, and does `pane run` accept a single command string? | Run the section 4 recipe inside herdr 0.9.3 | Document a manual split from the herdr UI, then typing the command |
| P3 | Does bash mode inherit agy's environment (`HERDR_PANE_ID`, `NTG_LEDGER`)? | In bash mode, run `echo $HERDR_PANE_ID $NTG_LEDGER` | Run the recipe from another shell, using agy's pane id instead of `--current` |

## 10. Risks and follow-ups

Risks:

- **R1.** The viewer's value depends on ledger-backed runs (section 0). Until vNext activation it serves spine runs and fixtures only.
- **R2.** Terminals that draw ambiguous-width characters as wide will misalign the boxes. omo-herdr-dag has the same exposure, and the list layout is unaffected.
- **R3.** Reading raw `toJSON()` fields couples the viewer to the ledger schema. A2.1 turns any drift into a test failure.
- **R4.** Bash mode is unverified (P1). The side pane does not depend on it.

Follow-ups, each only on the owner's request:

- **F1. `--format mermaid`** (about 30 lines): a fenced `flowchart` with the same states as `classDef`s, for GitHub docs and AGY's artifact viewer. This is where the Mermaid idea from `.omo/evidence/dag-viz-research.md` lands.
- **F2. `ntg-run --dag-pane`** (herdr only). `ntg-run` already knows the ledger path, so it is the one place an auto-open could live. The cost is coupling the launcher to herdr and adding a fake `herdr` to `tests/test_ntg_run.mjs`. Do it only if the recipe proves tedious.
- **F3. Export `NTG_LEDGER` from `ntg-run --ledger`** to the agy child process, so `ntg-dag` needs no argument inside the session. This depends on P3.
- **F4. An AGY skill (option (c))**, if the owner mostly works in Excavator or default-agent sessions. Before adding it, narrow `skills/README.md` to cover only `skills/qa-*.md`.
- **F5. Pre-existing CI gap:** CI runs no Node tests. `package.yml` only runs `node --check scripts/npm-install.mjs` and `npm pack --dry-run`. Track this as a separate issue.

## Appendix: evidence and provenance

The observed facts and their sources are in section 1.1. Also observed:

- In `scripts/ledger.mjs`: `toJSON()` and `fromJSON()`.
- `materialReplan()` bumps `plan_version`, marks every verification stale and clears `completed_milestones`.
- `delegate()` has no blocker gate (open question #93).

Inferred:

- Bash mode is a user prompt mode whose command output appears in the conversation. Its trigger is probably `!`.
- `herdr pane split` prints the JSON that `herdr --skill` describes. This session isn't running inside herdr, so the command wasn't run.
- No ordinary v0.4 session creates a ledger. The agent and rule files mention the ledger only as something not to write, and `save()` is called only by `spine.mjs` and tests.

Unknown:

- Bash mode's trigger, its PATH, whether it inherits the environment, and whether its stdout is a TTY (P1, P3).
- Whether plugin `bin/` tools are on bash mode's PATH.
- The format of plugin `commands/`. `agy plugin validate` lists the component, but the built-in docs don't describe it, so it's also unknown whether a command can run a shell without the agent.
- Whether a script can create an AGY artifact (option (d)).
- Whether `/statusline` custom status lines (changelog 1.0.x) still exist in 1.3.3; the binary has no matching command strings. A one-line DAG summary there would be the only live surface inside agy itself. Not pursued.
- Whether agents whose `tools:` list omits MCP tools can still call them (option (f)).

Inherited inputs, reported because of the owner's rule about state from before the clean bootstrap:

- **`.omo/evidence/dag-viz-research.md`:** untracked, modified 2026-10-11 15:34 KST, author not recorded. Its list of ledger fields was re-checked against `scripts/ledger.mjs` and matches. Its recommendation, a Mermaid block in markdown, is superseded by the owner's in-TUI requirement and kept as F1.
- **Agent memory note `ntg-patch-state.md`** (AGY 1.3.1 patch history): used for context only. Every version cited in this design was re-observed in this session.
