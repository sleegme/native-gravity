# 아키텍처

Native Gravity v0.4는 모델을 억지로 같은 Host 행동에 맞추기보다, 각 모델이 자연스럽게 잘하는 역할에 배치하는 방향으로 전환합니다.

## Primary

- **Bulldozer** — 범용 오케스트레이션, 통합, 완료 판단
- **Piledriver** — 계획 전용. 요구사항/Acceptance/Task Graph/리스크/검증 전략 작성
- **Excavator** — 어려운 고장 문제를 조사 -> 재현 -> 진단 -> 수정 -> 검증까지 독립 수행

세 에이전트는 서로 동급입니다.

### Piledriver 내부 경로

```text
Piledriver
├─ Jaguar  — 계획에 필요한 read-only 사실 탐색
└─ Zen     — 최종 plan-readiness 독립 검수
```

Piledriver는 요청 대상의 identity/current state가 불명확할 때 Jaguar를 사용해 사실을 수집합니다. 로컬 checkout이나 비슷한 파일이 보인다는 이유만으로 그것을 요청된 PR/issue/runtime 대상으로 승격하지 않습니다. 계획이 완성된 뒤에는 Zen의 실제 현재 `VERDICT: GO`를 관측해야 `PLAN READY`를 선언할 수 있습니다. 구현 worker는 Piledriver에서 호출하지 않습니다.

## Internal

- **Bobcat** — 일반 구현. Flash. 필요 시 Strix Halo CHECK.
- **Puma** — quick/writing. Flash. 작고 명확한 저위험 작업.
- **Jaguar** — read-only 탐색. Flash.
- **Steamroller** — read-only 깊은 판단. Pro.
- **Strix Halo** — Bobcat 전용 read-only 로컬 조언/검토 gate. Pro.
- **Zen** — 최종 독립 검수. Pro. Bulldozer에서는 결과물, Piledriver에서는 계획 readiness를 검수합니다.

## 핵심 경계

Bulldozer는 일반 구현을 Bobcat/Puma에 맡깁니다. Piledriver는 구현하지 않으며 Jaguar/Zen만 planning child로 사용합니다. Excavator는 역할 자체가 자율 수리이므로 직접 수정합니다.

따라서 v0.3.3의 3.1 Pro 전역 mutation guard는 v0.4 역할 맵과 충돌하며 제거됩니다.

과거 custom primary의 subagent 호출 실패 이력이 있으므로 Bulldozer의 실제 delegation과 Piledriver -> Jaguar/Zen 경로는 v0.4 alpha 런타임 검증 대상입니다.
