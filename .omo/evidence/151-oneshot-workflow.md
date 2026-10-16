# One-script worker workflow (#151)

## Scope and runtime path

Only Bobcat and Excavator receive four new prompt lines. All frontmatter,
tool lists, model fields, output contracts, and existing rules are unchanged.
Zen also has `run_command`, but is intentionally outside this request's
implementation-worker scope.

`tools/ctx` and `tools/git-snap` come from the measured wf-tools sources.
`tools/wf.py` retains only the two importable helpers and their text-returning
subprocess adapter; log triage and a calculator are not shipped.
The npm allowlist names the three source files individually so generated
Python bytecode is not distributed.

AGY 1.3.6's `agy plugin list --json` exposes the installed plugin's absolute
`path`, keyed by `name`. This is the worker's runtime discovery mechanism:
select `native-gravity`, add `<path>/tools` to `sys.path`, and import `wf`.
No fixed home or checkout path is needed in a shipped prompt or helper.
The observed install is under `~/.gemini/config/plugins/native-gravity`.

The repository's root `hooks.json` instead uses `python3 ./hooks/...`.
The installed AGY documentation in
`builtin/skills/agy-customizations/docs/hooks.md` says the hook working
directory is the directory containing `hooks.json`. That relative-path
convention belongs to hooks; worker commands run in the target workspace,
so the prompts use the CLI-reported plugin path rather than assuming a hook
environment variable or workspace-relative path.

## Real Bobcat proof

The branch was installed with the supported uninstall/install sequence:

```sh
cd /tmp/ntg-oneshot
agy plugin uninstall native-gravity
agy plugin install .
agy plugin list --json
```

All commands exited 0. AGY registered 10 agents and 2 hooks. Recursive tools
comparison and Bobcat prompt comparison against the installed copy passed.

The live target is a separate local clone, `/tmp/ntg-oneshot-live`, containing
the four role sources and `package.json`. The task is ordinary implementation:
write and run a standard-library role audit that reads those five files,
counts tools, records shell permission membership, and gathers real branch,
ahead/behind, status, and five recent commit subjects.
Only the audit script and its JSON output may be created.

The normal NTG path was used, not a direct Bobcat invocation or a substituted
role prompt:

```sh
cd /tmp/ntg-oneshot-live
node /tmp/ntg-oneshot/scripts/ntg-vnext.mjs init \
  --ledger .ntg/ledger.json --plan oneshot-plan.json
node /tmp/ntg-oneshot/scripts/ntg-vnext.mjs run \
  --ledger .ntg/ledger.json --all --timeout 900
```

- Bulldozer conversation: `19b808a8-4cb3-4f28-8d59-3edca91269d9`.
- Its native Bobcat child: `de8e4a01-16fa-4e18-aa90-0d1a6200e086`.
- Bobcat transcript location:
  `~/.gemini/antigravity-cli/brain/<child-id>/.system_generated/logs/transcript.jsonl`.
- Bobcat step 1: one `python3 -c` command loops over all five named source
  files and queries the plugin list; step 2 records exit 0 and the file output.
- Step 3: another Python script parses `agy plugin list --json`, selects
  `native-gravity`, inserts its discovered `tools/` path, and imports `wf`.
  Step 4 records exit 0 and the installed helper filenames and module exports.
- Step 5: a Python script calls `print(wf.git_snap())`; step 6 records exit 0
  with branch, ahead/behind, status, branches, five commits, remotes and stash.
- Step 7: one Python script gathers five git results, including the explicit
  comparison against `origin/main`; step 8 records exit 0 and real outputs.
- Step 35 is the strongest combined proof: one Python script discovers the
  installed root, imports `wf`, prints `wf.ctx("role-audit.py",
  "role-audit.json")`, and prints `wf.git_snap()`. Step 36 records exit 0,
  numbered source/output content, and the full git snapshot. The original
  AGY receipt truncates part of the file output; those markers are preserved.
- Bobcat's Strix Halo child `79f022f6-8f00-4905-bd11-fd0b890dc30d`
  returned `VERDICT: ACCEPT` at Bobcat step 40.

The lead also ran `python3 role-audit.py` successfully and inspected its JSON:
tool counts are 8, 7, 4 and 6, the shell-capable roles are Bobcat and Excavator,
and the branch, 0/0 divergence and five commit subjects match git.
`git diff --exit-code` confirms existing tracked live-target sources are
unchanged.

Bobcat sent `STATUS: READY` to Bulldozer at step 41 after the advisor verdict,
then completed at step 43. The outer `ntg-vnext run` exited 1 after that work:
`DONE must bind immutable delivered artifact versions`. Bulldozer's DONE
candidate omitted `candidate_artifact_ref`, so the unchanged spine rejected it
before Zen. This exact failure is already recorded on main in
`.omo/evidence/113-live-probe/results.jsonl` (B2-steamroller-zen).
The requested native Bobcat/tool proof succeeded; global milestone promotion
did not. No runner fix, evidence forgery, or gate bypass is included here.

The selected planner tool calls and matching execution outputs are preserved
in [151-bobcat-transcript.json](151-bobcat-transcript.json). Personal home
paths in that receipt are replaced with `$HOME`; no thinking text is included.
This is evidence of batching and actual installed-helper execution, not a
claim that the entire task used only one tool call or a new token benchmark.

## Repository checks

All commands below exited 0 on the final implementation tree:

| Command | Observed result |
| --- | --- |
| `node --test tests/*.mjs` | 171 tests: 170 pass, 0 fail, 1 existing skip |
| `python -m unittest discover -s tests -v` | 17 tests pass |
| `python -m compileall -q hooks tests tools` | Pass |
| `node --check scripts/npm-install.mjs` | Pass |
| `bash -n tools/ctx tools/git-snap tests/workflow-tools.sh` | Pass |
| `npm pack --dry-run` | 34 files; all three helper sources included, no helper bytecode |
| `agy plugin validate .` | 10 agents and 2 hooks processed |
| `git diff --check` and staged equivalent | Pass |

The existing skip is `tests/test_dag_view.mjs`'s persistent watch-mode test;
it is unrelated to this change and was not altered. The Node runner spike's
live sections were not disabled. The Python suite runs the adapted original
ctx/git-snap shell regression cases as well as a real `wf` import from a
different working directory with spaces and an unborn git repository.

The prompt-presence assertions are explicitly required by this issue.
Jaguar and Puma tests pin their exact existing tool lists. Their source files
are unchanged. The staged personal-home-path scan returned zero matches.

## Main installation restored

After the live run exited, the plugin was uninstalled and reinstalled from an
untouched main worktree at `5d766faf1a21fb7c613720fb90964baefc8bc56d`:

```sh
cd /tmp/ntg-oneshot-main
agy plugin uninstall native-gravity
agy plugin install .
diff -qr --exclude=.git . "$HOME/.gemini/config/plugins/native-gravity"
test ! -e "$HOME/.gemini/config/plugins/native-gravity/tools"
agy plugin list --json
```

All commands exited 0; the comparison covered the complete copied tree,
excluding only Git administrative metadata. No tools directory or branch hint
remains installed. The explicit completion receipt was
`MAIN_INSTALL_BYTE_MATCH=PASS`; AGY lists the restored plugin as enabled with
10 agents and 2 hooks.

Language-server diagnostics could not run: the configured basedpyright,
TypeScript, Biome and shell language-server executables are not installed.
The syntax, compilation, real helper, and full repository checks above ran
instead; no dependency or global configuration was added for diagnostics.
