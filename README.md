# Native Gravity

[한국어](docs/ko/README.md)

Native Gravity is a small orchestration plugin for Google Antigravity. It keeps the runtime native and specializes agent roles around the behavior each model is naturally good at.

> - **Native Gravity**: 0.4.0
> - **Status**: alpha
> - **Compatibility**:
>   - AGY 1.1.21 — validated
>   - AGY 1.1.24 — validated

## Primary modes

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
│  └─ Strix Halo — local advice + CHECK gate / Pro
├─ Puma        — quick + writing / Flash
├─ Jaguar      — codebase exploration / Flash
├─ Steamroller — deep decisions / Pro
└─ Zen         — independent final review / Pro
```

Routing is based on the kind of work:

- find/inspect -> Jaguar
- small + clear + low-risk / writing -> Puma
- ordinary implementation -> Bobcat
- architecture / ambiguity / trade-off -> Steamroller
- independent verification -> Zen

Piledriver is for users who want a plan-first workflow. Excavator is for users who want one autonomous agent to dig into a difficult failure, find root cause, repair it, and verify the bounded result end-to-end.

## Why v0.4 changes direction

v0.3 experiments showed that forcing every model into the same Host behavior can add more harness weight than value. v0.4 instead assigns roles that fit observed model tendencies and adds correction only where a specific role/model pairing actually fails.

That also invalidates the v0.3.3 global Gemini 3.1 Pro mutation deny: Excavator is intentionally an editing role, so the model-wide hook is removed in v0.4.

## Native-first boundary

Native Gravity does not ship a replacement runtime. The npm entrypoint is installation-only: it locates the packaged plugin directory and delegates installation back to `agy plugin install`. It does not intercept or wrap Antigravity runtime execution. Antigravity owns primary/subagent execution, lifecycle, sessions, workspaces, model resolution, and tool permissions. Native Gravity supplies role contracts, routing policy, model-adaptive behavioral guidance, and `ntg-run` — a thin invocation helper that only prepends the `NTG_ROLE` attribution marker to gated-role prompts so the review gate can see which role ran under AGY 1.2.x. It does not replace or wrap runtime behavior.

## Alpha compatibility gate

An older Native Gravity test found that a custom primary could fail to invoke subagents while the Antigravity Default agent succeeded. On AGY 1.1.21 and AGY 1.1.24, a clean install validates Bulldozer's internal delegation and the nested Bulldozer -> Bobcat -> Strix Halo gate. Revalidate this compatibility gate when the AGY runtime changes. See [Versioning Policy](docs/versioning.md) for versioning details and the compatibility matrix.

## Install

### npm

Requires Node.js 18+ and Antigravity CLI (`agy`) on `PATH`.

```bash
npm install -g native-gravity
native-gravity
```

Or without global install:

```bash
npx native-gravity
```

For clean upgrade/reinstall:

```bash
npx native-gravity reinstall
# or
npx native-gravity update
```

The npm package is strictly a distribution helper that runs Antigravity's native plugin installer against the packaged directory.

### Git checkout

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin uninstall native-gravity
agy plugin install .
```

For upgrade testing, use a clean reinstall so removed v0.3 agent/hook files do not remain staged.
