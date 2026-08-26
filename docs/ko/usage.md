# 사용법

> v0.4 alpha

```bash
git switch feat/v0.4-construction-primary-agents
agy plugin uninstall native-gravity
agy plugin install .
```

v0.3.x에서 넘어올 때는 제거된 agent/hook 파일이 설치 디렉터리에 남지 않도록 clean reinstall을 권장합니다.

## Bulldozer

일반적인 멀티스텝 작업에 사용합니다. 내부적으로 Jaguar/Puma/Bobcat/Steamroller/Zen을 골라 호출합니다.

## Piledriver

구현 전에 계획을 먼저 만들고 싶을 때 사용합니다. 프로젝트 소스는 수정하지 않고 실행 가능한 계획 패킷만 반환합니다.

## Excavator

"왜 망가졌는지 파서 직접 고쳐" 유형에 사용합니다. bounded 문제를 조사하고 root cause를 찾은 뒤 수정과 검증까지 직접 수행합니다.

## Bobcat / Puma

Bobcat은 일반 구현 담당이며 Bulldozer가 `ADVISOR_GATE: REQUIRED | NONE`을 선택합니다.

Puma는 writing, formatting, presentation-only, mechanical text/config 같은 quick/low-risk 작업 전용이며 Advisor를 부르지 않습니다.

## Alpha에서 먼저 볼 것

1. Bulldozer가 internal subagent를 실제 호출하는지
2. Bobcat -> Advisor가 동작하는지
3. Excavator가 Pro tier에서 수정 가능한지
4. Puma가 작은 작업을 과한 ceremony 없이 끝내는지
5. Zen launch가 아니라 실제 verdict를 받은 뒤 완료하는지
