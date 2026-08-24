# 사용법

Native Gravity v0.2.1은 별도 wrapper CLI 없이 Antigravity plugin으로 직접 사용합니다.

## 설치

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin install .
```

Antigravity의 **Default agent**를 primary로 사용합니다. 권장 host/session model은 Claude Sonnet 4.6입니다.

Plugin rule이 Native Gravity의 routing policy를 제공하고, `gravity-worker`, `gravity-deep`, `gravity-reviewer`는 custom subagent로 남습니다.

## 기본 흐름

```text
사용자 요청
  ↓
Antigravity Default agent + Native Gravity rule
  ├─ 명확한 실행 → Worker
  ├─ 불확실한 진단/판단 → Deep → host/Worker
  └─ 필요 시 독립 검증 → Reviewer
```

서브에이전트가 부모 대화 전체를 자동으로 안다고 가정하지 말고, 호출 prompt에 다음 named field를 명시합니다.

- `ROLE_REASON`
- `GOAL`
- `SCOPE`
- `NON_GOALS`
- `ACCEPTANCE`
- `EVIDENCE`
- `EDIT_POLICY`
- `EXPECTED_OUTPUT`

일반적인 순차 작업은 같은 checkout을 보는 `Workspace: inherit`가 자연스럽습니다.

## Worker

명확한 구현, 반복 수정, focused discovery/research를 맡깁니다.

종료 시 정확히 하나를 반환합니다.

- `DONE` — 작업 완료 + 검증 evidence
- `BLOCKED` — 안전하게 진행할 수 없는 구체적 blocker
- `NEEDS_DEEP` — 무엇을 해야 하는지 아직 불명확해 진단 필요

## Deep

원인 불명, 요구사항 충돌, 설계 trade-off, 기존 의도 복원, 반복 실패처럼 실행 전에 diagnosis가 필요한 경우 사용합니다. Deep은 read-only이며 concrete implementation contract를 반환합니다.

## Reviewer

구현 에이전트와 독립적으로 요구사항/정확성/regression/scope/검증을 확인합니다. Host가 task goal/scope, acceptance criteria, 변경 컨텍스트, evidence를 prompt에 함께 전달합니다.

최종 출력은 `VERDICT: GO` 또는 `VERDICT: NO-GO`입니다.

## Runtime note

v0.2.1에서는 `gravity-main`을 custom primary로 사용하지 않습니다. v0.2 검증에서 해당 구성은 custom subagent와 built-in `research` 호출이 모두 실패했고, 같은 환경의 Default agent에서는 built-in `research`가 성공했습니다.

Issue #3에서 Default agent → Native Gravity 세 subagent 호출을 계속 검증합니다.
