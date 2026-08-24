# Native Gravity

Google Antigravity 위에 얹는 작은 orchestration 플러그인입니다. OMO 계열의 역할 분리 철학은 가져오되, 런타임을 다시 만들지 않고 Antigravity native 기능을 최대한 그대로 사용합니다.

> 현재 상태: **v0.2.1 / experimental**

## 핵심 구조

```text
User
  │
  ▼
Antigravity Default agent
(권장 host model: Claude Sonnet 4.6)
  + Native Gravity orchestration rule
  │
  ├─ Worker   → AGY Flash tier
  ├─ Deep     → AGY Pro tier
  └─ Reviewer → AGY Pro tier
```

v0.2.1에서는 Native Gravity가 primary agent를 교체하지 않습니다. Antigravity의 Default agent를 그대로 host로 사용하고, plugin rule과 세 개의 전문 subagent만 제공합니다.

- **Worker** — 범위가 명확하고 독립적으로 수행 가능한 작업을 처리하는 실행 에이전트
- **Deep** — 원인·요구사항·해법이 불명확한 문제를 분석해 무엇을 해야 하는지 결정하는 진단 에이전트
- **Reviewer** — 구현 결과가 요구사항과 품질 기준을 만족하는지 독립적으로 검증하는 검수 에이전트

서브에이전트는 exact model slug를 강제로 고정하지 않고 AGY의 `flash` / `pro` tier를 사용합니다.

## 왜 Default agent가 host인가

v0.2 bootstrap 검증에서 `gravity-main`을 custom primary agent로 선택했을 때 `invoke_subagent`가 plugin agent, workspace custom agent, built-in `research` 모두를 거부했습니다. 같은 환경의 Default agent에서는 built-in `research` 호출이 성공했습니다.

그래서 v0.2.1은 기존 Main의 행동을 `rules/orchestration.md`로 옮기고 Antigravity native primary를 그대로 사용합니다. 이것은 관측된 runtime 동작에 대한 compatibility 결정이지, custom primary delegation이 의도적으로 금지됐다는 뜻은 아닙니다.

## 설치

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin install .
```

Antigravity의 **Default agent**를 사용합니다. 권장 host/session model은 Claude Sonnet 4.6입니다.

## 라우팅

```text
명확하고 bounded한 실행
→ Worker

원인 불명 / 요구사항 모호 / 설계 trade-off
→ Deep

실질적이거나 위험한 구현의 독립 검증
→ Reviewer
```

Deep은 단순히 "어려운 작업" 담당이 아닙니다. 작업량보다 **불확실성, diagnosis, trade-off**가 기준입니다.

Review는 모든 사소한 변경에 강제하지 않고 risk-gated로 사용합니다.

## v0.2.1에서 하지 않는 것

- custom primary/Main agent
- 별도 task/runtime engine
- shell wrapper CLI
- persistent coordination state
- Explore/Librarian 별도 agent
- quota-aware routing
- exact Opus subagent pinning
- AI Studio direct execution

AI Studio 직접 호출은 v0.3 이슈에서 다룹니다.
