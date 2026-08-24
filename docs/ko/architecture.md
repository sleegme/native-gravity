# 아키텍처

Native Gravity v0.2는 별도의 agent runtime이 아니라 Antigravity native runtime에 얹는 작은 역할/정책 계층입니다.

```text
User
  │
  ▼
gravity-main / host model (권장: Claude Sonnet 4.6)
  │
  ├─ gravity-worker   / flash
  ├─ gravity-deep     / pro
  └─ gravity-reviewer / pro
```

## 역할과 모델을 분리한다

역할 계약은 오래 유지하고, 모델 배치는 현재 실행 정책으로 봅니다.

| 역할 | 책임 | v0.2 모델 정책 |
| --- | --- | --- |
| Main | 작업 소유·조율 | `inherit` (권장 host: Sonnet 4.6) |
| Worker | 명확하고 bounded한 작업 실행 | `flash` |
| Deep | 실행 전 불확실성 해소 | `pro` |
| Reviewer | 결과 독립 검증 | `pro` |

## Native-first 경계

Antigravity가 담당하는 것:

- agent discovery
- `invoke_subagent`
- subagent lifecycle
- workspace
- session reuse / messaging
- tool permission / sandbox
- model-tier resolution

Native Gravity가 담당하는 것:

- 역할 정의
- 위임 기준
- 서브에이전트 prompt에 전달할 task contract
- Deep escalation 기준
- review 정책

v0.2는 별도 CLI, runner, mailbox, state machine을 만들지 않습니다.

## Worker와 Research

Explore/Librarian을 별도 persona로 유지하지 않습니다. 명확한 로컬 탐색이나 외부 조사도 bounded task이면 Worker 모드로 처리하고, 불확실성을 해소해야 하는 조사라면 Deep으로 보냅니다.

## Deep

Deep의 기준은 complexity가 아니라 uncertainty입니다.

```text
파일 20개 기계적 수정 → Worker
파일 2개인데 race 원인 불명 → Deep
```

Deep은 기본적으로 read-only이며 diagnosis와 implementation guidance를 반환합니다.

## Reviewer

Reviewer는 read-only이고 blocker만 봅니다. Main이 현재 task contract, 변경 컨텍스트, 검증 evidence를 호출 시점에 전달하므로 별도 persistent review packet이 필요 없습니다.

Review는 risk-gated입니다.
