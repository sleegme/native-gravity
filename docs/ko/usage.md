# 사용법

[English](../usage.md) · [제품과 설치](README.md#설치) · [현재 상태](status.md)

수정할 프로젝트 디렉터리에서 NTG를 사용합니다. 사용자는 목표, 플랜과 완료 기준을
제공하며 내부 에이전트를 고르지 않습니다. **마일스톤**은 범위가 정해진 작업
단계이고, **ledger**는 대화 기록이 아닌 진행 파일입니다.

## 프로젝트 준비

[README의 설치 절차](README.md#설치)를 따르세요. 같은 터미널의 `NTG` 변수를
유지하거나 Native Gravity 저장소의 실제 절대 경로를 지정합니다.

```bash
export NTG="$HOME/work/native-gravity"
```

위 경로는 예시이므로 자신의 저장소 경로로 바꾸세요. 평소 터미널 사용 방식으로
수정할 프로젝트 디렉터리에 들어갑니다. 아래 `.ntg/`와 플랜 경로는 그 프로젝트
기준입니다. `"$NTG/..."`처럼 따옴표로 감싸면 저장소 경로에 공백이 있어도 됩니다.
플러그인 설치만으로 전역 `ntg-vnext`나 `ntg-dag` 명령이 생기지는 않습니다.

## 첫 작업

프로젝트에 `src/server.js` 서비스와 `tests/server.test.js` 테스트가 있다고
가정합니다. 아래 내용을 그 프로젝트의 `plan.json`으로 저장하세요. 이 파일
경로들은 NTG가 제공하는 파일이 아니라 예시입니다. 자신의 서비스와 테스트
프레임워크에 맞게 경로와 완료 기준을 바꾸세요.

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

필수 입력은 비어 있지 않은 `goal`, 비어 있지 않은 `milestones` 배열, 각
마일스톤의 고유하고 비어 있지 않은 `id`입니다. 의존성은 존재하는 ID를 가리켜야
하고 순환하면 안 됩니다. `objective`, `acceptance_criteria`, `non_goals`,
`bounded_scope`는 초기화 시 생략할 수 있지만, 실행과 검수의 기준이 되므로
작성하세요. `title`, `constraints`, `plan_version`도 계획을 이해하고 바꾸는 데
도움이 됩니다.

진행 파일을 만들고 다음 단계를 확인합니다.

```bash
node "$NTG/scripts/ntg-vnext.mjs" init --ledger .ntg/ledger.json --plan plan.json
node "$NTG/scripts/ntg-vnext.mjs" status --ledger .ntg/ledger.json
```

두 명령은 위 플랜으로 로컬 실행했습니다. 출력 중 관련 필드만 발췌하면 다음과
같습니다. 전체 응답은 아닙니다.

```json
{
  "state": {
    "goal": "Add a health-check endpoint to the example service",
    "plan_version": "v1",
    "next_action": "Ready to delegate initial milestone: m1",
    "completed_milestones": []
  },
  "next_milestone": "m1",
  "needs_alt": []
}
```

이제 플랜을 실행합니다.

```bash
node "$NTG/scripts/ntg-vnext.mjs" run --ledger .ntg/ledger.json --all
```

실제 AGY 모델을 호출하고 모델 사용량을 소비합니다. 이번 문서 변경에서는
다시 실행하지 않았으며, 실행/검수 흐름은 [기존 라이브 증거](status.md#라이브-검증)를
참고하세요. health-check 구현 자체는 설명용 과제이며 라이브 성공을 주장하는
예제가 아닙니다.

NTG가 `m1`을 실행하고 완료 기준에 맞는지 독립 검수한 뒤, 통과했을 때만 `m2`를
진행합니다. 검수 결과는 `GO`(통과) 또는 `NO-GO`(수정 필요)입니다. 현재 플랜이
모두 검증되고 블로커가 없어야 최종 응답에 `global_completion`이 포함됩니다.
모델의 자체 완료 주장만으로는 끝나지 않습니다.

## 한 단계 실행과 나중에 재개

다음에 실행할 수 있는 마일스톤 하나만 진행하려면:

```bash
node "$NTG/scripts/ntg-vnext.mjs" run --ledger .ntg/ledger.json
```

의존성이 이미 완료된 마일스톤을 지정하려면:

```bash
node "$NTG/scripts/ntg-vnext.mjs" run --ledger .ntg/ledger.json --milestone m1
```

두 모델 호출 방식은 소스로 확인했으며 여기서 라이브로 다시 실행하지 않았습니다.
`--all`은 의존성 순서로 계속 진행합니다. `--milestone`을 함께 주면 그 마일스톤
하나만 실행합니다.

정상 종료 후 같은 프로젝트에서 새 터미널을 열고 `NTG`를 다시 지정하세요.
`status`로 확인한 뒤 `run` 또는 `run --all`을 반복하면 됩니다. 매번 저장된
진행 상황을 읽으므로 이전 대화가 필요하지 않습니다. 기존 ledger에 `init`을
다시 실행하지 마세요.

## 계획 변경

같은 형식의 수정된 플랜을 `plan-v2.json`으로 저장하고 `plan_version`을 `"v2"`로
설정합니다.

```bash
node "$NTG/scripts/ntg-vnext.mjs" replan --ledger .ntg/ledger.json --plan plan-v2.json
```

이 로컬 명령은 예제의 v2 복사본으로 확인했습니다. 새 플랜을 채택하면서 기존
완료 상태를 비우고 이전 검수는 stale로 표시합니다. 유지한 단계도 의존성 순서로
새 검수를 받아야 하지만, 바뀌지 않은 코드를 다시 작성할 필요는 없습니다.
이전 증거는 이력으로 남습니다. 실행 중인 호출은 종료하거나 복구한 뒤 계획을
바꾸세요.

## 자문 받기

아직 결정하지 못한 설계 질문에는:

```bash
node "$NTG/scripts/ntg-vnext.mjs" plan --ledger .ntg/ledger.json --task "How should we test the health endpoint?"
```

같은 실패가 반복되어 다른 접근이 필요하다면:

```bash
node "$NTG/scripts/ntg-vnext.mjs" alt --ledger .ntg/ledger.json --milestone m1 --task "Challenge our current diagnosis of the failing health endpoint"
```

둘 다 모델을 호출합니다. 문법은 소스로 확인했으며 여기서 다시 실행하지
않았습니다. 출력의 `adopted: false`는 자문이 기록될 뿐 플랜을 바꾸거나 작업을
완료하지 않는다는 뜻입니다. 사용할 내용을 결정하고 플랜 파일을 수정한 뒤
`replan`으로 채택하세요.

`status`는 같은 실패 유형이 새 증거 없이 세 번 이상 반복되면 `needs_alt`를
추천합니다. 자동 모델 호출은 없습니다. `alt`의 기본 모델은 Sonnet이며
`--escalate`를 추가하면 명시적으로 Opus를 선택하므로 사용 비용이 달라질 수
있습니다. 어느 쪽도 자문이라는 경계는 같습니다.

## 작업이 멈췄을 때

JSON 출력의 `results`, `state.blockers`, `state.next_action`을 확인하세요.

| 결과 | 다음 행동 |
|---|---|
| 종료 코드 0 | 명령 성공입니다. 프로젝트 전체 완료 여부는 `global_completion`을 확인하세요 |
| 종료 코드 2: `NO-GO` | 수정 요구를 읽고 `run`을 반복하여 새 후보와 새 검수를 받으세요 |
| 종료 코드 2: `BLOCKED` / `NEEDS_DEEP` | 블로커를 해결하거나 계획 자문을 받고 필요하면 플랜을 바꾸세요 |
| 종료 코드 1: 잘못된 모델 응답 | 오류를 읽고 적절하면 재시도하세요. 잘못된 응답으로는 승격하지 않습니다 |
| Ledger 잠금 | 이전 세션을 정상 종료하세요. 살아 있는 소유자의 lock을 지우지 마세요 |
| 작업 중 프로세스 크래시 | 아래 복구 절차 후 재개하세요 |

크래시 복구에는 `/proc`이 있는 Linux, `os.pidfd_open`을 제공하는 Python 3,
pidfd를 지원하는 커널이 필요합니다. 고아 실행기의 종료를 확인할 수 없으면
복구를 거부합니다. 이전 호출의 중단을 실제로 관측했다면 그 사실을 설명합니다.

```bash
node "$NTG/scripts/ntg-vnext.mjs" recover --ledger .ntg/ledger.json --evidence "Observed the previous supervisor exit during milestone execution"
```

증거 문장은 실제 관측으로 바꾸세요. 종료된 소유자 복구는 `tests/test_ntg_vnext.mjs`가
검증하며, 중단이 없을 때의 거부 동작은 로컬에서 실행했습니다. 공유 세션은
중단하지 않았습니다. 복구는 중단된 호출을
종료할 뿐 작업을 완료하지 않습니다. 이후 `status`를 확인하고 다시 실행하세요.
일반적인 잠금 해제 명령은 아닙니다. 중단된 마일스톤이 없으면 복구 성공을
주장하지 않고 오류를 반환합니다.

`init`, `status`, `replan`, `recover`는 모델을 호출하지 않습니다.
`run`, `plan`, `alt`는 모델을 호출합니다. 모델 호출의 기본 제한 시간은 600초이며
`--timeout` 또는 `NTG_RUNNER_TIMEOUT_S`로 양수 초 값을 지정할 수 있습니다.

## 그래프로 진행 상황 보기

```bash
node "$NTG/scripts/dag-view.mjs" --ledger .ntg/ledger.json --width 80 --no-color
```

예제 ledger로 로컬 실행했습니다. 진행 상태를 바꾸지 않고 의존성과 상태를
그리는 읽기 전용 명령입니다.

- `--ledger PATH`: ledger 경로. `NTG_LEDGER` 환경 변수로도 지정할 수 있습니다.
- `--width N`: 고정 폭. 생략하면 터미널 폭을 사용합니다.
- `--no-color`: ANSI 색 비활성화.
- `--watch`: 파일 변경 시 다시 그립니다. 옆 터미널 창에 띄워 두기 좋습니다. 이번 문서 변경에서는 watch 방식을
  다시 실행하지 않았습니다.

자신의 프로젝트 대신 NTG가 제공하는 표시용 fixture를 보려면:

```bash
node "$NTG/scripts/dag-view.mjs" --ledger "$NTG/tests/fixtures/dag-view/all-states.ledger.json" --width 80 --no-color
```

이 fixture 명령도 로컬 실행했습니다. 내부 역할 선택, 모델 재정의와 릴리스 검증은
[내부 동작](../internals.md)을 참고하세요.
