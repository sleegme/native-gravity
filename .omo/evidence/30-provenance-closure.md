# #30 / #34 provenance closure

Date: 2026-10-13. Base: main 0936cb2. Provenance-uncertain baseline: commit `427544cc` (pre-vNext NTG `agents/`, `rules/`, `hooks/`, `AGENTS.md`), as named in contract §8.3.

## Why a closure step was needed

- #33 closed with "license transition remains blocked until the vNext clean implementation and provenance review are complete".
- `.omo/evidence/2026-10-02-44g-findings.md` records provenance closure as **not established**.
- Contract §8.3 had been reworded in #139 to "Slice 44G confirmed ..."; no audit supported that sentence. It is corrected in this change.

## Measurement method

Shared 8-word shingles: every shipped text file is lowercased, split into word tokens, and each run of 8 consecutive tokens is compared against the set of all 8-token runs in the baseline surfaces above. "Shared" counts how many of the file's runs also occur in the baseline.

Before this change (main 0936cb2), four shipped files carried substantial baseline text:

| File | Shared runs, % of file |
| --- | --- |
| `hooks/excavator-shell-guard.py` | 100% |
| `rules/harness.md` | 86.2% |
| `agents/excavator.md` | 74.2% |
| `rules/orchestration.md` | 15.4% |

All other shipped agent/hook files were 0–2.8%.

## Clean-room re-authoring

- Worker: Command Code, model `xiaomi/mimo-v2.6-pro` (session evidence in the lead's cache, not committed).
- Workspace: a `git archive` export of 0936cb2 **without** `.git`, without `.omo/`, and with the four files deleted. Every remaining text file in that workspace was measured first: none had ≥20 shared runs or ≥3%.
- Allowed sources: the files in that workspace (contract, `AGENTS.md`, other role files, tests, scripts) and general knowledge. Forbidden: git history, other checkouts, installed plugins, web lookups of Native Gravity, OMO/GJC/OMP source.
- Audit of the worker's 45 tool calls: no access to `/home/<user>/work`, git history, the installed plugin, the baseline commit or GitHub.
- `tests/test_excavator_shell_guard.py` was kept unchanged as the behavioral contract for the guard and passes.
- Lead adjustment after the run: restored the AGY rules key `trigger: always_on` in both rule files' frontmatter (a platform setting, not prose; the worker had recorded the rules frontmatter shape as a SPEC GAP).

## Result: every distributed file (npm tarball contents)

| File | Shared runs | % of file |
| --- | --- | --- |
| `LICENSE` | non-text | - |
| `README.md` | 0 | 0% |
| `agents/bobcat.md` | 4 | 0.9% |
| `agents/bulldozer.md` | 0 | 0% |
| `agents/excavator.md` | 7 | 0.9% |
| `agents/instinct.md` | 1 | 0.2% |
| `agents/jaguar.md` | 9 | 2.1% |
| `agents/piledriver.md` | 6 | 0.9% |
| `agents/puma.md` | 6 | 1.2% |
| `agents/steamroller.md` | 0 | 0% |
| `agents/strix-halo.md` | 5 | 0.8% |
| `agents/zen.md` | 10 | 2.8% |
| `docs/ko/README.md` | 0 | 0% |
| `hooks.json` | 0 | 0% |
| `hooks/excavator-shell-guard.py` | 6 | 0.6% |
| `hooks/zen-shell-guard.py` | 1 | 0.2% |
| `package.json` | 0 | 0% |
| `plugin.json` | 0 | 0% |
| `rules/harness.md` | 3 | 0.3% |
| `rules/orchestration.md` | 2 | 0.1% |
| `scripts/dag-view.mjs` | 0 | 0% |
| `scripts/ledger-lock.mjs` | 0 | 0% |
| `scripts/ledger.mjs` | 0 | 0% |
| `scripts/npm-install.mjs` | 0 | 0% |
| `scripts/ntg-vnext.mjs` | 0 | 0% |
| `scripts/runner.mjs` | 0 | 0% |
| `scripts/spine.mjs` | 0 | 0% |
| `scripts/telemetry.mjs` | 0 | 0% |
| `tests/test_dag_view.mjs` | 0 | 0% |

Residual matches (≤2.8%) are short generic phrases such as role names, tool lists and field names that the vNext contract itself defines.

## Decision

No third-party-derived material is known to remain in the distributed artifact, and no remaining file carries substantial baseline text. NTG-owned material is licensed MIT: root `LICENSE`, `"license": "MIT"` in `package.json`, and `LICENSE` added to the npm `files` list. `THIRD_PARTY_NOTICES.md` is not created because nothing requires it.

## Limits

- The measurement compares against NTG's own provenance-uncertain baseline. The external harnesses named in #30 (OMO/GJC/OMP) are not available locally; for them the control is the clean-room procedure (prohibited source list, history-free workspace, tool-call audit), not text comparison.
- Shingle overlap detects copied wording, not paraphrase. The clean-room procedure is the primary control against paraphrased derivation.
