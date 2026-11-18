# 사용법

[English](../usage.md) · [제품과 설치](README.md#설치-방법) · [현재 상태](status.md)

NTG 2.0은 기존 `AGENTS.md`나 git 이력이 없는 깨끗한 프로젝트 디렉터리에서도 바로 실행할 수 있습니다. 작업 목표(또는 `plan.json`)만 전달하면 Steamroller가 자동으로 **Track L**, **Track S**, **Track M**을 구분해 적절한 워커와 검수 절차를 실행합니다.

## /ntg로 실행하기

`agy` 세션에서 다음과 같이 입력합니다:

```text
/ntg <할 일>
```

- **새 작업 (Track L vs Track S/M):**
  - 작고 위험도가 낮은 변경(`Track L`)은 경량 워커와 바인딩된 **Strix Halo** 리뷰(`HALO_LIGHTWEIGHT`)를 거쳐 `.ntg/lightweight-runs.jsonl`에 기록합니다. 고위험으로 판단되면 자동으로 독립 Zen 검수로 에스컬레이션합니다.
  - 실질적인 단일 마일스톤(`Track S`)이나 복합 마일스톤(`Track M`) 작업은 읽기 쉬운 평어 요약을 한 번 보여주고 **최초 1회 승인**을 받은 뒤 `.ntg/ledger.json` 초기화 및 실행(`run --all`)을 진행합니다.
- **기존 작업 재개:** `.ntg/ledger.json`이 이미 존재하면 기존 완료 기록을 보존한 채 상태를 요약하고 `run --all`로 안전하게 이어갑니다.
- **진행 그래프 (`/ntg graph`):** 진행 파일을 수정하지 않고 `ntg-dag`로 마일스톤 의존성과 상태를 시각화합니다.
- **별도 경로 환경변수 불필요:** `skills/ntg/SKILL.md`가 설치된 플러그인 내부의 `scripts/ntg-command.mjs`를 자동 해석합니다.
- **품질 리뷰와 최종 검수 분리:** Strix Halo 품질 리뷰(`ACCEPT | REVISE | ESCALATE`)와 독립 Zen 검수(`GO | NO-GO`)는 서로 대체되지 않으며, 코드나 기준이 바뀌면 기존 리뷰는 자동으로 무효(`STALE`) 처리됩니다.

## CLI 사용법 (`ntg-vnext` & `ntg-command`)

직접 CLI 또는 `node scripts/ntg-command.mjs`로도 모든 기능을 사용할 수 있습니다:

```json
{
  "goal": "Add a health-check endpoint to the example service",
  "constraints": ["No new dependencies"],
  "plan_version": "v1",
  "milestones": [
    {
      "id": "m1",
      "title": "Implement the endpoint",
      "objective": "Serve GET /health with {\"status\": \"ok\"}",
      "acceptance_criteria": ["GET /health returns 200 and a status field"],
      "non_goals": ["Metrics or readiness probes"],
      "dependencies": [],
      "bounded_scope": ["src/server.js"]
    },
    {
      "id": "m2",
      "title": "Cover it with a test",
      "objective": "Add one automated test for GET /health",
      "acceptance_criteria": ["A test asserts the 200 response and status field"],
      "non_goals": ["Full coverage of other routes"],
      "dependencies": ["m1"],
      "bounded_scope": ["tests/server.test.js"]
    }
  ]
}
```

초기화 및 상태 확인:

```bash
ntg-vnext init --ledger .ntg/ledger.json --plan plan.json
ntg-vnext status --ledger .ntg/ledger.json
```

의존성 순서대로 실행(`--track L|S|M` 옵션 지정 가능):

```bash
ntg-vnext run --ledger .ntg/ledger.json --all
```

다음 준비된 마일스톤 1개 또는 특정 마일스톤만 실행:

```bash
ntg-vnext run --ledger .ntg/ledger.json
ntg-vnext run --ledger .ntg/ledger.json --milestone m1
```

계획 수정:

- **Tactical Replan** (목표·완료 기준·불변식은 유지하면서 남은 전략/마일스톤만 수정; `plan_version` 증가 및 기존 `GO`·Halo 판정 `STALE` 처리):

```bash
ntg-vnext tactical-replan --ledger .ntg/ledger.json --plan plan-v2.json
```

- **Material Replan** (목표·완료 기준·불변식·파괴적 범위 변경 시 명시적 사용자 재승인 필요):

```bash
ntg-vnext replan --ledger .ntg/ledger.json --plan plan-v2.json
```

계획 자문(`plan`) 및 대안 시각(`alt`) 요청:

```bash
ntg-vnext plan --ledger .ntg/ledger.json --task "How should we structure verification for the health endpoint?"
ntg-vnext alt --ledger .ntg/ledger.json --milestone m1 --task "Challenge our current diagnosis of the failing endpoint"
```

## 크래시 복구 및 상태 스냅샷

Linux에서 프로세스가 비정상 종료되어 PID+토큰이 기록된 `.ntg/ledger.json.lock`이 남았을 때는 소유자 종료 확인 후 복구할 수 있습니다:

```bash
ntg-vnext recover --ledger .ntg/ledger.json --evidence "Observed the previous supervisor exit during milestone execution"
```

읽기 전용 진행 보기(`ntg-dag`, `ntg-state-snap`):

```bash
ntg-dag --ledger .ntg/ledger.json --width 80 --no-color
ntg-state-snap --ledger .ntg/ledger.json
node scripts/ntg-command.mjs graph
```

내장 fixture 미리보기:

```bash
ntg-dag --ledger tests/fixtures/dag-view/all-states.ledger.json --width 80 --no-color
```

내부 아키텍처와 안전 가드는 [내부 동작](../internals.md)을 참고하세요.
