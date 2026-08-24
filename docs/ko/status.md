# 현재 상태

oh-my-agy는 현재 **v0.1 / experimental** 단계입니다.

아키텍처와 기본 agent/routing 파일은 준비되어 있지만, 실제 Antigravity 환경에서 모든 경로가 반복적으로 검증된 안정 버전은 아닙니다.

## 구현된 항목

- Antigravity plugin scaffold
- `oma-main`
- Flash implementation worker
- Pro implementation worker
- read-only Explore / Librarian / Review
- task contract / evidence / review packet 흐름
- `oma` convenience CLI
- dev symlink installer
- smoke test
- Gemini 3.1 Pro review wrapper
- fixed v0.1 category routing

## 아직 검증이 필요한 항목

### 전체 E2E

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

현재 review agent는 native `pro` tier와 exact Gemini 3.1 Pro High review를 같은 read-only harness로 처리하는 구조입니다. AGY 버전에 따라 custom agent의 `mainAgent` / `subagent` 조합과 `--agent` direct launch 동작을 실제 환경에서 확인해야 합니다.

### Tool / model drift

Antigravity custom agent tool 이름, frontmatter schema, model slug가 바뀔 수 있습니다. 업데이트 후에는 `oma smoke`와 간단한 delegation을 다시 확인해야 합니다.

필요하면 다음 override를 사용할 수 있습니다.

```bash
OMA_MAIN_MODEL=<slug> oma main
OMA_REVIEW_MODEL=<slug> oma review
```

## Quota

현재 automatic quota-aware routing은 구현하지 않았습니다. 먼저 고정 배치를 실제로 사용하면서 Gemini pool, Claude/non-Gemini pool, category별 burn, review 비용을 관찰한 뒤 조정합니다.

## v0.1 완료 기준

- `oma smoke` 통과
- `oma main` 정상 시작
- Main → Flash / Pro delegation 성공
- worker가 실제 source edit + verification 수행
- `oma packet` 정상 생성
- Gemini 3.1 Pro review 성공
- NO-GO → 동일 worker correction → 재검토 흐름 성공

## 이후 후보

실사용 데이터가 쌓인 다음에 quota telemetry, dynamic routing, category별 reasoning 조정, review invocation gate, session reuse 자동화, 독립 작업 fan-out 등을 검토합니다.

지금 단계에서는 기능 추가보다 **현재 작은 구조가 실제로 안정적으로 도는지 확인하는 것**이 우선입니다.
