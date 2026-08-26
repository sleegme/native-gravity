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
│  └─ gravity-advisor
├─ Puma
├─ Jaguar
├─ Steamroller
└─ gravity-reviewer
```

### Piledriver

Piledriver is plan-first and read-only. It produces an executable planning packet covering goal, acceptance, task graph, dependencies, risks, ownership suggestions, and verification strategy.

### Excavator

Excavator is an autonomous bounded troubleshooter. It investigates, reproduces, diagnoses, implements the root fix, and verifies the result end-to-end. Direct editing is intentional in this role.

## Internal specialists

- **Bobcat** — ordinary implementation; Flash tier; optional/required local Advisor gate selected by Bulldozer.
- **Puma** — quick/writing worker; Flash tier; small, explicit, low-risk mechanical work; no nested delegation.
- **Jaguar** — read-only factual discovery; Flash tier.
- **Steamroller** — read-only architecture/ambiguity/trade-off reasoning; Pro tier.
- **gravity-advisor** — read-only Bobcat-local ADVISE/CHECK gate; codename TBD.
- **gravity-reviewer** — independent read-only final review; `Zen` remains only a candidate codename.

## Routing

```text
find / inspect                         -> Jaguar
small + clear + low-risk / writing   -> Puma
ordinary implementation               -> Bobcat
architecture / ambiguity / trade-off -> Steamroller
independent verification              -> Reviewer
plan-first workflow                   -> Piledriver primary
root-cause + autonomous repair        -> Excavator primary
```

## Why the v0.3.3 mutation hook is gone

v0.3.3 could deny Gemini 3.1 Pro file mutation because every 3.1 Pro role in that map was coordination/read-only. v0.4 assigns a Pro-tier model to Excavator, where editing is a core capability. A model-wide deny would therefore violate the role contract and is removed.

## Compatibility gate

Earlier testing found that a custom primary could fail to invoke subagents while Antigravity Default succeeded. Bulldozer custom-primary delegation must therefore be revalidated on the current AGY version before v0.4 leaves alpha.
