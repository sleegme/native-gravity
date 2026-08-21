# 아키텍처

oh-my-agy는 Antigravity 위에 별도의 거대한 런타임을 다시 만드는 대신, native custom agent와 subagent 기능을 최대한 그대로 사용합니다.

```text
User
  │
  ▼
oma-main / Claude Sonnet 4.6
  │
  ├─ task contract 작성
  ├─ category 선택
  ├─ worker dispatch
  │
  ├─ oma-implementation-flash / Gemini Flash
  │    └─ quick, unspecified-low, 일반 구현, 가벼운 writing
  │
  ├─ oma-implementation-pro / Gemini Pro
  │    └─ deep, ultrabrain, visual-engineering,
  │       artistry, unspecified-high, architect
  │
  ├─ oma-explore / Gemini Flash
  ├─ oma-librarian / Gemini Flash
  │
  └─ implementation evidence
       │
       ▼
    review packet
       │
       ├─ primary: Claude Opus 4.6 + oma-review
       └─ fallback: Gemini Pro + oma-review
```

## 네 축을 분리한다

OMA는 다음 네 가지를 같은 것으로 취급하지 않습니다.

- **Role**: coordinator, implementation, review, research처럼 에이전트가 맡는 책임
- **Category**: `deep`, `quick`, `ultrabrain`처럼 해당 작업을 어떤 방식으로 처리할지 정하는 행동 모드
- **Model**: 실제 작업을 수행하는 모델 또는 AGY model tier
- **Reasoning**: 모델의 reasoning/effort 수준과 해당 category에서 요구하는 사고 깊이

예를 들어 `deep`과 `ultrabrain`은 둘 다 Gemini Pro를 사용할 수 있지만 같은 작업이 아닙니다. `deep`은 넓은 탐색과 root-cause 추적, 완전한 delivery에 가깝고 `ultrabrain`은 어려운 논리, 설계, trade-off 판단에 더 가깝습니다.

## Main은 얇게 유지한다

`oma-main`의 주 역할은 사용자 요청 해석, task contract 생성, category 선택, worker 위임, evidence 수집, review gate 판단입니다. 실질적인 source edit은 implementation worker가 담당합니다.

## Task contract

Main은 substantive 작업 전에 `.oma/task-contract.md`를 만듭니다.

```text
Goal
Scope
Non-goals
Acceptance criteria
Verification expected
Selected category
```

이 contract는 구현 중 임의로 바뀌지 않는 것을 원칙으로 합니다.

## Evidence 기반 완료

Worker의 `done` 발언만으로 완료 처리하지 않습니다. 가능한 경우 실제 변경 파일, diff, targeted test, build/typecheck/lint, runtime 확인, 남은 risk/blocker를 evidence로 남깁니다.

`.oma/implementation-evidence.md`에 worker 결과를 보존하고, `oma packet`이 이를 current diff/task contract와 함께 `.oma/review-packet.md`로 묶습니다.

## Review gate

기본 reviewer는 Claude Opus 4.6이며 acceptance criteria, correctness, regression, 위험한 삭제/scope expansion, public contract, 검증 부족, evidence와 실제 코드의 모순을 blocker 관점에서 확인합니다.

최종 출력은 `VERDICT: GO` 또는 `VERDICT: NO-GO`입니다. NO-GO인 경우 concrete blocker만 기존 implementation session으로 돌려보내는 것이 기본입니다.

## 상태 envelope

`.oma/` 디렉터리는 로컬 coordination state이며 gitignore 대상입니다.

```text
.oma/
├─ task-contract.md
├─ implementation-evidence.md
└─ review-packet.md
```

## Correction loop

```text
Implementation
    ↓
Review
    ↓
NO-GO
    ↓
blocker only
    ↓
same worker session
    ↓
fix
    ↓
re-review
```

가능하면 기존 worker/reviewer session을 재사용합니다. v0.1에서는 반복 수정의 일반적인 상한을 두 번 정도로 잡습니다.

## 병렬 실행

Fan-out은 기본값이 아닙니다. 작업이 실제로 독립적이고, 같은 파일을 동시에 수정하지 않으며, 병합 비용이 작고, spawn/coordination 비용보다 절약되는 시간이 큰 경우에만 사용합니다.

## Quota 관점

```text
Gemini Flash  = 값싼 일반 노동
Gemini Pro    = 고급 실무 / 어려운 reasoning
Sonnet 4.6    = Main coordinator
Opus 4.6      = expensive final reviewer
```

실사용 후 Gemini / Claude 중 어느 pool이 먼저 소진되는지 관찰한 뒤 category와 review 비중을 이동시키는 것이 계획입니다.
