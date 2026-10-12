# Native Gravity

[한국어](docs/ko/README.md)

Native Gravity is a small orchestration plugin for Google Antigravity. It keeps the runtime native and specializes agent roles around the behavior each model is naturally good at.

> - **Native Gravity**: 1.1.0
> - **Status**: alpha
> - **Compatibility**:
>   - AGY 1.3.3 — validated

## vNext runtime

vNext is the runtime ([#134](https://github.com/sleegme/native-gravity/issues/134)). The `ntg-vnext` runner drives multi-milestone work:

```text
User -> ntg-vnext
  Steamroller — supervisor / authoritative ledger owner
    Piledriver — bounded planning, architecture, difficult decisions / Pro
    Bulldozer  — exactly one bounded milestone / Flash
      Jaguar / Puma / Bobcat (-> Strix Halo) / Excavator
    Instinct   — alternate-framing advisory on NEEDS_ALT / Sonnet (Opus on explicit escalation)
    Zen        — independent milestone verification / Pro
```

Steamroller alone writes the ledger, promotes a milestone only after an observed matching Zen GO, and declares global completion. Instinct's NEEDS_ALT advice is recorded as advisory evidence and never auto-adopted. See [Usage](docs/usage.md#ntg-vnext-runner) for the commands.

## No natively selectable primary

No natively selectable primary remains; `ntg-vnext` is the entry for project work. Bulldozer, Piledriver and Instinct are runner-only roles: Bulldozer executes exactly one bounded milestone per invocation, Piledriver returns advisory plans to Steamroller, and Instinct returns alternate-framing advice on NEEDS_ALT. Excavator is a Bulldozer worker for difficult broken-behavior work — diagnose -> reproduce -> root-cause -> repair -> verify — with no nested delegation and no Zen invocation.

Routing is based on the kind of work:

- find/inspect -> Jaguar
- small + clear + low-risk / writing -> Puma
- ordinary implementation -> Bobcat (-> Strix Halo)
- hard broken-behavior diagnosis/repair -> Excavator (Bulldozer worker)
- planning / architecture / trade-off -> Piledriver (via Steamroller under the runner)
- stalled same-class failures / a different framing -> Instinct (NEEDS_ALT, via Steamroller under the runner)
- independent verification -> Zen

Roles fit the behavior each model is naturally good at; correction is added only where a specific role/model pairing actually fails. Excavator is intentionally an editing role, so there is no model-wide mutation deny.

## Native-first boundary

Native Gravity does not ship a replacement runtime. The npm entrypoint is installation-only: it locates the packaged plugin directory and delegates installation back to `agy plugin install`. It does not intercept or wrap Antigravity runtime execution. Antigravity owns primary/subagent execution, lifecycle, sessions, workspaces, model resolution, and tool permissions. Native Gravity supplies role contracts, routing policy, and model-adaptive behavioral guidance. It does not replace Antigravity runtime behavior. The vNext runner (`ntg-vnext`) is a narrow exact-model coordinator over `agy` that owns only the authoritative ledger, milestone sequencing and the independent Zen gate; it is not a general workflow platform.

## Ledger ownership

For multi-milestone work, `ntg-vnext` holds an exclusive `ledger.json.lock` for the lifetime of the session through `MinimalSpine`. The spine acquires the lock before creating or loading the ledger, and holds it until `close()` or process exit. Close the previous spine before resuming in another instance; a closed spine cannot mutate state, and a busy spine cannot be closed.

The lock is created with `openSync(..., 'wx')` (exclusive creation) and contains
the owner's decimal PID followed by a newline. An existing lock always refuses
startup with `LEDGER_LOCKED`, even if its PID appears dead or its contents are
empty. Normal exit, SIGINT, and SIGTERM release ownership. SIGKILL, a crash, or
a machine shutdown may leave a stale lock: `ntg-vnext recover` removes it only
after verifying the recorded owner PID is no longer alive and terminating that
owner's orphaned executors — never remove a live owner's lock. Lock recovery
does not resolve an interrupted ledger milestone: resume still requires
observed interruption evidence. All writers must use the same ledger path and
ownership protocol; low-level `AuthoritativeLedger.load()` / `save()` remain
persistence primitives, not independent session owners.

## Google AI Studio lane

`scripts/studio-runner.mjs` provides a second execution profile for A/B
comparison: the same role + packet goes through the bounded prompt contract,
then a direct `generateContent` REST call instead of `agy`.

```js
import { invokeStudio } from './scripts/studio-runner.mjs';
const result = await invokeStudio('steamroller', packet, {
  model: 'gemini-3.1-pro-high',
  generationConfig: { temperature: 0.2 },
});
```

Set `GOOGLE_AI_STUDIO_API_KEY` (or `GOOGLE_API_KEY`) in the environment — the
key goes only to Google in the request URL and is never written to results,
errors, or ledger state. Results carry `provider: 'google-ai-studio'`, the
model id, and token `usage` so comparisons stay attributable by
model + provider + settings. This lane has no tools, subagents, or ledger
authority; it answers "is this the model or the harness?", not "run the
orchestration".

## Alpha compatibility gate

An older Native Gravity test found that a custom primary could fail to invoke subagents while the Antigravity Default agent succeeded. On AGY 1.3.3, a clean install validates the runner's end-to-end milestone flow (Steamroller -> Piledriver -> Bulldozer -> Zen) and specialist delegation (Bulldozer -> Jaguar / Puma / Bobcat, including the nested Bobcat -> Strix Halo gate) in live probe sessions. Revalidate this compatibility gate when the AGY runtime changes. See [Versioning Policy](docs/versioning.md) for versioning details and the compatibility matrix.

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

For upgrade testing, use a clean reinstall so removed legacy agent and hook files do not remain staged.
