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

`oma-main`의 주 역할은 다음과 같습니다.

1. 사용자 요청 해석
2. task contract 생성
3. category 선택
4. 적합한 worker에게 위임
5. evidence 수집
6. review gate 통과 여부 판단

실질적인 source edit은 implementation worker가 담당합니다. Main이 모든 구현을 직접 하기 시작하면 Sonnet quota를 불필요하게 소비하고 role separation도 무너집니다.

## Task contract

Main은 substantive 작업 전에 `.oma/task-contract.md`를 만듭니다.

기본 내용은 다음과 같습니다.

```text
Goal
Scope
Non-goals
Acceptance criteria
Verification expected
Selected category
```

이 contract는 구현 중 임의로 바뀌지 않는 것을 원칙으로 합니다. 요구사항이 실제로 변했다면 Main이 명시적으로 갱신합니다.

## Evidence 기반 완료

Worker의 `done` 발언만으로 완료 처리하지 않습니다.

가능한 경우 다음 evidence를 함께 남깁니다.

- 실제 변경 파일
- diff
- targeted test 결과
- build/typecheck/lint 결과
- 필요한 경우 runtime 확인
- 남은 risk 또는 blocker

`.oma/implementation-evidence.md`에 worker 결과를 보존하고, `oma packet`이 이를 current diff/task contract와 함께 `.oma/review-packet.md`로 묶습니다.

## Review gate

Review는 구현과 분리됩니다.

기본 reviewer는 Claude Opus 4.6이며 다음만 집중해서 확인합니다.

- acceptance criteria 충족 여부
- correctness bug
- regression
- 위험한 삭제 또는 scope expansion
- public/API/behavioral contract 위반
- 검증 부족
- evidence와 실제 코드의 모순

스타일 취향이나 사소한 nitpick은 blocker로 취급하지 않습니다.

최종 출력은 다음 둘 중 하나입니다.

```text
VERDICT: GO
```

또는

```text
VERDICT: NO-GO
```

NO-GO인 경우 concrete blocker만 기존 implementation session으로 돌려보내는 것이 기본입니다.

## 왜 Opus wrapper가 필요한가

Antigravity custom-agent frontmatter는 native Gemini worker에 적합한 `flash` / `pro` tier를 제공하지만, 정확한 Claude Opus 모델을 subagent frontmatter에서 동일한 방식으로 고정하는 구조와는 다릅니다.

그래서 OMA는 exact Claude 모델이 필요한 지점만 CLI boundary를 사용합니다.

```text
oma main
  └─ Sonnet 4.6 pin

oma review
  └─ Opus 4.6 pin
```

반면 implementation worker는 native Flash / Pro tier를 사용합니다.

## 상태 envelope

`.oma/` 디렉터리는 로컬 coordination state이며 gitignore 대상입니다.

```text
.oma/
├─ task-contract.md
├─ implementation-evidence.md
└─ review-packet.md
```

이 구조는 Main conversation에 모든 구현 세부사항을 계속 들고 다니지 않으면서도 재검토에 필요한 정보를 남기는 역할을 합니다.

## Correction loop

기본 흐름은 다음과 같습니다.

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

가능하면 기존 worker/reviewer session을 재사용합니다. 같은 문제를 해결하기 위해 매번 새 에이전트를 생성하면 context와 quota를 같이 낭비하기 쉽습니다.

v0.1에서는 반복 수정의 일반적인 상한을 두 번 정도로 잡습니다. 같은 blocker가 서로 다른 수정 시도 후에도 남아 있으면 무작정 반복하지 않고 Main이 원인을 다시 판단하도록 합니다.

## 병렬 실행

Fan-out은 기본값이 아닙니다.

다음 조건을 만족할 때만 병렬 worker가 유리합니다.

- 작업이 실제로 서로 독립적임
- 같은 파일을 동시에 수정하지 않음
- 결과 병합 비용이 작음
- spawn/coordination 비용보다 절약되는 시간이 큼

단순히 "멀티 에이전트니까 여러 개 띄운다"는 이유로 병렬화하지 않습니다.

## Quota 관점

v0.1은 quota-aware routing을 자동화하지 않습니다.

초기 가설은 다음과 같습니다.

```text
Gemini Flash  = 값싼 일반 노동
Gemini Pro    = 고급 실무 / 어려운 reasoning
Sonnet 4.6    = Main coordinator
Opus 4.6      = expensive final reviewer
```

실사용 후 Gemini / Claude 중 어느 pool이 먼저 소진되는지 관찰한 뒤 category와 review 비중을 이동시키는 것이 계획입니다.
