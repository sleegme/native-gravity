# 현재 상태

Native Gravity는 현재 **v0.2.1 / experimental**입니다.

## v0.2.1 구현

- Antigravity Default agent를 host/coordinator로 유지
- 기존 Main 동작을 `rules/orchestration.md`로 이동
- Worker / Deep / Reviewer 3-subagent 구조
- Host model로 Sonnet 4.6 권장
- Worker = native `flash`
- Deep / Reviewer = native `pro`
- subagent 호출용 named delegation envelope 추가
- Worker 종료 신호: `DONE` / `BLOCKED` / `NEEDS_DEEP`
- Deep은 구현 대신 concrete implementation contract 반환
- Reviewer는 `VERDICT: GO` / `VERDICT: NO-GO` 유지
- shell wrapper / review packet / persistent coordination state 없음
- risk-gated review

## 왜 host 구조를 바꿨나

v0.2 bootstrap에서 custom `gravity-main` primary가 plugin agent, workspace custom agent, built-in `research`에 대한 `invoke_subagent` 호출을 모두 같은 오류로 실패했습니다.

`subagent "<name>" not found or not allowed to be invoked`

반면 같은 환경의 Antigravity Default agent에서는 built-in `research` 호출이 성공했습니다. 그래서 v0.2.1은 native primary를 유지하고 Main contract를 rule로 내립니다.

이것은 관측된 runtime behavior에 대한 compatibility workaround이며, custom primary delegation이 의도적으로 unsupported라고 단정하는 내용은 아닙니다.

## 남은 검증

Issue #3에서 다음을 확인해야 합니다.

1. Default agent → `gravity-worker`
2. Default agent → `gravity-deep`
3. Default agent → `gravity-reviewer`
4. Worker `NEEDS_DEEP` escalation
5. Reviewer GO/NO-GO correction loop
6. native host path로 bootstrap 재실행

## 다음 단계

v0.3의 AI Studio direct execution path는 이슈 #2에서 추적합니다.

앞으로도 AGY native primitive로 해결 가능한 문제를 별도 runtime 코드로 재구현하지 않는 것을 기본 원칙으로 둡니다.
