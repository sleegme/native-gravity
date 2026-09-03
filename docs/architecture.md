# Architecture

Native Gravity (version 0.4.0) is an Antigravity-native role layer. It does not replace Antigravity's runtime, lifecycle, session, workspace, model-resolution, or tool systems.

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
│  └─ gravity-advisor
├─ Puma
├─ Jaguar
├─ Steamroller
└─ Zen
```

### Piledriver

Piledriver is plan-first and read-only. It produces an executable planning packet covering goal, acceptance, task graph, dependencies, risks, ownership suggestions, and verification strategy.

### Excavator

Excavator is an autonomous bounded troubleshooter. It investigates, reproduces, diagnoses, implements the root fix, and verifies the result end-to-end. Direct editing is intentional in this role.

Excavator remains autonomous through diagnosis and repair, but READY is independently gated:

```text
Excavator
└─ Zen  — final completion review only
```

After local verification, Excavator invokes Zen with the original task contract, current artifact/diff context, and verification evidence. `VERDICT: NO-GO` returns repair ownership to Excavator. `VERDICT: GO` permits READY only while it remains fresh for the current artifact. A plugin `Stop` hook backstops this boundary and forces the execution loop to continue when review is missing, pending, NO-GO, or stale after a later Excavator write/marked shell call.

A genuinely verified BLOCKED result may terminate without Zen.

## Internal specialists

- **Bobcat** — ordinary implementation; Flash tier; optional/required local Advisor gate selected by Bulldozer.
- **Puma** — quick/writing worker; Flash tier; small, explicit, low-risk mechanical work; no nested delegation.
- **Jaguar** — read-only factual discovery; Flash tier.
- **Steamroller** — read-only architecture/ambiguity/trade-off reasoning; Pro tier.
- **gravity-advisor** — read-only Bobcat-local ADVISE/CHECK gate; codename TBD.
- **Zen** — shared independent read-only final review; Pro tier. It reviews Bulldozer-delivered work and serves as Excavator's completion gate.

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

Earlier testing found that a custom primary could fail to invoke subagents while Antigravity Default succeeded. Both Bulldozer's normal specialist delegation and Excavator -> Zen completion review must therefore be validated on the current AGY runtime before 0.4.0 leaves alpha.

For complete details on the non-SemVer A.B.C version progression, release maturity tiers, and host runtime compatibility matrix, see [Versioning Policy](versioning.md).
