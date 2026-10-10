# vNext 초안 — 설치 안 됨, 활성화 안 됨

이 트리는 issue #44의 비활성 vNext agent/rule 초안과 설명 문서를 담습니다.
구현 slice가 merge되었다고 이 초안이 설치된 런타임이 되거나 활성화 경계가
충족되는 것은 아닙니다.

## 현재 초안 토폴로지

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

Steamroller만 계획을 채택하고 authoritative ledger를 기록하며 milestone 승격과
전역 완료를 판단합니다. Bulldozer는 검수 전 candidate를 반환합니다.
Steamroller는 milestone, 현재 plan version, immutable result reference가 일치하는
독립 Zen GO를 실제 관측한 뒤에만 승격할 수 있습니다.
Excavator는 P0 spine 밖의 별도 troubleshooting primary로 유지하며 recovery
재연결은 44G 이후입니다. Instinct는 후속 작업입니다.

좁은 runner가 Steamroller/Piledriver/Bulldozer의 exact-model 해석, effort,
bounded prompt/context, timeout, 재귀 방지, 결과 수집과 구조화된 실패를 담당합니다.
네이티브 specialist의 권한은 로컬 범위에 머무르며 초안 frontmatter만으로
런타임 격리가 입증되지는 않습니다.

## 기준 문서와 구현 상태

- [아키텍처 contract](../../../vnext-architecture-contract.md) — 역할 권한,
  ledger, handoff, migration 경계.
- [현재 agents](../../agents/)와 [rules](../../rules/) — 격리된 vNext contract.
- [아키텍처](./architecture.md), [상태](./status.md), [사용법](./usage.md) —
  merge된 #44 작업과 검증 한계 요약.
- [English](../../README.md) — 동일한 영문 개요.

44B–44F의 runner, ledger, core-role, spine, specialist 작업은 구현되었습니다.
44G 통합 검증 evidence도 있지만 권한/inheritance 격리를 포함한 활성화/검증
요건을 충족하기 전까지 vNext는 **비활성**입니다.
이 문서는 미해결 결정을 확정하지 않습니다.

#56은 strict orchestration을 항상 적용할지, `$loop`로 명시적으로 활성화할지
아직 결정 중입니다. `$loop`는 **#56 live validation 대기 중인 후보**이며
구현되거나 확정된 activation contract가 아닙니다.

## 설치 경계

일반 설치 경로는 이 트리의 파일을 배포하거나 로드하지 않습니다.

- `scripts/npm-install.mjs`는 `package.json`의 `files` 목록에 포함된 파일만
  설치합니다. `docs/specs/vnext/`는 그 목록에 없습니다.
- root `hooks.json`은 root hook만 연결합니다. 이 트리의
  `docs/specs/vnext/hooks.json`은 연결되지 않은 참고 자료입니다.
- root `agents/*.md`, `rules/*.md`가 활성 v0.4 prompt로 유지됩니다.
  여기에는 `hooks/primary-review-gate.py` Stop hook이 강제하는
  Piledriver `PLAN READY` 규율도 포함됩니다.

vNext 활성화 제안은 별도로 명확히 표시된 변경이어야 합니다.
초안 전용 PR에서 이 트리를 root 경로에 복사하는 것은 범위 밖입니다.
