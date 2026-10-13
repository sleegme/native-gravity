# Native Gravity

[English](../../README.md)

> **버전:** 1.1.0 · **성숙도:** alpha · **검증된 런타임:** AGY 1.3.3

Native Gravity(NTG)는 Google Antigravity(AGY)로 여러 단계의 코딩 작업을 할 때,
무엇이 실제로 끝났는지 놓치지 않도록 돕습니다. 할 일을 작은 단계로 나누고
완료 기준을 담은 플랜을 작성하면, NTG가 실행과 독립 검수를 진행하고 검증된
진행 상황을 저장합니다. 나중에 다시 이어서 작업할 수 있습니다.

**에이전트가 끝났다고 말하는 것만으로는 완료가 아닙니다.**
별도의 리뷰어가 사용자의 완료 기준에 맞는지 확인해야 합니다.

## Antigravity에 NTG를 더하는 이유

한 번의 코딩 대화로 충분하면 plain AGY를 사용하면 됩니다. NTG는 여러 단계나
세션에 걸친 작업에 명시적인 진행 절차를 더합니다.

- **완료 여부를 확인할 수 있습니다.** 독립 검수를 통과한 단계만 완료로 기록하고,
  반려된 결과는 미완료로 남깁니다.
- **중단한 지점에서 이어갑니다.** ledger라는 진행 파일에 플랜, 결과, 막힌 이유와
  다음 작업을 저장합니다.
- **단계마다 범위를 지킵니다.** 플랜에 수정할 파일, 만들 결과, 하지 않을 일을
  적습니다.
- **계획을 바꾸면 다시 검증합니다.** 유지한 단계도 변경된 계획에 맞는 새 검수를
  받아야 합니다.

내부 에이전트를 직접 고르거나 조율할 필요가 없습니다. 모델, 도구, 세션, 권한은
여전히 Antigravity가 제공합니다. NTG는 그 위에 작업 범위, 진행 기록과 독립 검수를
더합니다. 실제 관측 결과와 증거는 [상태](status.md)를 참고하세요.

## 설치

**Node.js 18+**, `PATH`에 있는 **Antigravity CLI(`agy`) 1.3.3**, 정상적인
모델 접근 권한이 필요합니다. 1.1.0은 npm에 게시되어 있지 않으므로 저장소에서
설치합니다.

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin uninstall native-gravity
agy plugin install .
export NTG="$PWD"
```

업그레이드할 때도 제거 후 설치하면 더 이상 사용하지 않는 파일이 남지 않습니다.
설치된 적이 없어도 uninstall은 안전합니다. `NTG`는 이 저장소 경로를 가리키므로
자신의 프로젝트에서 스크립트를 실행할 수 있습니다. 플러그인 설치가 전역 CLI
명령을 만들어 주지는 않습니다.

설치는 [기존 릴리스 증거](../../.omo/evidence/20-instinct-results.md)에서 확인했습니다.
이번 문서 변경에서는 플러그인 검증만 통과시켰으며, 공유 설치에 대한 제거/설치는
다시 실행하지 않았습니다.

## 첫 작업 시작하기

자신의 프로젝트 디렉터리에서 [사용법의 예제](usage.md#첫-작업)를 따라 하세요.
`plan.json` 작성부터 진행 파일 생성과 실행까지 설명합니다.

```bash
node "$NTG/scripts/ntg-vnext.mjs" init --ledger .ntg/ledger.json --plan plan.json
node "$NTG/scripts/ntg-vnext.mjs" status --ledger .ntg/ledger.json
node "$NTG/scripts/ntg-vnext.mjs" run --ledger .ntg/ledger.json --all
```

`init`과 `status`는 해당 예제로 로컬 검증했습니다. `run`은 실제 모델을 호출하고
모델 사용량을 소비하므로 이번 문서 변경에서는 다시 실행하지 않았습니다.
실행, 반려, 수정 후 검수, 재개에 관한 [라이브 증거](status.md#라이브-검증)는
유지했습니다.

현재는 플랜 파일이 필요합니다. 한 문장짜리 목표가 자동으로 채택된 플랜이 되지는
않습니다. [계획 자문](usage.md#자문-받기)은 별도로 요청할 수 있습니다.
제품은 alpha이며 AGY 1.3.3 단일 호스트에서 검증되었습니다. 크래시 복구는
Linux 전용이고, 진행 파일 하나는 한 세션만 소유할 수 있습니다.
실제 대처 방법은 [작업이-멈췄을-때](usage.md#작업이-멈췄을-때)를 참고하세요.

## 문서

- [사용법](usage.md) — 실제 작업 절차, 예제와 문제 해결.
- [아키텍처](architecture.md) — 설계 의도와 전체 구조.
- [내부 동작](../internals.md) — 구현과 유지보수 세부 사항.
- [명세](../specs/) — 구현이 따르는 기술 계약.
- [상태](status.md) — 구현된 기능, 한계와 검증 증거.
- [버전 관리](../versioning.md) — 릴리스 정책과 호환성 이력.
