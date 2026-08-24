# 사용법

Native Gravity v0.2는 별도 `oma` 명령이나 shell wrapper 없이 Antigravity plugin으로 사용합니다.

## 설치

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin install .
```

`/agents`에서 `gravity-main`을 선택합니다. 권장 구성은 상위 세션 모델을 Claude Sonnet 4.6으로 두는 것입니다.

## 기본 흐름

```text
사용자 요청
  ↓
Main
  ├─ 명확한 실행 → Worker
  ├─ 불확실한 진단/판단 → Deep → Main/Worker
  └─ 필요 시 독립 검증 → Reviewer
```

서브에이전트가 부모 대화 전체를 자동으로 안다고 가정하지 말고, 호출 prompt에 목표·범위·non-goal·acceptance criteria·현재 evidence·edit 가능 여부를 명시합니다.

일반적인 순차 작업은 같은 checkout을 보는 `Workspace: inherit`가 자연스럽습니다.

## Worker

명확한 구현, 반복 수정, focused discovery/research를 맡깁니다. 실제 원인이나 해법이 불명확하면 억지로 구현하지 않고 Main에 uncertainty를 반환해야 합니다.

## Deep

원인 불명, 요구사항 충돌, 설계 trade-off, 기존 의도 복원, 반복 실패처럼 실행 전에 diagnosis가 필요한 경우 사용합니다. Deep은 read-only입니다.

## Reviewer

구현 에이전트와 독립적으로 요구사항/정확성/regression/scope/검증을 확인합니다. Main이 변경 컨텍스트와 evidence를 prompt에 함께 전달합니다.

최종 출력은 `VERDICT: GO` 또는 `VERDICT: NO-GO`입니다.

모든 사소한 변경에 강제하지 않고 risk-gated로 사용합니다.
