# Native Gravity

[English](../../README.md)

> **버전:** 1.1.0 · **성숙도:** alpha · **검증된 런타임:** AGY 1.3.3

Native Gravity(NTG)는 Google Antigravity(AGY)에서 여러 단계에 걸친 코딩 작업을
할 때, 무엇이 정말 끝났는지 분명하게 해 줍니다. 작업을 작은 단계로 나누고
단계마다 완료 기준을 적은 플랜을 쓰면, NTG가 단계를 실행하고 별도의 리뷰어에게
결과를 검수받은 뒤 검증된 진행 상황을 저장합니다. 그래서 나중에 그대로 이어서
작업할 수 있습니다.

**에이전트가 "끝났다"고 말해도 그것만으로는 완료가 아닙니다.**
여러분이 정한 기준에 맞는지 독립 검수를 통과해야 합니다.

## Antigravity에 NTG를 더하는 이유

코딩 대화 한 번으로 끝나는 일이라면 AGY만 써도 충분합니다. NTG는 여러 단계나
여러 세션에 걸친 작업에 분명한 진행 절차를 더해 줍니다.

- **무엇이 끝났는지 알 수 있습니다.** 독립 검수를 통과한 단계만 완료로
  기록되고, 반려된 결과는 미완료로 남습니다.
- **멈춘 곳에서 다시 시작합니다.** ledger라고 부르는 진행 파일에 플랜, 결과,
  막힌 이유, 다음 할 일이 저장됩니다.
- **단계마다 범위가 정해집니다.** 플랜에 손댈 파일, 만들어야 할 결과, 건드리지
  말아야 할 것을 적습니다.
- **계획을 바꾸면 처음부터 다시 검증합니다.** 그대로 둔 단계도 바뀐 계획
  기준으로 새로 검수를 받습니다.

내부 에이전트를 직접 고르거나 조율할 일은 없습니다. 모델, 도구, 세션, 권한은
여전히 Antigravity가 맡고, NTG는 그 위에 작업 범위, 진행 기록, 독립 검수를
얹습니다. 코딩 환경을 대체하는 도구가 아닙니다. 실제로 관측한 동작과 증거는
[상태](status.md)에 정리되어 있습니다.

## 설치

**Node.js 18+**, `PATH`에 잡힌 **Antigravity CLI(`agy`) 1.3.3**, 그리고 모델을
쓸 수 있는 환경이 필요합니다. 1.1.0은 npm에 올라가 있지 않으니 저장소에서
설치하세요.

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin uninstall native-gravity
agy plugin install .
export NTG="$PWD"
```

업그레이드할 때도 이렇게 지웠다가 다시 설치하면 더는 쓰지 않는 파일이 깔끔하게
정리됩니다. 설치한 적이 없어도 uninstall을 실행해서 생기는 문제는 없습니다.
`NTG`가 이 저장소를 가리키므로 여러분의 프로젝트에서도 스크립트를 실행할 수
있습니다. 플러그인을 설치한다고 전역 CLI 명령이 생기지는 않습니다.

이 설치 절차의 근거는 [기존 릴리스 증거](../../.omo/evidence/20-instinct-results.md)에
있습니다.

## 첫 작업 시작하기

작업할 프로젝트 디렉터리로 가서 [사용법의 예제](usage.md#첫-작업)를 따라 해
보세요. `plan.json` 작성부터 진행 파일 생성, 실행까지 차례로 안내합니다.

```bash
node "$NTG/scripts/ntg-vnext.mjs" init --ledger .ntg/ledger.json --plan plan.json
node "$NTG/scripts/ntg-vnext.mjs" status --ledger .ntg/ledger.json
node "$NTG/scripts/ntg-vnext.mjs" run --ledger .ntg/ledger.json --all
```

`init`과 `status`는 모델을 호출하지 않습니다. `run`은 실제 모델을 호출하므로 모델
사용량이 듭니다. 실제 모델로 실행, 반려, 수정, 재개를 확인한 기록은
[라이브 검증](status.md#라이브-검증)에 있습니다.

지금은 플랜 파일이 꼭 있어야 합니다. 목표 한 문장을 주면 바로 채택된 플랜이
되는 기능은 없지만, [계획 자문](usage.md#자문-받기)은 받을 수 있습니다.
제품은 alpha 단계이며 AGY 1.3.3이 설치된 호스트 한 대에서 검증했습니다. 크래시
복구는 Linux에서만 되고, 진행 파일 하나는 한 번에 한 세션만 쓸 수 있습니다.
작업이 멈췄을 때 어떻게 하면 되는지는 [작업이 멈췄을 때](usage.md#작업이-멈췄을-때)를
보세요.

## 문서

- [사용법](usage.md): 실제 작업 흐름, 예제, 문제 해결.
- [아키텍처](architecture.md): 설계 의도와 전체 구조.
- [내부 동작](../internals.md): 유지보수자를 위한 구현 세부 사항.
- [명세](../specs/): 구현이 따르는 기술 계약.
- [상태](status.md): 되는 것, 알려진 한계, 검증 증거.
- [버전 관리](../versioning.md): 릴리스 정책과 호환성 이력.
