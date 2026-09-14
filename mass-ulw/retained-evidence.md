# Retained evidence — clean-room provenance + integration proof

Consolidated after the /tmp wipe (session restart destroyed /tmp/ntg-44e-cleanroom, /tmp/ntg-44f-cleanroom, /tmp/ntg-44d-integration). This file preserves the durable record.

## 1. Branch rebuild sequence (git reflog, captured 2026-09-13)

native-gravity-44e, branch feat/issue-44e-minimal-spine:
```
d7e35e4 @{0}: commit: feat(44E): minimal spine integration (#44E)
95b64ad @{1}: reset: moving to origin/main
e29ec49 @{2}: commit: fix(44E): resolve review blockers ... (#51)   <- contaminated, abandoned
2eb9860 @{3}: commit: feat(44E): minimal spine integration (#44E)   <- contaminated, abandoned
95b64ad @{4}: branch: Created from origin/main
```
Proves: branch was reset to origin/main (95b64ad) then received exactly one new commit d7e35e4. Contaminated commits remain in reflog but are unreachable from HEAD (merge-base --is-ancestor exits 1 for both).

native-gravity-44f, branch feat/issue-44f-specialists:
```
e3171b9 @{0}: commit: feat(44F): re-author specialist reconnection from frozen contracts (#44F-a)
95b64ad @{1}: reset: moving to origin/main
9b97f0d @{2}: commit: fix(44F): restore frontmatter runtime boundaries ... <- contaminated, abandoned
4658402 @{3}: commit: feat(44F): prepare clean-room specialist reconnection ... <- contaminated, abandoned
95b64ad @{4}: branch: Created from origin/main
```
Same shape: reset to origin/main then one clean commit e3171b9.

Force-with-lease: attested by lane reports (lane-44e.txt: "PR #51 rebuilt and force-with-lease pushed"; lane-44f.txt: "force-with-lease push succeeded") and consistent with reflog + remote heads matching local HEADs exactly. The lease flag itself is not separately provable post-hoc; the observable contract (remote head == new clean commit, old commits unreachable) is proven by gh pr view + merge-base checks.

## 2. Clean-room byte-identity (verifier-attested, sha256)

verify-44e.txt: "Cleanroom has all seven authored files, byte-identical to branch copies (matching SHA-256s)."
verify-44f.txt: "cleanroom contains all three authored files, each byte-identical to branch versions."

Current branch file sha256 (re-captured 2026-09-13, matches what verifiers compared):
- 44e: agents/bobcat.md 7bae4224..., agents/zen.md 45b96ca1..., hooks/zen-shell-guard.py c5e6660a..., hooks.json 718b68fb..., scripts/spine.mjs b0580dc4..., tests/test_spine.mjs f6f7142c..., tests/test_zen_shell_guard.py 4c87dbaf...
- 44f: agents/jaguar.md b99bd804..., agents/puma.md 229af44a..., agents/strix-halo.md 598d9c10...

Lead session transcript (pre-wipe) captured the cleanroom trees: /tmp/ntg-44e-cleanroom contained agents/, hooks/, scripts/, tests/, hooks.json, REPORT.md, evidence/ (incl. authored-sha256.txt, live-hook-transcript.txt, rebuilt-plugin-validation.txt); /tmp/ntg-44f-cleanroom contained agents/{jaguar,puma,strix-halo}.md + report.md.

## 3. Integration proof (44D)

Verifier artifact verify-44d.txt: all 7 checks PASS, VERDICT: GO. Its retained session JSONL (.omo/senpi-task/children/st_01a094c6/.../*.jsonl) contains the executed commands and outputs: per-role "explicit-<role>=PASS body_and_handoff_and_invoke", "neutral-<role>=PASS body_injected", missing-body ROLE_BODY_MISSING, and the combined-tree test run "Summary: 33 passed, 0 failed".

Lead first-hand re-proof in rebuilt /tmp/ntg-44d-verify (44B head 121c793 + PR-#53 six-file overlay, bodies sha256-identical to 0497195 blobs):
- steamroller/piledriver/bulldozer: "## Role Body" present + handoff sections (## Task/## Constraints/## Evidence) present; identical from neutral mktemp cwd.
- missing body -> ROLE_BODY_MISSING; non-allowlisted role -> UNRESOLVED_MODEL_SLUG.
- test_runner_spike.mjs 33/33 in combined tree.

Gate reviewer's independent write-free re-proof (gate-review.md, CURRENT output): byte-identical file comparisons vs both pinned commits, full-body+handoff assertions per role, /proc neutral-cwd equality, pre-transport structured failures — "READ_ONLY_INTEGRATION_PROOF=PASS".

Corrected body lengths (trimmed, per reviewer measurement): steamroller 5054ch, piledriver 2937ch, bulldozer 3796ch.

## 4. verify-44d scope note

The verify-44d prompt was internally inconsistent: it forbade creating anything while also requiring a mktemp-based proof. The verifier created a temp dir + stub agy.mjs (deleted on exit) — a literal scope violation, no repo impact. Resolution: the gate reviewer's strictly write-free re-proof (above) is the compliant independent verification record; the verifier's PASS results were additionally corroborated by the lead's own re-run. Process defect noted; no code impact.
