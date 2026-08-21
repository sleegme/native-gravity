# 현재 상태

oh-my-agy는 현재 **v0.1 / experimental** 단계입니다.

아키텍처와 기본 agent/routing 파일은 준비되어 있지만, 실제 Antigravity 환경에서 모든 경로가 반복적으로 검증된 안정 버전은 아닙니다.

## 구현된 항목

- Antigravity plugin scaffold
- `oma-main`
- Flash implementation worker
- Pro implementation worker
- read-only Explore
- read-only Librarian
- read-only Review
- task contract / evidence / review packet 흐름
- `oma` convenience CLI
- dev symlink installer
- smoke test
- Opus review wrapper
- fixed v0.1 category routing

## 아직 검증이 필요한 항목

### 전체 E2E

다음 흐름을 실제 AGY 환경에서 반복 검증해야 합니다.

```text
oma main
  ↓
Main discovery / startup
  ↓
subagent delegation
  ↓
Flash or Pro implementation
  ↓
evidence
  ↓
oma packet
  ↓
oma review
  ↓
GO / NO-GO
```

### Review direct launch

현재 review agent는 native Pro fallback과 exact Opus review를 같은 harness로 처리하려는 구조입니다.

AGY 버전에 따라 custom agent의 `mainAgent` / `subagent` 조합과 `--agent` direct launch 동작을 실제 환경에서 확인해야 합니다. 이 부분은 현재 가장 먼저 검증할 항목입니다.

### Tool schema drift

Antigravity custom agent에서 사용하는 tool 이름이나 frontmatter schema가 업데이트로 바뀔 수 있습니다.

특히 unknown/unmapped tool은 agent 실행 실패 또는 hang 원인이 될 수 있으므로 AGY 업데이트 후에는 `oma smoke`와 간단한 실제 delegation을 다시 확인해야 합니다.

### Model slug drift

`oma main`과 `oma review`는 `agy models`에서 Sonnet 4.6 / Opus 4.6 slug를 찾아 사용합니다.

preview 모델 naming이 바뀌면 자동 탐지가 실패할 수 있습니다. 이 경우 다음 override를 사용할 수 있습니다.

```bash
OMA_MAIN_MODEL=<slug> oma main
OMA_REVIEW_MODEL=<slug> oma review
```

## Quota

현재 automatic quota-aware routing은 구현하지 않았습니다.

이것은 의도된 결정입니다.

먼저 현재 고정 배치를 실제로 사용한 뒤:

- Gemini pool의 소진 속도
- Claude/non-Gemini pool의 소진 속도
- category별 대략적인 burn
- review 빈도 대비 비용

을 관찰하고 라우팅을 조정합니다.

## v0.1 완료 기준

다음 항목이 실제 AGY 환경에서 확인되면 v0.1을 "작동 확인된 초기 버전"으로 볼 수 있습니다.

- `oma smoke` 통과
- `oma main` 정상 시작
- Main → Flash subagent delegation 성공
- Main → Pro subagent delegation 성공
- worker가 실제 source edit + verification 수행
- `oma packet` 정상 생성
- Opus review 또는 Pro fallback review 성공
- NO-GO → 동일 worker correction → 재검토 흐름 성공

## 이후 후보

실사용 데이터가 쌓인 다음에만 다음 기능을 검토합니다.

- quota telemetry
- dynamic routing
- category별 reasoning 조정
- review invocation gate 고도화
- session reuse 자동화
- 독립 작업 fan-out

지금 단계에서는 기능 추가보다 **현재 작은 구조가 실제로 안정적으로 도는지 확인하는 것**이 우선입니다.
