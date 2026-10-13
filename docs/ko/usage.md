# 사용법

[English](../usage.md) · [제품과 설치](README.md#설치) · [현재 상태](status.md)

NTG는 수정하려는 프로젝트 디렉터리에서 실행합니다. 여러분은 목표, 플랜, 결과를
확인할 기준만 준비하면 되고 내부 에이전트는 NTG가 고릅니다. 앞으로 자주 나올
용어가 두 개 있습니다. **마일스톤**은 플랜 안에서 범위가 정해진 작업 단계 하나이고,
**ledger**는 대화 기록이 아니라 진행 상황을 저장한 파일입니다.

## 프로젝트 준비

[README의 설치 절차](README.md#설치)대로 설치하세요. 설치한 터미널의 `NTG`
변수를 그대로 쓰거나, Native Gravity 저장소의 절대 경로를 직접 지정합니다.

```bash
export NTG="$HOME/work/native-gravity"
```

위 경로는 예시일 뿐이니 실제 저장소 위치로 바꾸세요. 그다음 평소처럼 작업할
프로젝트 디렉터리로 이동합니다. 아래에 나오는 `.ntg/`와 플랜 경로는 모두 그
프로젝트를 기준으로 합니다. `"$NTG/..."`처럼 따옴표로 감싸 두면 저장소 경로에
공백이 있어도 문제없습니다. 플러그인만 설치해서는 전역 `ntg-vnext`나 `ntg-dag`
명령이 생기지 않습니다.

## 첫 작업

프로젝트에 이미 `src/server.js` 서비스와 `tests/server.test.js` 테스트가 있다고
해 봅시다. 아래 내용을 그 프로젝트에 `plan.json`으로 저장하세요. 이 파일들은
NTG에 들어 있는 것이 아니라 설명을 위한 예시이므로, 경로와 완료 기준은 여러분의
서비스와 테스트 프레임워크에 맞게 고치면 됩니다.

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

꼭 필요한 값은 비어 있지 않은 `goal`, 비어 있지 않은 `milestones` 배열, 그리고
마일스톤마다 겹치지 않고 비어 있지 않은 `id`입니다. 의존성은 실제로 있는 ID를
가리켜야 하고, 서로 돌고 도는 순환이 생기면 안 됩니다. `objective`,
`acceptance_criteria`, `non_goals`, `bounded_scope`는 빠져도 초기화는 되지만
그래도 채워 주세요. 실행과 검수가 무엇을 기준으로 할지 여기서 정해집니다.
`title`, `constraints`, `plan_version`이 있으면 플랜을 읽고 고치기도 쉬워집니다.

진행 파일을 만들고 다음 단계를 확인합니다.

```bash
node "$NTG/scripts/ntg-vnext.mjs" init --ledger .ntg/ledger.json --plan plan.json
node "$NTG/scripts/ntg-vnext.mjs" status --ledger .ntg/ledger.json
```

위 플랜이라면 출력에 다음 필드가 들어 있습니다. 전체 응답이 아니라 일부만
옮긴 것입니다.

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

> **모델 사용량:** `run`, `plan`, `alt`는 실제 AGY 모델을 호출하므로 모델
> 사용량이 듭니다. 여기 나온 health-check 작업은 설명용 예시이지 실제로 돌려 본
> 결과가 아닙니다. 실제 실행과 검수 흐름은 [라이브 증거](status.md#라이브-검증)에
> 있습니다.

NTG는 `m1`을 실행하고 완료 기준에 맞는지 독립 검수를 받습니다. `m1`이 검증된
뒤에야 `m2`로 넘어갑니다. 검수 결과는 `GO`(통과) 아니면 `NO-GO`(수정 필요)입니다.
현재 플랜 전체가 검증되고 막힌 것이 하나도 없을 때만 최종 응답에
`global_completion`이 들어갑니다. 모델이 다 했다고 말하는 것만으로는 플랜이
끝나지 않습니다.

## 한 단계 실행과 나중에 재개

지금 실행할 수 있는 마일스톤 하나만 진행하려면:

```bash
node "$NTG/scripts/ntg-vnext.mjs" run --ledger .ntg/ledger.json
```

의존성이 이미 끝난 마일스톤을 골라서 실행하려면:

```bash
node "$NTG/scripts/ntg-vnext.mjs" run --ledger .ntg/ledger.json --milestone m1
```

`--all`은 의존성 순서대로 계속 진행합니다. `--milestone`을 주면 `--all`이 함께
있어도 그 마일스톤 하나만 실행합니다.

정상적으로 끝났다면 언제든 다시 이어갈 수 있습니다. 같은 프로젝트에서 새 터미널을
열고 `NTG`를 다시 지정한 뒤, `status`로 상태를 보고 `run`이나 `run --all`을 다시
실행하세요. 매번 저장된 진행 상황을 읽기 때문에 이전 대화는 필요 없습니다.
이미 있는 ledger에 `init`을 다시 실행하지는 마세요.

## 계획 변경

고친 플랜을 예제와 같은 형식으로 `plan-v2.json`에 저장하고 `plan_version`을
`"v2"`로 바꿉니다. 그런 다음 실행합니다.

```bash
node "$NTG/scripts/ntg-vnext.mjs" replan --ledger .ntg/ledger.json --plan plan-v2.json
```

새 플랜을 채택하면서 지금까지의 완료 상태를 비우고, 이전 검수는 stale로
표시합니다. 그대로 둔 단계도 의존성 순서대로 다시 검수를 받아야 하지만, 바뀌지
않은 코드를 새로 짤 필요는 없습니다. 이전 증거는 이력으로 남습니다. 아직 진행
중인 호출이 있다면 끝나기를 기다리거나 복구한 다음 계획을 바꾸세요.

## 자문 받기

설계 방향을 정하지 못했을 때:

```bash
node "$NTG/scripts/ntg-vnext.mjs" plan --ledger .ntg/ledger.json --task "How should we test the health endpoint?"
```

같은 실패가 되풀이되어 다른 시각이 필요할 때:

```bash
node "$NTG/scripts/ntg-vnext.mjs" alt --ledger .ntg/ledger.json --milestone m1 --task "Challenge our current diagnosis of the failing health endpoint"
```

출력에는 `adopted: false`가 찍힙니다. 자문은 기록만 될 뿐 플랜을 고치거나 작업을
완료하지 않습니다. 쓸 만한 내용을 골라 플랜 파일에 반영하고 `replan`을 실행하면
됩니다.

같은 종류의 실패가 새 증거 없이 세 번 이상 이어지면 `status`가 `needs_alt`를
알려 줍니다. 알려 주기만 할 뿐 모델을 알아서 호출하지는 않습니다. `alt`는 기본으로
Sonnet을 씁니다. `--escalate`를 붙이면 일부러 Opus를 고르는 것이라 비용이 더 들 수
있습니다. 어느 쪽이든 결과는 자문일 뿐입니다.

## 작업이 멈췄을 때

JSON 출력에서 특히 `results`, `state.blockers`, `state.next_action`을 확인하세요.

| 결과 | 할 일 |
|---|---|
| 종료 코드 0 | 명령이 성공했습니다. 프로젝트 전체가 끝났는지는 `global_completion`을 보고 판단하세요 |
| 종료 코드 2: `NO-GO` | 검수가 요구한 수정 사항을 읽고 `run`을 다시 실행해 새 후보와 새 검수를 받으세요 |
| 종료 코드 2: `BLOCKED` / `NEEDS_DEEP` | 알려 준 블로커를 해결하거나 계획 자문을 받고, 필요하면 플랜을 고치세요 |
| 종료 코드 1: 잘못된 모델 응답 | 오류를 읽고 필요하면 그 마일스톤을 다시 실행하세요. 형식이 잘못된 응답은 완료로 올라가지 않습니다 |
| Ledger 잠금 | 이전 세션을 정상적으로 종료하세요. 아직 살아 있는 세션의 lock은 지우면 안 됩니다 |
| 작업 중 프로세스 크래시 | 아래 복구 절차를 거친 뒤 다시 시작하세요 |

크래시 복구에는 `/proc`이 있는 Linux, `os.pidfd_open`을 지원하는 Python 3,
그리고 남겨진 실행기를 종료하기 위한 pidfd 지원 커널이 필요합니다. 안전하게
종료된다는 확신이 없으면 복구를 거부합니다. 이전 프로세스가 중간에 끊긴 것을
확인했다면, 무슨 일이 있었는지 적어서 실행합니다.

```bash
node "$NTG/scripts/ntg-vnext.mjs" recover --ledger .ntg/ledger.json --evidence "Observed the previous supervisor exit during milestone execution"
```

증거 문장은 여러분이 실제로 본 내용으로 바꾸세요. 소유 프로세스가 강제 종료된
경우의 복구는 `tests/test_ntg_vnext.mjs`가 검증합니다. 복구는 끊긴 호출을 정리할
뿐 작업을 완료로 만들지 않으니, 복구한 뒤에는 `status`를 확인하고 다시 실행하세요.
잠금을 푸는 범용 명령도 아닙니다. 중단된 마일스톤이 없으면 복구했다고 하지 않고
오류를 반환합니다.

`init`, `status`, `replan`, `recover`는 모델을 호출하지 않고, `run`, `plan`,
`alt`는 호출합니다. 모델 호출은 기본적으로 600초가 지나면 시간 초과됩니다.
바꾸려면 `--timeout`이나 `NTG_RUNNER_TIMEOUT_S` 환경 변수에 양수 초 값을 주세요.

## 그래프로 진행 상황 보기

```bash
node "$NTG/scripts/dag-view.mjs" --ledger .ntg/ledger.json --width 80 --no-color
```

마일스톤과 의존성, 각 상태를 그려 주는 읽기 전용 명령입니다. 진행 상황은 바꾸지
않습니다.

- `--ledger PATH`: ledger 경로를 지정합니다. `NTG_LEDGER` 환경 변수를 써도 됩니다.
- `--width N`: 폭을 고정합니다. 주지 않으면 터미널 폭에 맞춥니다.
- `--no-color`: ANSI 색을 끕니다.
- `--watch`: ledger가 바뀔 때마다 다시 그립니다. 옆 터미널 창에 띄워 두면
  편합니다.

내 프로젝트 대신 NTG에 들어 있는 표시용 fixture로 먼저 보고 싶다면:

```bash
node "$NTG/scripts/dag-view.mjs" --ledger "$NTG/tests/fixtures/dag-view/all-states.ledger.json" --width 80 --no-color
```

내부 역할 선택, 모델 재정의, 유지보수자용 릴리스 점검은
[내부 동작](../internals.md)에서 다룹니다.
