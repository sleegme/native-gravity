# One-shot token measurement: NTG vs AGY default agent (2026-11-02)

Single-sample, end-to-end measurement behind the README token statement. Base commit `12b5fb8` for both arms; identical frozen task contract (issue #191: ship `/ntg` entry point — skill, packaged launcher, focused tests, npm packaging, EN/KO usage docs). No retries or re-freezes; both arms ran once, unattended.

## Method

- Token counts are per-step sums of `input_tokens`, `cache_read_tokens` and `output_tokens` over every model response row in each session transcript, including all child sessions.
- Child sessions are attributed by the parent's `manage_subagents` listings and `invoke_subagent` prompts; every new session created during each arm's window is included, none excluded.
- CLI envelope totals are cumulative per conversation and were used only as cross-checks, never added to the sums. The two top-level NTG envelopes and the AGY envelope matched their per-step sums exactly.
- Accounting gap list (missing/invalid usage fields, duplicate planner rows, unmatched envelopes): empty for both arms.

## Results

| Arm | Sessions | Input | Cache read | Output | Total | Elapsed | Outcome |
|---|---|---|---|---|---|---|---|
| NTG pipeline (Bulldozer, Puma, Bobcat, Strix Halo, Zen) | 5 | 746,766 | 15,432,025 | 105,697 | 16,284,488 | 17m07s | first-shot completion, Zen GO |
| AGY default agent (`gemini-3.8-flash-high`) | 1 | 195,152 | 3,750,356 | 50,241 | 3,995,749 | 10m42s | completed |

NTG used 4.08x the baseline total tokens: **no whole-task token saving on this sample.** The dominant cost was the Bulldozer coordinator session: 12,588,483 tokens (77.3% of the NTG total; 12,153,012 cache reads across 144 turns of growing context).

Per-session NTG detail:

| Session | Role | Calls | Input | Cache read | Output | Total |
|---|---|---|---|---|---|---|
| Bulldozer | milestone coordinator | 144 | 397,809 | 12,153,012 | 37,662 | 12,588,483 |
| Puma | implementer (small edits) | 36 | 109,922 | 1,231,293 | 16,536 | 1,357,751 |
| Bobcat | implementer | 38 | 133,411 | 1,715,309 | 39,689 | 1,888,409 |
| Strix Halo | read-only advisor (via Bobcat) | 7 | 50,941 | 105,149 | 5,980 | 162,070 |
| Zen | independent gate | 7 | 54,683 | 227,262 | 5,830 | 287,775 |

## Conditions and caveats

- Models: NTG workers on Gemini 3.8 Flash (High); Zen on `gemini-4-argon-high` because the documented Claude Opus quota was exhausted during the window. The AGY control ran `gemini-3.8-flash-high`, matching the Bulldozer tier.
- Both arms changed exactly the bounded six-file scope and passed verification (focused tests, `agy plugin validate`, `npm pack --dry-run`).
- Single sample; no variance estimate. The README presents the initial-call ~31% input reduction and this whole-task result as separate facts.
- Raw transcripts and per-arm accounting JSON are retained outside the repository (benchmark cache directory `ntg-oneshot-20261102`).
