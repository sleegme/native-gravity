# 현재 상태

Native Gravity는 현재 **v0.2 / experimental**입니다.

## v0.2 구현 완료

- 순수 Antigravity plugin 구조
- Main / Worker / Deep / Reviewer 4-role 구조
- Main host로 Sonnet 4.6 권장
- Worker = native `flash`
- Deep / Reviewer = native `pro`
- Deep을 task size가 아니라 uncertainty/diagnosis 기준으로 정의
- Reviewer read-only / blocker-focused
- Explore/Librarian 별도 agent 제거
- shell wrapper / review packet plumbing 제거
- `.oma/` persistent state 제거
- risk-gated review

## 검증

실제 AGY 환경의 discovery, delegation, correction/session reuse, 대표 coding task 검증은 이슈 #3에서 추적합니다.

## 다음 단계

v0.3의 AI Studio direct execution path는 이슈 #2에서 추적합니다.

앞으로도 AGY native primitive로 해결 가능한 문제를 별도 runtime 코드로 재구현하지 않는 것을 기본 원칙으로 둡니다.
