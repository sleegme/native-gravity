# QA Skill: Computed Outputs and Cross-References

Verification discipline for formulas, computed values, references, links, IDs, and cross-file references.

## Applicability

Applies when an artifact contains:
- mathematical or algorithmic formulas, computed values, totals, or derived metrics
- cross-file references, intra-document anchors, or machine-readable IDs
- URIs, citations, source anchors, or symbol references

## Evidence surfaces

Inspect the following surfaces directly:
- Authoritative input values and calculation specifications
- Computed outputs rendered in the candidate artifact
- Target files, anchor lines, symbol definitions, or endpoints referenced by links, IDs, or citations
- Tool or command output from independent calculation or reference resolution utilities

## Observable vs. inferable

- **Observable**: Recomputing the output using an independent evaluation mechanism and observing matching values; resolving each link/ID to its target line and observing that the target entity exists and matches the reference contract.
- **Inferable (prohibited as verification basis)**: Inferring a calculation is correct because the code executed without exceptions; assuming a cross-reference resolves because the target file exists; inferring ID consistency from naming patterns.

## Failure modes

The following conditions are defects:
- Calculation drift: output value diverges from independent recomputation.
- Stale reference: reference points to a moved, renamed, deprecated, or deleted target. Stale references are a **FAIL**, never an informational warning.
- Dangling target: referenced anchor, symbol, or ID does not exist in the target artifact.
- Ambiguity: reference matches multiple contradictory targets.
- Precision/rounding mismatch against authoritative specification.

## Minimum verification procedure

1. **Enumerate**: Identify all computed outputs and reference tokens within the change scope.
2. **Recompute independently**: Recalculate each formula output from raw inputs using an independent calculation path (e.g. separate script, external utility, or manual arithmetic). Do not reuse the candidate implementation to verify itself.
3. **Resolve all references**: For every link, citation, anchor, or ID, inspect the target surface to confirm the target exists, is current, and resolves unambiguously.
4. **Enforce failure semantics**: If any stale or dangling reference is found, mark as FAIL. Do not downgrade to a warning or proceed with stale pointers.

## PASS / FAIL / UNKNOWN reporting

- **PASS**: Every computed output is verified against independent recomputation; 100% of reference targets exist and resolve correctly; zero stale references.
- **FAIL**: Any formula discrepancy, dangling link, or stale reference is observed. Report exact token, expected target/value, and observed mismatch.
- **UNKNOWN**: Target surface or raw inputs reside outside inspectable scope. Report the specific uninspected reference or output as an unresolved evidence gap. Never report PASS over unverified references.

## Independent vs. self-check distinction

A verification check written within the same module or script that generates the output is a self-check. Self-checks provide preliminary evidence but do not satisfy independent verification. Independent verification requires evaluation by an external tool, decoupled script, or separate review role (e.g. Zen).

This skill does not grant new tools or permissions; verification operates strictly within the active role's existing authority.
