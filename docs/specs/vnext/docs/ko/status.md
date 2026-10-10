# 상태

## 트랙

**vNext 구현/초안 정합성 반영 — 비활성.**

Merge된 #44 작업과 격리된 검증 evidence는 활성화나 미해결 결정의 확정을
뜻하지 않습니다. 이전 v0.4 / AGY 1.1.21 alpha checklist는 과거 릴리스 런타임
검증이며 현재 vNext readiness가 아닙니다.

## 구현된 #44 작업

| Slice | 반영 범위 |
| --- | --- |
| 44B | 좁은 exact-model/effort runner, 설치 model 해석, bounded packet, timeout/재귀 방지, 구조화된 결과/실패 |
| 44C | Steamroller 소유 authoritative ledger와 완료 state machine, candidate/result binding, 현재 version review gate, replan 무효화 |
| 44D | 비활성 core-role/rule 초안: Steamroller supervisor, bounded Piledriver planner, Bulldozer milestone orchestrator |
| 44E | 최소 runner/ledger spine과 독립 Zen candidate 검수 |
| 44F | 권한 확대 없는 Jaguar/Puma/Strix Halo specialist 재연결 |

후속 merge된 수정에는 runner role-body injection과 strict machine response 처리,
specialist packet 검증, ledger ownership lock, blocker 정규화,
failure-prompt growth 제한, delegation-boundary check가 포함됩니다.
최근 역할 수정은 실행/검수 intake에서도 Piledriver를 planning-only로 유지하고
(#108), Bulldozer가 알려진 context는 직접 확인하되 discovery는 Jaguar로
라우팅하도록 합니다 (#109).

Ledger 전이와 전역 완료는 Steamroller만 소유합니다.
Worker READY, Strix ACCEPT, Bulldozer DONE은 milestone 승격 전 필요한
독립 candidate-matching Zen GO를 대체하지 않습니다.

## 기록된 검증

아래는 과거 검증 기록이며 이 문서 변경에서 새로 실행한 check가 아닙니다.

- [44B runner spike](../../../44b-runner-spike.md): 설치 model 해석과
  bounded Piledriver/Bulldozer live invocation.
- [Role-contract 검증](../../../../../.omo/evidence/2026-10-03-44g-role-contract-findings.md):
  격리된 role-body 구성과 machine packet parsing.
  Customization 격리나 활성화의 증거는 아닙니다.
- [44G 통합 실행과 solo 재실행](../../../../../.omo/evidence/2026-10-07-44g-e2e-validation-run4.md):
  multi-milestone 실행, fresh-context resume, plan revision, advisory Piledriver.
  처음 timeout된 case는 더 큰 budget에서 DONE + Zen GO로 완료되었습니다.
  Case 이름만으로 NO-GO 검증이 되는 것은 아닙니다.
- [별도 Zen NO-GO case](../../../../../.omo/evidence/2026-10-07-44g-case5-zen-no-go.md):
  mutable artifact reference를 가진 고정 candidate를 live Zen이 독립적으로
  거부했고 production ledger는 승격과 전역 완료를 거부했습니다.
  Candidate 생성은 fixture이며 live Bulldozer 작업이 아닙니다.

## 남은 활성화 경계

- 의도된 host에서 live 권한 인코딩과 OQ-6 customization/inheritance 격리를
  포함한 활성화/검증 경계를 완료해야 합니다. Plugin validation, agent discovery,
  `--agent` 생략만으로는 증명되지 않습니다.
- #56의 strict orchestration 상시 적용 대 명시적 `$loop` 활성화를 live
  validation으로 결정해야 합니다. `$loop`는 **#56 live validation 대기 중인 후보**이며
  구현되거나 확정된 contract가 아닙니다.
- Live evidence가 변경을 정당화하기 전까지 네이티브 specialist 역할 정책을
  유지합니다. Zen의 optional exact-model 선택은 여기서 확정하지 않습니다.
- 활성화와 #34 license closure 전에 필요한 migration/provenance closure를
  완료해야 합니다. Merge된 slice나 과거 활성화 주장은 현재 경계 evidence를
  대체하지 않습니다.

Excavator는 P0 밖의 별도 역할이며 recovery 재연결/최종 권한은 44G 이후입니다.
Instinct/Sonnet은 후속 작업입니다. 어느 쪽도 현재 spine의 미지원 capability를
우회하는 fallback이 아닙니다.
