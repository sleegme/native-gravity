# 사용법

> vNext 초안 — 비활성. 격리된 검증 전용입니다.

일반 npm/repository 설치는 root의 릴리스된 agent, rule, hook을 로드하며 이 초안
트리를 로드하지 않습니다. 문서 정합성 작업에서 초안을 활성 경로에 복사하지 않습니다.
[설치 경계](./README.md#설치-경계)를 참고합니다.

## 격리된 vNext workflow

1. Steamroller가 authoritative ledger를 생성하거나 이어받습니다.
   Goal, constraints, 채택된 plan version, milestones, evidence, next action을
   기준으로 합니다.
2. 계획, 아키텍처, 어려운 결정이 필요하면 Steamroller가 bounded Piledriver
   조언을 요청하고 채택 여부를 결정합니다.
   Piledriver는 실행, 위임, 결과물 검수, readiness 선언을 하지 않습니다.
3. Steamroller는 현재 version의 milestone packet 하나만 Bulldozer에 보냅니다.
   Identity/version, objective, bounded scope, non-goals, acceptance criteria,
   constraints, relevant evidence, settled decision invariants를 포함합니다.
4. Bulldozer는 알려진 context와 packet에 명시된 파일을 직접 확인합니다.
   Discovery/미확인 target은 Jaguar, 저위험 mechanical 작업은 Puma,
   구현은 Bobcat이 담당합니다. Bulldozer에는 shell이나 직접 소스 수정 권한이 없습니다.
5. Bulldozer는 changes, criterion-linked evidence, unknowns, deviations,
   blockers, escalation needs를 포함한 완전한 `DONE | BLOCKED | NEEDS_DEEP`
   result packet을 반환합니다. NEEDS_DEEP는 Piledriver로 직행하지 않고
   Steamroller가 optional Piledriver 라우팅을 결정합니다.
6. DONE이면 Steamroller가 immutable candidate/result reference를 저장하고 독립
   Zen 검수를 요청합니다. Milestone, 현재 plan version, result reference가 일치하는
   GO를 관측한 뒤에만 승격합니다. NO-GO면 milestone은 미완료로 남고 bounded
   repair 또는 replan을 진행합니다.

Machine runner invocation은 bare JSON object 하나를 요구합니다.
`READY`, `PLAN READY`, verdict prose, trailing summary로 요청 packet을
대체할 수 없습니다. Bulldozer 응답의 첫 byte는 `{`여야 합니다.
릴리스된 interactive agent의 terminal protocol은 이 격리된 workflow에서
완료 권한을 부여하지 않습니다.

## Bobcat / Puma

Bulldozer가 Bobcat의 `ADVISOR_GATE: REQUIRED | NONE`을 선택합니다.
실질적인 code/behavior/API/state/lifecycle/test 작업은 REQUIRED,
명확한 저위험 mechanical 작업만 NONE입니다.

REQUIRED이면 Bobcat은 read-only 로컬 CHECK gate인 **Strix Halo**
(`strix-halo`)만 호출합니다. ACCEPT이면 로컬 READY가 가능하고, REVISE면 수정과
fresh check가 필요하며, NEEDS_DEEP는 Bulldozer를 통해 Steamroller로 반환합니다.
Strix ACCEPT와 worker READY는 milestone 완료가 아닙니다.

Puma는 명시적인 저위험 writing, formatting, mechanical text/config 작업을
위임이나 advisor ceremony 없이 처리합니다. Line count가 아니라 작업 종류로
라우팅합니다.

## 활성화 전 검증

격리된 context에서 launch acknowledgement가 아니라 실제 결과를 확인합니다.

- Runner exact-model/effort 해석, 주입된 vNext role body, bounded JSON packet,
  timeout/failure 동작, customization 격리를 검증합니다.
- Steamroller -> Piledriver/Bulldozer, Bulldozer -> Jaguar/Puma/Bobcat,
  Bobcat -> Strix Halo, 독립 Steamroller -> Zen 경로를 실행합니다.
- 현재 candidate binding, NO-GO repair, stale/mismatched verdict 거부,
  material replan, fresh-context ledger resume를 확인합니다.
- 실제 tool/권한 경계와 등록된 marker-scoped guard를 검증합니다.
  Static frontmatter나 plugin validation만으로는 충분하지 않습니다.
- 현재 milestone 전체 검증, blocker와 active execution/review 없음,
  Steamroller의 evidence 관측 이후에만 전역 완료가 가능한지 확인합니다.

기록된 검증과 남은 경계는 [상태](./status.md)를 참고합니다.
#56은 strict orchestration 상시 적용과 명시적 `$loop` 중 아직 결정 중입니다.
`$loop`는 **#56 live validation 대기 중인 후보**이며 지금 사용할 activation
지침이 아닙니다.

Excavator는 P0 밖의 별도 troubleshooting primary입니다.
Bulldozer의 child나 자동 recovery 경로가 아닙니다. Instinct/Sonnet은 후속 작업입니다.
