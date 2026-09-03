# Architecture

Native Gravity v0.4 is an Antigravity-native role layer. It does not replace Antigravity's runtime, lifecycle, session, workspace, model-resolution, or tool systems.

## Primary modes

```text
User
├─ Bulldozer  — general Host / orchestrator
├─ Piledriver — planner
└─ Excavator  — autonomous troubleshooter / repair owner
```

The three primary agents are peers.

### Bulldozer

Bulldozer is the normal orchestration mode. It owns routing, integration, evidence inspection, review handling, and global completion. Ordinary project-source edits are delegated to internal workers.

```text
Bulldozer
├─ Bobcat
│  └─ Strix Halo
├─ Puma
├─ Jaguar
├─ Steamroller
└─ Zen
```

### Piledriver

Piledriver is plan-first and non-mutating. It produces an executable planning packet covering goal, acceptance, task graph, dependencies, risks, ownership suggestions, and verification strategy.

```text
Piledriver
├─ Jaguar  — bounded read-only discovery for planning evidence
└─ Zen     — independent final plan-readiness review
```

Jaguar is used when target identity, current state, or other material planning facts require factual discovery. Piledriver must not substitute a nearby local artifact for the requested target when authoritative identity is unverified. Zen reviews the completed planning packet; an actual current `VERDICT: GO` is required before `PLAN READY`. No implementation worker is available from Piledriver.

### Excavator

Excavator is an autonomous bounded troubleshooter. It investigates, reproduces, diagnoses, implements the root fix, and verifies the result end-to-end. Direct editing is intentional in this role.

## Internal specialists

- **Bobcat** — ordinary implementation; Flash tier; optional/required local Strix Halo gate selected by Bulldozer.
- **Puma** — quick/writing worker; Flash tier; small, explicit, low-risk mechanical work; no nested delegation.
- **Jaguar** — read-only factual discovery; Flash tier.
- **Steamroller** — read-only architecture/ambiguity/trade-off reasoning; Pro tier.
- **Strix Halo** — read-only Bobcat-local ADVISE/CHECK gate; Pro tier.
- **Zen** — independent non-mutating final review; Pro tier. Reviews delivered work for Bulldozer and plan readiness for Piledriver.

## Routing

```text
find / inspect                         -> Jaguar
small + clear + low-risk / writing   -> Puma
ordinary implementation               -> Bobcat
architecture / ambiguity / trade-off -> Steamroller
independent verification              -> Zen
plan-first workflow                   -> Piledriver primary
root-cause + autonomous repair        -> Excavator primary
```

## Why the v0.3.3 mutation hook is gone

v0.3.3 could deny Gemini 3.1 Pro file mutation because every 3.1 Pro role in that map was coordination/read-only. v0.4 assigns a Pro-tier model to Excavator, where editing is a core capability. A model-wide deny would therefore violate the role contract and is removed.

## Compatibility gate

Earlier testing found that a custom primary could fail to invoke subagents while Antigravity Default succeeded. Custom-primary delegation must therefore be validated on the current AGY version before v0.4 leaves alpha, including Bulldozer's worker graph and Piledriver's Jaguar/Zen planning graph.
