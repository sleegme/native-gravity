# 아키텍처

Native Gravity v0.4는 모델을 억지로 같은 Host 행동에 맞추기보다, 각 모델이 자연스럽게 잘하는 역할에 배치하는 방향으로 전환합니다.

## Primary

- **Bulldozer** — 범용 오케스트레이션, 통합, 완료 판단
- **Piledriver** — 계획 전용. 요구사항/Acceptance/Task Graph/리스크/검증 전략 작성
- **Excavator** — 어려운 고장 문제를 조사 -> 재현 -> 진단 -> 수정 -> 검증까지 독립 수행

세 에이전트는 서로 동급입니다.

## Internal

- **Bobcat** — 일반 구현. Flash. 필요 시 Advisor CHECK.
- **Puma** — quick/writing. Flash. 작고 명확한 저위험 작업.
- **Jaguar** — read-only 탐색. Flash.
- **Steamroller** — read-only 깊은 판단. Pro.
- **gravity-advisor** — Bobcat 전용 로컬 검토. 이름 미정.
- **Zen** — 최종 독립 검수. Pro.

## 핵심 경계

Bulldozer는 일반 구현을 Bobcat/Puma에 맡깁니다. Piledriver는 구현하지 않습니다. Excavator는 역할 자체가 자율 수리이므로 직접 수정합니다.

따라서 v0.3.3의 3.1 Pro 전역 mutation guard는 v0.4 역할 맵과 충돌하며 제거됩니다.

과거 custom primary의 subagent 호출 실패 이력이 있으므로 Bulldozer의 실제 delegation 가능 여부는 v0.4 alpha의 첫 런타임 게이트입니다.
