# #30 / #34 provenance correction and measurements

Date: 2026-10-13. PR base: `f63478e5977b5b26b3c6b68d5c87a838b9a33d12`.
Compared baseline: `427544cc39141df35918c0a6d79e6e1b4c208607`.
This replaces the inaccurate evidence submitted at `223a6df`.

## Historical drafting boundary and its exception

Slice 44G did not establish provenance closure, as recorded in
`.omo/evidence/2026-10-02-44g-findings.md`. The first #30/#34 rewrite used a
history-free export of `0936cb2`, excluding `.omo/` and deleting the four
high-overlap distributed files: Excavator's guard and role, harness, and
orchestration rules. Command Code (`xiaomi/mimo-v2.6-pro`) could read the
remaining workspace, including AGENTS.md, the specification, tests, and
other roles. Its brief prohibited history, other checkouts, installed plugin
sources, Native Gravity web lookups, and OMO/GJC/OMP source.

The original report claimed every allowed text source had fewer than 20
shared runs and less than 3% overlap. That claim was false: the permitted
AGENTS.md was unchanged from `0936cb2` and shared 627 of 1,569 positional
runs (39.962%) with the full baseline. The worker's reported 45-call audit
did not exclude this explicitly permitted source. Low output overlap cannot
erase that historical input exception, and this correction does not certify
the first drafting workspace as fully isolated.

The surviving high-overlap guide was independently rewritten for this gate
correction, preserving role authority, model policy, routing, markers,
release checks, and completion contracts. The current guide measures
0/1,291 (0.000%). This is a current tracked-workspace result, not a claim
that the old export or every historical source was screened correctly.
AGENTS.md is not packed by npm.

For the guard correction, baseline behavior was used only as a decision
oracle: which marked commands must be denied. No baseline implementation
text was carried over; the corrected guard measures 0 shared runs below.
Nested inspection returns only a violation or None, so a clean
`bash -c true` no longer ends inspection of later commands. Normalization
handles leading assignments, executable paths, `env` options and
assignments, and the `command`, `nohup`, `exec`, and loop `do` wrappers;
sudo option values are consumed before the target command is classified.
The denied effect set is exactly the baseline's: sudo stdin passwords
(any short-option cluster containing S, plus `--stdin`), for-loop password
guessing, su, pkexec, root SSH to localhost/127.0.0.1/::1, bash/zsh history
reads, and pacman/yay/paru, apt/apt-get, dnf, yum, and zypper full upgrades.
The categories added in the first rewrite (doas, runuser, ksu, newgrp, sg,
`sudo -A`, other package managers and history files, 0.0.0.0 SSH) were
removed, and `sudo -pAUTH id` and `echo ~/.bash_history` are allowed
again.

Parity was checked differentially by loading the baseline guard and the
current guard in one Python process and comparing decisions on 4,379
generated marked bodies (45 wrapper/sudo/env prefixes x 59 core commands,
5 leading commands x 5 separators x 59 core commands, plus targeted edge
cases). Result on that set: 0 commands denied by the baseline were allowed.
A later independent gate (139,359 generated bodies) found one real class the
set missed: a shell option cluster containing `c` followed by a separate
`-c` (`bash -ec -c 'su -'`), where the guard inspected the second `-c`
instead of the command string. That is fixed (`inline_program` now reads all
leading options, as a shell does) and covered in
`test_denies_baseline_command_forms`. The gate's remaining baseline-deny /
current-allow cases are baseline false positives that run nothing forbidden,
such as `sudo -r su`, where `su` is the role value. The 375
commands denied now but allowed by the baseline all perform a
baseline-denied effect through a form the baseline did not reach:
`eval`, `ksh -c`, `bash -lc`, `exec`, `while ... do`, unknown `env`
options such as `-v`, attached sudo clusters such as `-nu root`, nesting
deeper than the baseline's two levels, or (one case) an unparseable marked
body, which now fails closed. That harness was a scratch check and is not
committed; the committed suite pins each gate case plus representative
parity and fail-closed cases through the real JSON hook boundary without
executing any embedded command. Rule and role obligations dropped by the
first rewrite (parent-side capability preflight, task-local packets, the
two-similar-probe stop, and UNINSPECTED/OBSERVED/PARTIAL/MISSING_EVIDENCE
tracking) are restated in new wording in `rules/harness.md`,
`rules/orchestration.md`, and `agents/excavator.md`.

## Reproduction method

Run from the repository root:

```sh
node scripts/provenance-overlap.mjs
node scripts/provenance-overlap.mjs HEAD
```

The first reads working files; the second reads committed blobs. Use a clean
checkout of the measured revision for the second command: npm's ship list
comes from that checkout's `npm pack --dry-run --json`. The script is
committed but is not itself a shipped runtime file.

Corpus: `git ls-tree -r --name-only 427544cc -- agents rules hooks AGENTS.md`,
14 baseline files, yielding 8,266 distinct eight-token runs. Each file is
lowercased, then tokenized with `/[\p{L}\p{N}_]+/gu`. Shingles never span
files. Candidate totals count every consecutive eight-token position,
including repeated occurrences; shared counts are candidate positions in
the baseline set. Percent is 100 * shared / total, displayed to three
decimal places. LICENSE is UTF-8 text and is measured normally.

At PR base the four original high-overlap files were guard 851/851
(100.000%), harness 1,782/2,068 (86.170%), Excavator 686/913 (75.137%),
and orchestration 303/1,970 (15.381%). The earlier 74.2% Excavator number
and mixed-corpus after-table are withdrawn.

## Exact output: current distributed files and workspace guide

Baseline: 427544cc39141df35918c0a6d79e6e1b4c208607; files: 14; unique runs: 8266

Candidate: workspace; packed files: 29; workspace guide: AGENTS.md

| File | Shared | Total | Percent |
|---|---:|---:|---:|
| AGENTS.md | 0 | 1291 | 0.000 |
| LICENSE | 0 | 162 | 0.000 |
| README.md | 0 | 1346 | 0.000 |
| agents/bobcat.md | 4 | 427 | 0.937 |
| agents/bulldozer.md | 1 | 825 | 0.121 |
| agents/excavator.md | 8 | 988 | 0.810 |
| agents/instinct.md | 1 | 559 | 0.179 |
| agents/jaguar.md | 9 | 433 | 2.079 |
| agents/piledriver.md | 6 | 696 | 0.862 |
| agents/puma.md | 6 | 490 | 1.224 |
| agents/steamroller.md | 0 | 745 | 0.000 |
| agents/strix-halo.md | 5 | 619 | 0.808 |
| agents/zen.md | 10 | 355 | 2.817 |
| docs/ko/README.md | 0 | 1154 | 0.000 |
| hooks.json | 0 | 29 | 0.000 |
| hooks/excavator-shell-guard.py | 0 | 1256 | 0.000 |
| hooks/zen-shell-guard.py | 1 | 648 | 0.154 |
| package.json | 0 | 127 | 0.000 |
| plugin.json | 0 | 30 | 0.000 |
| rules/harness.md | 6 | 1123 | 0.534 |
| rules/orchestration.md | 25 | 1918 | 1.303 |
| scripts/dag-view.mjs | 0 | 1393 | 0.000 |
| scripts/ledger-lock.mjs | 0 | 173 | 0.000 |
| scripts/ledger.mjs | 0 | 6110 | 0.000 |
| scripts/npm-install.mjs | 0 | 498 | 0.000 |
| scripts/ntg-vnext.mjs | 0 | 1533 | 0.000 |
| scripts/runner.mjs | 0 | 2810 | 0.000 |
| scripts/spine.mjs | 0 | 2970 | 0.000 |
| scripts/telemetry.mjs | 0 | 760 | 0.000 |
| tests/test_dag_view.mjs | 0 | 523 | 0.000 |

All 29 packed files and the current guide are below 3%; the packed maximum
is Zen at 2.817%. This statement is limited to the measured inventory,
not every text file in the repository or historical drafting export.

## Licensing decision and limits

The MIT grant, 2026 holder 이서윤, package metadata, and packed LICENSE are
retained. The measured outputs contain no substantial surviving baseline
wording; no external source was imported for this correction. The corrected
source-boundary account replaces the unsupported categorical closure claim
in contract section 8.3. No new third-party notice is asserted to be required
by these measurements.

This measures NTG's named baseline, not the external OMO/GJC/OMP projects,
which were not compared locally. Text screening cannot detect every
paraphrase or establish legal provenance by itself. In particular, rewriting
today's guide cannot undo the original worker's access to yesterday's guide.
Those limits remain part of the evidence rather than being reported as
successful historical isolation.
