# Native Gravity

Google Antigravity 위에 얹는 작은 orchestration 플러그인입니다. OMO 계열의 역할 분리 철학은 가져오되, 런타임을 다시 만들지 않고 Antigravity native 기능을 최대한 그대로 사용합니다.

> 현재 상태: **v0.2 / experimental**

## 핵심 구조

```text
User
  │
  ▼
Claude Sonnet 4.6
Gravity Main
  │
  ├─ Worker   → AGY Flash tier
  ├─ Deep     → AGY Pro tier
  └─ Reviewer → AGY Pro tier
```

역할은 네 개만 둡니다.

- **Main** — 사용자 목표를 받아 전체 작업을 주도하고 실행·위임·통합을 책임지는 기본 에이전트
- **Worker** — 범위가 명확하고 독립적으로 수행 가능한 작업을 빠르게 처리하는 실행 에이전트
- **Deep** — 원인·요구사항·해법이 불명확한 문제를 분석해 무엇을 해야 하는지 결정하는 추론 에이전트
- **Reviewer** — 구현 결과가 요구사항과 품질 기준을 만족하는지 독립적으로 검증하는 검수 에이전트

`gravity-main`은 `model: inherit`을 사용합니다. v0.2 권장 구성에서는 상위 세션 모델로 Claude Sonnet 4.6을 선택합니다. 서브에이전트는 exact model slug를 강제로 고정하지 않고 AGY의 `flash` / `pro` tier를 사용합니다.

## 왜 plugin-only인가

Antigravity가 이미 custom agent, `invoke_subagent`, lifecycle, session reuse, workspace, permission, monitoring을 제공합니다. Native Gravity가 같은 런타임을 다시 만들 이유가 없습니다.

```text
Native Gravity
= 역할 + 위임 정책 + 프롬프트 계약

Antigravity
= 실행 런타임 + 세션 + 모델 tier + 서브에이전트 lifecycle
```

그래서 v0.2에서는 별도 shell CLI, review packet builder, persistent coordination state를 제거했습니다.

## 설치

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin install .
```

Antigravity의 `/agents`에서 `gravity-main`을 선택하면 됩니다.

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

## v0.2에서 하지 않는 것

- 별도 task/runtime engine
- shell wrapper CLI
- persistent coordination state
- Explore/Librarian 별도 agent
- 거대한 category/persona matrix
- quota-aware routing
- exact Opus subagent pinning
- AI Studio direct execution

AI Studio 직접 호출은 v0.3 이슈에서 다룹니다.
