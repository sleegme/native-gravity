# 아키텍처

> vNext 초안 — 비활성. 활성화는 검증 경계를 충족해야 합니다.

Native Gravity는 Antigravity의 네이티브 lifecycle, session, workspace,
model/tool 시스템을 유지합니다. vNext는 좁은 exact-model runner와 authoritative
ledger를 추가하며 런타임을 대체하지 않습니다.

이 개요는 [아키텍처 contract](../../../vnext-architecture-contract.md)와 현재
[agent](../../agents/) / [rule](../../rules/) 초안을 따릅니다.
릴리스된 v0.4의 peer-primary 구조는 격리된 vNext 토폴로지가 아닙니다.

## Supervisor와 milestone 실행

```text
User
  Steamroller — supervisor / authoritative ledger 담당
    Piledriver — bounded 계획, 아키텍처, 어려운 결정
    Bulldozer — bounded milestone 하나
      Jaguar / Puma / Bobcat
                       Strix Halo — Bobcat 로컬 advisor gate
    Zen — 독립 milestone 검증
    Steamroller ledger 전이
```

- **Steamroller** — goal, constraints, 채택된 plan version, milestone graph,
  evidence, blockers, next action, 전역 완료를 소유합니다.
  authoritative ledger는 Steamroller만 기록합니다.
  프로젝트 소스를 구현하거나 worker를 직접 오케스트레이션하지 않습니다.
- **Piledriver** — Steamroller에 계획, 아키텍처/API 결정, 검증 전략,
  material replan을 제안합니다. 구현, 위임, ledger, 완료 권한이 없습니다.
  채택은 Steamroller가 결정합니다. 실행/검수 요청도 계획 요청으로 처리하며
  Zen을 shell runner로 쓰거나 `READY`, `PLAN READY`, verdict를 선언하지 않습니다.
- **Bulldozer** — 현재 version의 milestone packet 하나를 받아 bounded 작업을
  위임하고 `DONE | BLOCKED | NEEDS_DEEP`를 반환합니다. 프로젝트 소스를 직접
  수정하거나 shell command를 실행하고 Piledriver/Zen을 호출하거나 ledger를
  기록하지 않습니다. 알려진 context와 packet에 명시된 파일은 직접 확인하며
  discovery와 미확인 target 탐색은 Jaguar에 맡깁니다.

## Specialist 라우팅

- **Jaguar** — read-only 사실 탐색. 네이티브 Flash 역할. 위임 없음.
- **Puma** — 명시적인 저위험 writing/formatting/mechanical 작업.
  네이티브 Flash 역할. 위임이나 advisor ceremony 없음.
- **Bobcat** — bounded 구현. 네이티브 Flash 역할. Strix Halo만 호출 가능.
  Bulldozer가 `ADVISOR_GATE: REQUIRED | NONE`을 선택합니다.
  실질적인 code/behavior/API/state/lifecycle/test 작업은 REQUIRED,
  명확한 저위험 mechanical 작업만 NONE입니다.
- **Strix Halo** — Bobcat 전용 read-only 로컬 gate. 네이티브 Pro 역할.
  `ACCEPT | REVISE | NEEDS_DEEP`. 수정은 Bobcat을 통해 수행합니다.
- **Zen** — Steamroller를 위한 독립 non-mutating milestone 검증.
  Bulldozer의 child가 아닙니다. 네이티브 Pro 역할. `GO | NO-GO`.
  검증 shell command에는 `NTG_ZEN_VERIFY=1`을 사용합니다.

크기가 아니라 작업 종류로 라우팅합니다. 어려운 결정은
`Strix Halo -> Bobcat -> Bulldozer -> Steamroller -> optional Piledriver`
경로를 따릅니다. Worker나 Bulldozer가 Piledriver를 직접 호출하지 않습니다.

## Ledger와 완료

대화 기억이 아니라 ledger가 authoritative state입니다. Steamroller는 goal,
constraints, decision invariants, plan version, milestone graph,
active/completed milestones, evidence, verification, blockers, next action을
기록합니다. 실행 또는 검수 중인 milestone은 한 번에 하나입니다.

Worker `READY`와 Strix `ACCEPT`는 로컬 신호입니다. Bulldozer `DONE`은 검수 전
candidate이며 검증된 milestone 완료나 전역 완료가 아닙니다.
Steamroller는 Zen 검수 요청 전에 immutable candidate와 고유한 `result_ref`를
저장합니다. 모든 P0 milestone은 `milestone_id`, 현재 `plan_version`,
`result_ref`가 일치하는 독립 Zen GO가 필요합니다.
Steamroller가 그 GO와 실제 evidence를 관측한 뒤에만 milestone을 승격합니다.
Candidate가 바뀌면 새 reference와 검수가 필요합니다.

Material replan은 active execution/review를 종료하고 `plan_version`을 올리며,
이전 verdict를 STALE로 표시하고 active/completed milestone state를 비웁니다.
유지된 milestone도 의존성 순서대로 현재 version의 fresh review를 받아야 합니다.
이전 evidence는 이력이지 현재 완료 권한이 아닙니다.
전역 완료에는 현재 milestone 전체의 검증, blocker 없음, active execution/review
없음, Steamroller의 직접 evidence 관측이 모두 필요합니다.

## Invocation과 migration 경계

Steamroller/Bulldozer는 Gemini 3.8 Flash / High, Piledriver는
Gemini 3.1 Pro / High를 목표로 합니다. Runner가 설치된 model slug를 silent
fallback 없이 해석하며 effort, cwd/context, bounded prompt 구성, timeout,
재귀 방지, 구조화된 결과 수집과 실패 보고를 담당합니다.
Machine invocation은 interactive terminal prose가 아니라 bare JSON object
하나를 요구하며 Bulldozer 응답은 `{`로 시작해야 합니다.
Packet parsing은 ledger 검증이나 독립 검수를 대체하지 않습니다.

Specialist는 네이티브 Flash/Pro 역할 정책을 유지합니다.
초안의 disabled frontmatter만으로 실제 tool/delegation 권한이나 customization
격리가 증명되지는 않습니다. Exact-model Zen에는 정책 추측이 아니라
비교 live evidence가 필요합니다.

Excavator는 P0 밖의 별도 troubleshooting primary입니다.
Recovery 재연결과 최종 배치는 44G 이후이며 `NTG_EXCAVATOR=1` guard 효과를
유지합니다. Instinct/Sonnet은 후속 작업입니다.

Merge된 구현과 기록된 live check가 이 트리를 활성화하지는 않습니다.
권한 인코딩과 OQ-6 inheritance 격리는 활성화 gate로 남아 있습니다.
#56은 strict orchestration 상시 적용과 `$loop` 중 아직 결정 중입니다.
`$loop`는 **#56 live validation 대기 중인 후보**이며 확정 아키텍처가 아닙니다.
