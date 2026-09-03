# Native Gravity

Native Gravity는 Google Antigravity의 네이티브 실행 구조를 유지하면서 역할별 하네스를 제공하는 소형 오케스트레이션 플러그인입니다.

> - **Native Gravity**: 0.4.0
> - **상태**: alpha
> - **호환성**:
>   - AGY 1.1.21 — validated
>   - AGY 1.1.24 — validated

## Primary 모드

```text
User
├─ Bulldozer  — 범용 Host / 오케스트레이터
├─ Piledriver — 계획 전용
└─ Excavator  — 자율 트러블슈터 / 수리 담당
```

세 Primary는 동급 진입점입니다. Piledriver와 Excavator는 Bulldozer의 하위 에이전트가 아닙니다.

## Bulldozer 내부 팀

```text
Bulldozer
├─ Bobcat      — 일반 구현 / Flash
│  └─ Advisor  — 로컬 조언 + CHECK / Pro
├─ Puma        — quick + writing / Flash
├─ Jaguar      — 탐색 / Flash
├─ Steamroller — 깊은 판단 / Pro
└─ Zen         — 독립 검수 / Pro
```

라우팅 기준:

- 찾기/현황 파악 -> Jaguar
- 작고 명확하고 저위험 / writing -> Puma
- 일반 구현 -> Bobcat
- 아키텍처/모호성/트레이드오프 -> Steamroller
- 독립 검수 -> Zen

v0.3.3의 Gemini 3.1 Pro 전역 mutation deny 훅은 제거했습니다. v0.4의 Excavator는 Pro-tier 자율 구현 역할이므로 직접 수정 권한이 필요합니다.

AGY 1.1.21 및 AGY 1.1.24 clean install에서 custom primary인 Bulldozer의 내부 위임과 Bulldozer -> Bobcat -> gravity-advisor 중첩 gate를 실제 대화로 검증했습니다. AGY 런타임이 바뀌면 이 compatibility gate를 다시 검증해야 합니다. 자세한 버전 정책 및 호환성 매트릭스는 [Versioning Policy](../versioning.md)를 참고하세요.
