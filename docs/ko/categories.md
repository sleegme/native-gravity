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
| `writing` | **Flash 고정** | 문서/기술 글쓰기. writing 단계는 Pro/Claude로 승격하지 않음 |

## quick

작은 typo/fix, 명확한 한두 파일 수정, 단순 설정 변경, 위험도가 낮은 반복 작업에 사용합니다. 불필요한 새 abstraction이나 광범위한 탐색을 피하고 필요한 검증만 빠르게 수행합니다.

## unspecified-low

특정 specialist category까지는 필요하지 않지만 `quick`보다 조금 더 넓은 일반 작업입니다. Flash가 기본이며 범위나 reasoning 난도가 예상보다 크면 Pro escalation을 요청할 수 있습니다.

## deep

`deep`은 단순히 "생각을 오래 한다"는 뜻이 아닙니다. 원인이 여러 계층에 걸쳐 있고 dependency/call path를 넓게 추적해야 하며 symptom patch가 아니라 root cause 수정과 완전한 delivery가 필요한 goal-oriented 작업에 사용합니다.

## ultrabrain

어려운 판단 자체가 핵심인 작업입니다. 복잡한 논리 오류, architecture decision, 설계안 trade-off, 고난도 debugging, invariant/constraint를 먼저 세워야 하는 문제에 사용합니다.

`deep`과 같은 Pro를 사용할 수 있지만 `deep`은 delivery 중심, `ultrabrain`은 고난도 reasoning 중심입니다.

## visual-engineering

UI/frontend 작업 전용입니다. 기존 theme/token/shared component와 spacing/typography/color convention을 먼저 확인하고 기존 design system을 우선 재사용합니다.

## artistry

기능적 정답보다 창의적 품질이 중요한 작업에 사용합니다. 여러 방향을 비교한 뒤 하나를 선택하되 제품 목적과 scope를 무시하지 않습니다.

## unspecified-high

규모는 크지만 다른 specialist category로 명확히 분류하기 어려운 substantial cross-module 작업에 사용합니다.

## architect

기본적으로 advisory category입니다. module boundary, data flow, ownership, migration cost, compatibility, failure mode를 조사하고 최소 두 개의 현실적인 설계안을 비교한 뒤 하나를 추천합니다. 사용자가 구현까지 요구하지 않았다면 source edit을 하지 않습니다.

## writing

README, 개발 문서, 기술 설명, migration guide 등의 작업입니다. **writing은 항상 Flash가 실행합니다.** 문서가 길거나 중요하거나 기술적으로 복잡하다는 이유만으로 Pro, Sonnet, Opus로 올리지 않습니다.

어려운 기술 분석, architecture 판단, 코드베이스 조사, 외부 검증이 필요하면 그 부분만 별도 category/agent에서 먼저 수행합니다. 이후 확정된 사실, 결정, source material을 Flash writing worker에 넘깁니다. 비싼 reasoning과 값싼 prose 생성을 분리하는 것이 기본 원칙입니다.

## Category 전달 방식

Main은 worker prompt에 `CATEGORY: <name>`을 명시하고 Goal, Scope, Non-goals, Acceptance criteria, Verification expected를 함께 전달합니다. Category는 task contract를 대신하지 않습니다.

## 새 category와 새 agent는 다르다

새 작업 유형이 필요하다고 agent를 하나 더 만들지 않습니다. tool permission, read-only isolation, lifecycle, context, 책임이 실질적으로 달라질 때만 새 agent를 추가합니다.
