# 상태

릴리스 트랙: `v0.4 alpha`

상태: **v0.4 alpha — AGY 1.1.21 핵심 런타임 검증 통과, alpha 사용 준비 완료**

완료:

- Bulldozer / Piledriver / Excavator Primary 3종
- Worker -> Bobcat
- Explorer -> Jaguar
- Deep -> Steamroller
- Reviewer -> Zen
- Puma quick/writing 경로 추가
- Bobcat -> Advisor gate 유지
- v0.3.3 Gemini 3.1 Pro 전역 mutation guard 제거
- v0.4 라우팅/문서 반영
- Zen verification-only `run_command` + marker-scoped `PreToolUse` guard 추가
- Excavator 일반 sudo는 유지하면서 stdin-password 권한 획득, 우회 privilege path, shell-history credential mining, 전체 시스템 업그레이드를 막는 marker-scoped shell guard 추가
- `tests/test_excavator_shell_guard.py`에 Excavator guard 회귀 테스트 추가

AGY 1.1.21 검증 완료:

- Bulldozer custom primary delegation
- Piledriver planning-only 행동
- Excavator direct edit + end-to-end verify
- Puma quick/writing 효율
- Bobcat -> Advisor CHECK 수렴
- Bobcat이 gravity-advisor 외 subagent를 호출하지 않음 (negative case)
- Zen 실제 verdict 관측

shell guard 변경 후 실제 AGY 재검증 대기:

- Zen이 `NTG_ZEN_VERIFY=1` marker로 독립 verification command를 실행하는지
- Zen-marked source mutation 시도는 막고 정상 검증 command는 허용하는지
- Excavator-marked 일반 sudo 진단/수리는 정상 동작하는지
- Excavator-marked `sudo -S`, `sudo su`, `pkexec`, localhost root SSH, shell-history credential mining, full-system upgrade는 거부되는지
- `env pkexec`, `command ssh root@localhost`, `bash -c 'sudo apt upgrade'` 같은 wrapper 형태도 거부되는지
- `sudo somecmd -S value`처럼 sudo 뒤 실행 명령의 `-S` 인자는 오탐하지 않는지
- Bulldozer 등 다른 agent의 unmarked shell call에는 영향이 없는지

Zen/Excavator guard는 완전한 shell 또는 privilege sandbox가 아니라 역할 이탈에 대한 behavioral backstop입니다. AGY 1.1.21의 `PreToolUse` payload에는 아직 신뢰할 수 있는 custom-agent identity가 없고 agent별 read-only shell policy도 없습니다.

미확정 이름:

- Advisor
