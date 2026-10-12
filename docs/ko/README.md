# Native Gravity

[English](../../README.md)

> - **Native Gravity**: 1.1.0
> - **상태**: alpha
> - **검증된 런타임**: AGY 1.3.3

## Native Gravity란?

Native Gravity(NTG)는 Google Antigravity를 위한 얇은 오케스트레이션
플러그인입니다. 작업을 작은 플랜 파일로 작성하면 `ntg-vnext` CLI가 Antigravity
자체 에이전트를 사용해 마일스톤 단위로 실행합니다. 단, 한 가지 규칙은 확고합니다:
**독립 리뷰어 에이전트가 산출물을 승인 기준과 대조해 검증하기 전에는 어떤
마일스톤도 완료로 처리하지 않습니다.** 여러 단계로 이어지는 코딩 작업에서 이
방식이 주는 실질적인 이점은 "오래 유지되는 정직한 상태"입니다. 세션을 중단했다가
나중에 새 컨텍스트로 재개해도, ledger가 완료된 항목, 반려된 항목, 다음 할 일을
정확히 알려 줍니다.

## 왜 plain AGY 대신 사용하나요?

plain AGY 에이전트는 이미 코딩에 능숙합니다. 다만 여러 단계로 이어지는 작업에서는
대화 자체가 상태가 됩니다. 완료 여부는 모델이 스스로 보고하고, 재개는 채팅
기록에 의존합니다. NTG는 그 위에 작고 검증된 계층을 추가합니다. 아래 동작은
AGY 1.3.3 라이브 검증에서 실제로 관측된 내용이며
([증거](../../.omo/evidence/134-vnext-activation.md)), 성능 주장이 아니라 동작
보장입니다:

- **스스로 완료를 선언하지 않는 독립 검증.** 별도의 리뷰어 에이전트(Zen)가 모든
  마일스톤의 산출물을 플랜의 승인 기준과 대조해 GO 또는 NO-GO를 반환합니다.
  라이브 테스트에서 의도적으로 훼손된 산출물은 NO-GO로 반려되었고, 수정된
  후보는 새로운 GO를 받아야 했습니다.
- **대화가 아닌 영속 상태.** 대화 로그가 아닌 권위 있는 JSON ledger가 플랜
  버전, 마일스톤 상태, 증거, 블로커를 기록합니다. 새 프로세스가 대화 없이
  ledger만으로 작업을 재개했으며, 계획이 크게 변경되면 기존 판정은 무효화되고
  재검증이 요구되었습니다.
- **마일스톤마다 명시적인 범위.** 각 마일스톤은 명시적 범위, 비목표, 승인 기준을
  담은 패킷으로 실행되어, 한 단계가 다음 단계를 몰래 흡수할 수 없습니다. 작업
  성격(발견, 작성, 구현, 진단, 검증)에 맞는 전문 에이전트에 위임됩니다.
- **실패 시 닫히는(fail-closed) 처리.** 비어 있거나 형식이 깨진 응답, 결과
  패킷이 둘 이상인 응답, 설명 문장과 JSON이 모호하게 섞인 응답은 invocation
  실패로 기록되며 절대 승격되지 않고, 세션이 강제
  종료되어 남은 stale lock은 소유자가 죽은 것이 확인된 후에만 복구됩니다.

## 지금 무엇이 동작하나요?

- 의존 순서를 지키는 멀티 마일스톤 실행(`ntg-vnext run --all`), 관측된 매칭
  Zen GO가 있을 때만 승격
- 플랜 수정(`ntg-vnext replan`) — `plan_version` 증가와 유지 마일스톤 재검증
- NO-GO 수리 사이클: 반려된 후보는 새로운 GO를 받기 전까지 미완료로 유지
- 새 컨텍스트 재개와 크래시 복구(`ntg-vnext recover`)
- 자문성 계획(`ntg-vnext plan`)과 대안 프레이밍 자문(`ntg-vnext alt`) — 증거로만
  기록되며 자동 채택되지 않음
- 읽기 전용 ledger 그래프 뷰어(`ntg-dag`)

알려진 한계는 [아래](#요구-사항과-알려진-한계)를 참고하세요.

## 설치

사전 요구 사항:

- Node.js 18+
- `PATH`에 있는 Antigravity CLI(`agy`) 1.3.3, 정상 동작하는 모델 접근 권한

Native Gravity 1.1.0은 **npm에 게시되어 있지 않습니다.** 저장소에서
설치하세요:

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin uninstall native-gravity  # 설치된 적이 없어도 안전합니다
agy plugin install .
```

업그레이드 시에는 저장소에서 제거된 파일이 설치 디렉터리에 남지 않도록 clean
reinstall(제거 후 설치)을 사용하세요.

## 빠른 시작

NTG는 아직 한 문장짜리 목표를 받지 않습니다 — **작은 플랜 파일을 직접
작성하고** CLI가 실행합니다. 최소한의 유효한 `plan.json`:

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

각 마일스톤은 고유한 `id`가 필요하고, `dependencies`는 존재하는 id를 참조하며
순환을 이뤄서는 안 됩니다. 필수 필드는 `goal`과 비어 있지 않은 `milestones`
배열뿐이며, `title`, `objective`, `acceptance_criteria`, `non_goals`,
`bounded_scope`를 채우면 마일스톤 계약이 명확해지므로 강력히 권장합니다.

이제 ledger를 만들고 시작합니다. 아직 npm에 배포되지 않아 전역 `ntg-vnext`
명령은 없습니다. Native Gravity를 받아 둔 저장소의 스크립트를 직접 실행하세요
(아래 `$NTG`는 그 저장소 경로입니다). 이 문서의 다른 곳에 나오는
`ntg-vnext <명령>`은 `node $NTG/scripts/ntg-vnext.mjs <명령>`을 뜻합니다.

```bash
node $NTG/scripts/ntg-vnext.mjs init   --ledger .ntg/ledger.json --plan plan.json
node $NTG/scripts/ntg-vnext.mjs status --ledger .ntg/ledger.json   # 다음 마일스톤을 보여 줍니다
node $NTG/scripts/ntg-vnext.mjs run    --ledger .ntg/ledger.json --all
```

`init`, `status`, `recover`는 로컬에서 동작하며 비용이 없습니다. `run`, `plan`,
`alt`는 실제 AGY 모델을 호출하므로 모델 사용량이 소비됩니다.

## 예시: 평범한 코딩 작업

위 플랜으로 `init`를 실행하면 플랜이 수락되고 다음 작업을 알려 줍니다:

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

이후 `ntg-vnext run --all`이 `m1`을 실행하고, 독립 리뷰어가 "GET /health
returns 200 and a status field" 기준으로 검증한 뒤 GO일 때만 승격합니다. `m2`도
같은 방식으로 처리되고, 둘 다 검증되면 global completion이 선언됩니다. 검증이
마일스톤을 반려하면(종료 코드 2) 출력된 `results`에 부족한 점이 나옵니다. 수정한
뒤 다시 `run`하면 새로운 GO를 받을 수 있습니다. 전체 명령어는
[사용법](usage.md)을 참고하세요.

## 동작 원리

```text
You -> ntg-vnext -> 한 번에 하나의 bounded 마일스톤
                      -> 전문 에이전트를 통한 구현
                      -> 산출물에 대한 독립 검증
                      -> GO일 때만 ledger 승격
                 -> 모든 마일스톤이 검증되면 global completion
```

ledger가 유일한 단일 진실 원천이며, 호출할 때마다 다시 로드하므로 어떤 새
프로세스든 ledger가 가리키는 지점에서 이어집니다. 내부적으로 NTG는 Antigravity
에이전트(감독자, 플래너, 마일스톤 실행자, 전문가, 독립 리뷰어)를 고정된 모델
배정과 함께 조합하며, 사용자가 직접 선택할 일은 없습니다. 전체 그래프와 역할
경계는 [아키텍처](architecture.md)를 참고하세요.

Native Gravity는 Antigravity 런타임을 대체하지 않습니다. 실행, 세션, 모델,
권한은 Antigravity가 소유하고, NTG는 역할 계약, 라우팅 정책, ledger를
제공합니다. 자세한 내용은 [내부 동작](../internals.md)을 참고하세요.

## 요구 사항과 알려진 한계

- **알파 소프트웨어.** AGY 1.3.3 단일 호스트에서 검증되었습니다. AGY 런타임이
  바뀌면 호환성 게이트를 다시 검증하세요([내부 동작](../internals.md)).
- **플랜은 직접 작성합니다.** 자연어 목표 → 플랜 UI는 없으며, `ntg-vnext plan`은
  계획 자문을 제공할 뿐 플랜을 대신 작성하지 않습니다.
- **모델 사용 비용.** `run`, `plan`, `alt`는 실제 AGY 모델을 호출합니다.
- **알려진 실패 모드.** 모델이 JSON 결과 패킷 앞에 worker 보고를 그대로 옮겨
  붙이는 경우가 간혹 있습니다. 패킷 하나를 감싼 평범한 설명 문장은 받아들이지만,
  패킷 밖의 문장에 JSON처럼 보이는 요소(큰따옴표, 백틱, 중괄호, 대괄호, 또는
  단독으로 쓰인 숫자·`true`·`false`·`null`)가 있으면 결과가 모호해져
  invocation 실패로 fail-closed 처리됩니다([#136](https://github.com/sleegme/native-gravity/issues/136)).
  1.1.0부터 Bulldozer는 worker 보고를 패킷 안에만 넣도록 지시받으며, 그래도
  발생하면 마일스톤을 재시도하세요. 깨진 응답에서는 아무것도 승격되지 않습니다.
- **크래시 복구는 Linux 전용.** `recover`는 `/proc`과 `pidfd`로 죽은 소유자를
  확인하고 고아 executor를 종료합니다. 다른 플랫폼에서는 추측하지 않고 거부합니다.
- **ledger 하나에 세션 하나.** 러너는 세션 수명 동안 ledger에 배타적 lock을
  보유합니다. 다른 곳에서 재개하기 전에 이전 세션을 닫으세요
  ([내부 동작](../internals.md)).

## 더 읽을거리

- [사용법](usage.md) — 전체 명령어, Excavator worker, `ntg-dag`
- [아키텍처](architecture.md) — 역할, ledger와 완료 의미론
- [내부 동작](../internals.md) — ledger 잠금/복구, 역할 소유권, AI Studio A/B 레인,
  호환성 이력
- [상태](status.md) — 현재 런타임 상태와 검증 증거
- [버전 관리](../versioning.md) — 버전 정책과 호환성 매트릭스
- [vNext 아키텍처 계약](../specs/vnext-architecture-contract.md) — 권위 있는 명세
