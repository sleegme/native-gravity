# Native Gravity

[한국어](docs/ko/README.md)

Native Gravity is a small orchestration plugin for Google Antigravity. It keeps the runtime native and specializes agent roles around the behavior each model is naturally good at.

> Status: **v0.4 alpha / architecture validation**

## v0.4 primary modes

```text
User
├─ Bulldozer  — general Host / orchestrator
├─ Piledriver — planner
└─ Excavator  — autonomous troubleshooter / repair owner
```

The three primary agents are peers. Piledriver and Excavator are not children of Bulldozer.

## Bulldozer internal team

```text
Bulldozer
├─ Bobcat      — ordinary implementation / Flash
│  └─ Advisor  — local advice + CHECK gate / Pro
├─ Puma        — quick + writing / Flash
├─ Jaguar      — codebase exploration / Flash
├─ Steamroller — deep decisions / Pro
└─ Reviewer    — independent final review / Pro
```

Routing is based on the kind of work:

- find/inspect -> Jaguar
- small + clear + low-risk / writing -> Puma
- ordinary implementation -> Bobcat
- architecture / ambiguity / trade-off -> Steamroller
- independent verification -> Reviewer

Piledriver is for users who want a plan-first workflow. Excavator is for users who want one autonomous agent to dig into a difficult failure, find root cause, repair it, and verify the bounded result end-to-end.

## Why v0.4 changes direction

v0.3 experiments showed that forcing every model into the same Host behavior can add more harness weight than value. v0.4 instead assigns roles that fit observed model tendencies and adds correction only where a specific role/model pairing actually fails.

That also invalidates the v0.3.3 global Gemini 3.1 Pro mutation deny: Excavator is intentionally an editing role, so the model-wide hook is removed in v0.4.

## Native-first boundary

Native Gravity does not ship a replacement runtime or wrapper CLI. Antigravity owns primary/subagent execution, lifecycle, sessions, workspaces, model resolution, and tool permissions. Native Gravity supplies role contracts, routing policy, and model-adaptive behavioral guidance.

## Alpha compatibility gate

An older Native Gravity test found that a custom primary could fail to invoke subagents while the Antigravity Default agent succeeded. Therefore Bulldozer's custom-primary delegation must be revalidated on the current AGY version before v0.4 is considered stable.

## Install for testing

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
git switch feat/v0.4-construction-primary-agents
agy plugin uninstall native-gravity
agy plugin install .
```

For upgrade testing, use a clean reinstall so removed v0.3 agent/hook files do not remain staged.
