# 카테고리와 라우팅

v0.1은 OMO 계열에서 사용되던 category 개념을 참고하되, Antigravity에서는 훨씬 작은 agent set에 매핑합니다.

카테고리는 "어떤 모델을 쓸지"만 결정하는 값이 아닙니다. 같은 모델을 사용하더라도 작업 방식, 탐색 깊이, 구현 범위, 검증 방식이 달라질 수 있습니다.

## 기본 라우팅

| Category | 기본 Worker | 목적 |
| --- | --- | --- |
| `quick` | Flash | 작고 명확하며 저위험인 작업 |
| `unspecified-low` | Flash | specialist category가 필요 없는 제한된 중간 난도 작업 |
| `deep` | Pro | 넓은 탐색, root cause 추적, 자율적인 full delivery |
| `ultrabrain` | Pro | 어려운 논리, 설계, trade-off, 고난도 debugging |
| `visual-engineering` | Pro | design-system-first 방식의 UI/frontend 작업 |
| `artistry` | Pro | 창의적 품질 자체가 중요한 작업 |
| `unspecified-high` | Pro | 더 적합한 specialist category가 없는 큰 cross-module 작업 |
| `architect` | Pro | 구현보다 설계/경계/이행비용/trade-off 판단이 중심인 자문 |
| `writing` | Flash 기본 | 문서/기술 글쓰기. 난도와 중요도에 따라 Pro 승격 |

## quick

다음과 같은 작업을 대상으로 합니다.

- 작은 typo/fix
- 명확한 한두 파일 수정
- 단순 설정 변경
- 위험도가 낮은 반복 작업

불필요한 새 abstraction이나 광범위한 탐색을 피하고, 필요한 검증만 빠르게 수행합니다.

## unspecified-low

특정 specialist category까지는 필요하지 않지만 `quick`보다 조금 더 넓은 일반 작업입니다.

예:

- contained feature
- 제한적인 bugfix
- 작은 refactor
- 평범한 구현 작업

Flash가 기본이며, 실제 코드를 확인한 결과 범위나 reasoning 난도가 예상보다 크면 Pro escalation을 요청할 수 있습니다.

## deep

`deep`은 단순히 "생각을 오래 한다"는 뜻이 아닙니다.

다음 성격을 가진 goal-oriented 작업에 사용합니다.

- 원인이 여러 계층에 걸쳐 있음
- dependency/call path를 넓게 추적해야 함
- symptom patch가 아니라 root cause 수정이 필요함
- 조사만 하고 끝내는 것이 아니라 완전한 delivery까지 요구됨

`deep` worker는 첫 edit 전에 관련 경로를 충분히 파악하고, 구현 이후 실제 검증까지 수행해야 합니다.

## ultrabrain

`ultrabrain`은 어려운 판단 자체가 핵심인 작업입니다.

예:

- 복잡한 논리 오류
- architecture decision
- 여러 설계안의 trade-off 비교
- 재현이 어려운 debugging
- invariant/constraint를 먼저 세워야 하는 문제

`deep`과 같은 Pro를 사용할 수 있지만 행동 모드는 다릅니다. `deep`은 delivery 중심, `ultrabrain`은 고난도 reasoning 중심입니다.

## visual-engineering

UI/frontend 작업 전용입니다.

Worker는 먼저 다음을 확인합니다.

- 기존 theme/token
- shared components
- 대표적인 화면/컴포넌트
- spacing/typography/color convention

새로운 one-off 디자인 primitive를 쉽게 만들지 않고 기존 design system을 우선 재사용합니다.

## artistry

기능적 정답보다 창의적 품질이 중요한 작업에 사용합니다.

첫 아이디어에 바로 고정되기보다 여러 방향을 비교한 뒤 하나를 선택합니다. 다만 창의성을 이유로 제품의 기존 목적이나 scope를 무시해서는 안 됩니다.

## unspecified-high

규모는 크지만 `deep`, `visual-engineering`, `architect` 등으로 명확하게 분류하기 어려운 substantial 작업입니다.

보통 여러 module을 건드리거나 blast radius가 있는 작업에 사용합니다.

## architect

기본적으로 advisory category입니다.

확인 대상:

- module boundary
- data flow
- ownership
- migration cost
- compatibility
- failure mode

최소 두 개의 현실적인 설계안을 비교하고 trade-off를 설명한 뒤 하나를 추천하는 것을 기본으로 합니다.

사용자가 구현까지 요구하지 않았다면 source edit을 하지 않습니다.

## writing

README, 개발 문서, 기술 설명, migration guide 등의 작업입니다.

기본값은 Flash이며 다음 경우 Pro 승격을 고려합니다.

- 기술적으로 복잡한 내용
- 여러 source를 교차 검증해야 함
- architecture/spec 문서
- 잘못 쓰면 실제 구현 방향에 영향을 주는 문서

## Category 전달 방식

Main은 worker prompt에 다음 값을 명시합니다.

```text
CATEGORY: <name>
```

그리고 category만 던지는 것이 아니라 최소한 다음 contract를 함께 전달합니다.

```text
Goal
Scope
Non-goals
Acceptance criteria
Verification expected
```

즉 category는 task contract를 대신하지 않습니다.

## 새 category와 새 agent는 다르다

새로운 작업 유형이 필요하다고 해서 agent를 하나 더 만드는 것은 아닙니다.

새 agent가 필요한 경우는 보통 다음과 같습니다.

- 필요한 tool permission이 완전히 다름
- read-only isolation이 필요함
- lifecycle이 다름
- context를 분리해야 함
- 명확히 별개의 책임이 존재함

그렇지 않다면 기존 implementation worker에 category behavior를 추가하는 쪽을 우선합니다.

이 원칙 때문에 OMA는 category 수에 비해 실제 agent 수를 작게 유지합니다.
