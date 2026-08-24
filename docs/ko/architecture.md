# 아키텍처

Native Gravity v0.2.1은 별도의 agent runtime이 아니라 Antigravity native runtime에 얹는 작은 orchestration policy 계층입니다.

```text
User
  │
  ▼
Antigravity Default agent / host model
(권장: Claude Sonnet 4.6)
  + rules/orchestration.md
  │
  ├─ gravity-worker   / flash
  ├─ gravity-deep     / pro
  └─ gravity-reviewer / pro
```

## Host와 subagent 역할을 분리한다

Primary coordinator는 Antigravity Default agent입니다. Native Gravity는 host가 따라야 할 policy와 세 개의 전문 subagent contract만 정의합니다.

| 구성 | 책임 | v0.2.1 모델 정책 |
| --- | --- | --- |
| Host | 작업 소유·조율 | 현재 Antigravity session model, Sonnet 4.6 권장 |
| Worker | 명확하고 bounded한 작업 실행 | `flash` |
| Deep | 실행 전 불확실성 해소 | `pro` |
| Reviewer | 결과 독립 검증 | `pro` |

## 왜 gravity-main을 제거했나

v0.2 bootstrap에서 `gravity-main`을 custom primary로 선택한 상태에서는 다음 `invoke_subagent` 호출이 모두 실패했습니다.

- plugin `gravity-deep`
- plugin `gravity-worker`
- workspace custom `gravity-worker-test`
- built-in `research`

관측된 오류는 `subagent "<name>" not found or not allowed to be invoked`였습니다. 반면 같은 환경의 Default agent에서는 built-in `research` 호출이 성공했습니다.

이 결과만으로 내부 원인이 discovery인지 authorization인지 확정할 수 없고, custom primary delegation이 의도적으로 막혀 있다고 단정할 수도 없습니다. v0.2.1은 issue #3의 추가 검증 전까지 native primary를 그대로 사용하는 방향으로 단순화합니다.

## Native-first 경계

Antigravity가 담당하는 것:

- primary agent
- agent discovery
- `invoke_subagent`
- subagent lifecycle
- workspace
- session reuse / messaging
- tool permission / sandbox
- model-tier resolution
- plugin rule loading

Native Gravity가 담당하는 것:

- orchestration/routing rule
- 전문 subagent 역할 정의
- 서브에이전트 prompt에 전달할 task contract
- Deep escalation 기준
- review 정책

## Host policy

기존 Main의 행동은 `rules/orchestration.md`로 이동합니다. Host는 필요한 최소한의 orchestration만 선택하고, trivial하거나 integration-sensitive한 작업은 직접 처리할 수 있습니다.

서브에이전트 호출 시 `ROLE_REASON`, `GOAL`, `SCOPE`, `NON_GOALS`, `ACCEPTANCE`, `EVIDENCE`, `EDIT_POLICY`, `EXPECTED_OUTPUT`을 명시합니다.

## Worker

Worker는 명확한 구현, 반복 수정, focused discovery/research를 수행합니다. 종료 시 `DONE`, `BLOCKED`, `NEEDS_DEEP` 중 하나를 반환합니다.

## Deep

Deep의 기준은 complexity가 아니라 uncertainty입니다.

```text
파일 20개 기계적 수정 → Worker
파일 2개인데 race 원인 불명 → Deep
```

Deep은 read-only이며 diagnosis와 concrete implementation contract를 반환합니다. 실제 실행은 host 또는 Worker가 담당합니다.

## Reviewer

Reviewer는 read-only이고 blocker만 봅니다. Host가 task goal/scope, acceptance criteria, 변경 컨텍스트, verification evidence를 호출 시점에 전달합니다.

Review는 risk-gated입니다.
