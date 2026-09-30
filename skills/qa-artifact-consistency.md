# QA Skill: Artifact Consistency

Verification discipline for generated files, mirrors, sibling copies, manifests, and package/install artifacts.

## Applicability

Applies when a change affects:
- mirrored files or dual-copy trees (e.g. root vs draft, source vs bundle)
- generated artifacts produced from templates or source specifications
- package manifests (`package.json`, etc.) and installation scripts
- published file sets and distribution targets

## Evidence surfaces

Inspect the following surfaces directly:
- Source file vs mirror / sibling file
- Template / input source vs generated output artifact
- Manifest inclusion/exclusion lists vs actual filesystem contents
- Staged package or install target directories

## Observable vs. inferable

- **Observable**: Direct byte-level comparison (`diff`, `cmp`, hash equality) or semantic AST/structure equivalence; direct bidirectional inventory of manifest entries against physical files.
- **Inferable (prohibited as verification basis)**: Assuming a sibling copy updated because the source copy was updated; assuming generated files match source because a build script ran; inferring manifest compliance from absence of packaging errors.

## Failure modes

The following conditions are defects:
- Divergent copies: differences between mirrors or sibling copies that are specified to be equivalent. Divergent copies are a **FAIL**, never an informational warning.
- Manifest drift: files listed in manifest do not exist on disk, or files required by distribution are omitted from manifest.
- Stale generated files: output artifacts lagging behind template or generator changes.
- Inconsistent metadata: version, license, or dependency mismatches across paired manifests.

## Minimum verification procedure

1. **Map pairs and dependencies**: Identify all mirror pairs, sibling replicas, generator sources, and declared manifests touched by the change.
2. **Verify equivalence**: For mirrored artifacts, execute a byte-level diff. Confirm identical content, or verify semantic equivalence if formatting divergence is explicitly permitted by contract.
3. **Audit manifests**: Verify bidirectional consistency between manifest file lists and directory contents. Confirm every declared file is present and packaged as intended.
4. **Detect divergence**: If any unplanned discrepancy or mirror drift is observed, mark as FAIL.

## PASS / FAIL / UNKNOWN reporting

- **PASS**: All mirror pairs show verified byte or semantic equivalence; manifest-to-disk correspondence is complete; generated artifacts match current sources.
- **FAIL**: Any divergence between intended mirrors, stale generated outputs, or manifest drift is detected. Report the exact divergent files and diff.
- **UNKNOWN**: A mirror target or package build environment cannot be inspected within the current workspace. Report the missing surface explicitly. Never report PASS on assumed mirror parity.

## Independent vs. self-check distinction

A generator script reporting successful output is a self-check. Independent verification requires inspecting the resulting file artifacts directly via filesystem comparison or diff utilities.

This skill does not grant new tools or permissions; verification operates strictly within the active role's existing authority.
